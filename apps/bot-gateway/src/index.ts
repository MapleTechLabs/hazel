import { BunRuntime } from "@effect/platform-bun"
import { BotRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import {
	BotGatewayClientFrame,
	BotGatewayEnvelope,
	BotGatewayHeartbeatAckFrame,
	BotGatewayHelloFrame,
	BotGatewayIdentifyFrame,
	BotGatewayServerFrame,
} from "@hazel/domain"
import { Redis } from "@hazel/effect-bun"
import type { BotId } from "@hazel/schema"
import type { ServerWebSocket } from "bun"
import { Cause, Config, ConfigProvider, Deferred, Effect, Layer, Option, Ref, Schema, Context } from "effect"
import { TracerLive } from "./observability/tracer"

const DEFAULT_PORT = 3034
const DEFAULT_DURABLE_STREAMS_URL = "http://localhost:4437/v1/stream"
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000
const DEFAULT_LEASE_TTL_SECONDS = 75
const DEFAULT_BATCH_ACK_TIMEOUT_MS = 60_000

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "")
const buildStreamPath = (baseUrl: string, botId: BotId): string =>
	`${normalizeBaseUrl(baseUrl)}/bots/${botId}/gateway`
const leaseKeyForBot = (botId: BotId): string => `bot-gateway:lease:${botId}`
const sessionId = (): string => crypto.randomUUID()

async function hashToken(token: string): Promise<string> {
	const encoder = new TextEncoder()
	const data = encoder.encode(token)
	const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")
}

const responseText = (response: Response): Promise<string> =>
	response.text().catch(() => `${response.status} ${response.statusText}`)

const getWebSocketRequestMetadata = (request: Request) => ({
	host: request.headers.get("host") ?? undefined,
	origin: request.headers.get("origin") ?? undefined,
	userAgent: request.headers.get("user-agent") ?? undefined,
	forwardedFor: request.headers.get("x-forwarded-for") ?? undefined,
	forwardedProto: request.headers.get("x-forwarded-proto") ?? undefined,
})

const annotateResponseStatus = (status: number) =>
	Effect.all([
		Effect.annotateCurrentSpan("http.status_code", status),
		Effect.annotateCurrentSpan("http.response.status_code", status),
	]).pipe(Effect.asVoid)

const annotateHttpRequest = (route: string, method: string) =>
	Effect.all([
		Effect.annotateCurrentSpan("http.route", route),
		Effect.annotateCurrentSpan("http.method", method),
		Effect.annotateCurrentSpan("http.request.method", method),
	]).pipe(Effect.asVoid)

const annotateErrorType = (errorType: string) => Effect.annotateCurrentSpan("error.type", errorType)

const annotateSessionContext = (options: {
	sessionId?: string
	botId?: BotId
	botName?: string
	resumeOffset?: string
	nextOffset?: string
	resumed?: boolean
	op?: string
}) =>
	Effect.all([
		...(options.sessionId ? [Effect.annotateCurrentSpan("gateway.session_id", options.sessionId)] : []),
		...(options.botId ? [Effect.annotateCurrentSpan("bot.id", options.botId)] : []),
		...(options.botName ? [Effect.annotateCurrentSpan("bot.name", options.botName)] : []),
		...(options.resumeOffset
			? [Effect.annotateCurrentSpan("gateway.resume_offset", options.resumeOffset)]
			: []),
		...(options.nextOffset
			? [Effect.annotateCurrentSpan("gateway.next_offset", options.nextOffset)]
			: []),
		...(options.resumed !== undefined
			? [Effect.annotateCurrentSpan("gateway.resumed", options.resumed)]
			: []),
		...(options.op ? [Effect.annotateCurrentSpan("gateway.op", options.op)] : []),
	]).pipe(Effect.asVoid)

const annotateReconnectReason = (reason: string) =>
	Effect.annotateCurrentSpan("gateway.reconnect_reason", reason)

const decodePayload = (payload: string | BufferSource) => {
	if (typeof payload === "string") {
		return payload
	}
	if (payload instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(payload))
	}
	return new TextDecoder().decode(new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength))
}

const extractGatewayOp = (payload: string | BufferSource): string | undefined => {
	try {
		const raw = JSON.parse(decodePayload(payload)) as { op?: unknown }
		return typeof raw.op === "string" ? raw.op : undefined
	} catch {
		return undefined
	}
}

export class GatewayConfig extends Context.Service<GatewayConfig>()("GatewayConfig", {
	make: Effect.gen(function* () {
		const config = {
			port: yield* Config.Int("PORT").pipe(Config.withDefault(DEFAULT_PORT)),
			isDev: yield* Config.Boolean("IS_DEV").pipe(Config.withDefault(false)),
			databaseUrl: yield* Config.Redacted("DATABASE_URL"),
			durableStreamsUrl: yield* Config.String("DURABLE_STREAMS_URL").pipe(
				Config.withDefault(DEFAULT_DURABLE_STREAMS_URL),
			),
			durableStreamsToken: yield* Config.option(Config.String("DURABLE_STREAMS_TOKEN")),
			heartbeatIntervalMs: yield* Config.Int("GATEWAY_HEARTBEAT_INTERVAL_MS").pipe(
				Config.withDefault(DEFAULT_HEARTBEAT_INTERVAL_MS),
			),
			leaseTtlSeconds: yield* Config.Int("GATEWAY_LEASE_TTL_SECONDS").pipe(
				Config.withDefault(DEFAULT_LEASE_TTL_SECONDS),
			),
			batchAckTimeoutMs: yield* Config.Int("GATEWAY_BATCH_ACK_TIMEOUT_MS").pipe(
				Config.withDefault(DEFAULT_BATCH_ACK_TIMEOUT_MS),
			),
		} as const
		yield* Effect.logInfo("Config loaded", {
			port: config.port,
			durableStreamsUrl: config.durableStreamsUrl,
		})
		return config
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

class GatewayAuthError extends Schema.TaggedError<GatewayAuthError>()("GatewayAuthError", {
	message: Schema.String,
}) {}

class GatewayProtocolError extends Schema.TaggedError<GatewayProtocolError>()("GatewayProtocolError", {
	message: Schema.String,
}) {}

export class GatewayStartupError extends Schema.TaggedError<GatewayStartupError>()("GatewayStartupError", {
	dependency: Schema.Literals(["config", "database", "redis", "tracer", "server"]),
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

class DurableStreamGatewayError extends Schema.TaggedError<DurableStreamGatewayError>()(
	"DurableStreamGatewayError",
	{
		message: Schema.String,
		cause: Schema.Unknown,
	},
) {}

interface GatewayBatch {
	readonly events: ReadonlyArray<Schema.Schema.Type<typeof BotGatewayEnvelope>>
	readonly nextOffset: string
}

interface PendingAck {
	readonly nextOffset: string
	readonly deferred: Deferred.Deferred<void, GatewayProtocolError>
}

interface GatewaySession {
	readonly sessionId: string
	readonly botId: BotId
	readonly botName: string
	currentOffset: string
	socket: ServerWebSocket<{ sessionId: string | null }>
	pendingAck: PendingAck | null
	closed: boolean
}

class DurableStreamClient extends Context.Service<DurableStreamClient>()("DurableStreamClient", {
	make: Effect.gen(function* () {
		const config = yield* GatewayConfig
		const ensuredStreamsRef = yield* Ref.make(new Set<string>())
		const authHeaders: Record<string, string> = Option.isSome(config.durableStreamsToken)
			? { Authorization: `Bearer ${config.durableStreamsToken.value}` }
			: {}

		const ensureStream = Effect.fn("BotGateway.ensureStream")(function* (botId: BotId) {
			const ensured = yield* Ref.get(ensuredStreamsRef)
			if (ensured.has(botId)) {
				return
			}

			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(buildStreamPath(config.durableStreamsUrl, botId), {
						method: "PUT",
						headers: { "Content-Type": "application/json", ...authHeaders },
					}),
				catch: (cause) =>
					new DurableStreamGatewayError({
						message: `Failed to create durable stream for bot ${botId}`,
						cause,
					}),
			})

			if (!response.ok && response.status !== 409) {
				const detail = yield* Effect.promise(() => responseText(response))
				return yield* Effect.fail(
					new DurableStreamGatewayError({
						message: `Failed to create durable stream for bot ${botId}: ${detail}`,
						cause: response.status,
					}),
				)
			}

			yield* Ref.update(ensuredStreamsRef, (current) => {
				const next = new Set(current)
				next.add(botId)
				return next
			})
		})

		const proxyRead = Effect.fn("BotGateway.proxyRead")(function* (botId: BotId, query: URLSearchParams) {
			yield* ensureStream(botId)
			const url = new URL(buildStreamPath(config.durableStreamsUrl, botId))
			for (const [key, value] of query.entries()) {
				url.searchParams.set(key, value)
			}

			const response = yield* Effect.tryPromise({
				try: () =>
					fetch(url, {
						method: "GET",
						headers: { Accept: "application/json", ...authHeaders },
					}),
				catch: (cause) =>
					new DurableStreamGatewayError({
						message: `Failed to read durable stream for bot ${botId}`,
						cause,
					}),
			})

			if (!response.ok) {
				const detail = yield* Effect.promise(() => responseText(response))
				return yield* Effect.fail(
					new DurableStreamGatewayError({
						message: `Failed to read durable stream for bot ${botId}: ${detail}`,
						cause: response.status,
					}),
				)
			}

			return response
		})

		const readBatch = Effect.fn("BotGateway.readBatch")(function* (botId: BotId, offset: string) {
			const query = new URLSearchParams({
				offset,
				live: "long-poll",
			})
			const response = yield* proxyRead(botId, query)
			const payload = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: (cause) =>
					new DurableStreamGatewayError({
						message: `Failed to read durable stream payload for bot ${botId}`,
						cause,
					}),
			})
			const nextOffset = response.headers.get("Stream-Next-Offset") ?? offset

			if (payload.trim().length === 0) {
				return {
					events: [],
					nextOffset,
				} satisfies GatewayBatch
			}

			const raw = yield* Effect.try({
				try: () => JSON.parse(payload) as unknown,
				catch: (cause) =>
					new DurableStreamGatewayError({
						message: `Failed to parse durable stream payload for bot ${botId}`,
						cause,
					}),
			})
			const events = yield* Schema.decodeUnknownEffect(Schema.Array(BotGatewayEnvelope))(raw).pipe(
				Effect.mapError(
					(cause) =>
						new DurableStreamGatewayError({
							message: `Failed to decode durable stream payload for bot ${botId}`,
							cause,
						}),
				),
			)

			return {
				events,
				nextOffset,
			} satisfies GatewayBatch
		})

		return {
			ensureStream,
			proxyRead,
			readBatch,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

class BotGatewayHub extends Context.Service<BotGatewayHub>()("BotGatewayHub", {
	make: Effect.gen(function* () {
		const botRepo = yield* BotRepo
		const redis = yield* Redis
		const durableStreams = yield* DurableStreamClient
		const config = yield* GatewayConfig
		const runtime = (yield* Effect.context<any>()) as Context.Context<never>
		const sessionsRef = yield* Ref.make(new Map<string, GatewaySession>())

		const sendFrame = (
			socket: ServerWebSocket<{ sessionId: string | null }>,
			frame: BotGatewayServerFrame,
		) =>
			Effect.sync(() => {
				socket.send(JSON.stringify(frame))
			})

		const getSession = (id: string) =>
			Ref.get(sessionsRef).pipe(Effect.map((sessions) => sessions.get(id) ?? null))

		const updateSession = (id: string, update: (session: GatewaySession) => GatewaySession) =>
			Ref.update(sessionsRef, (sessions) => {
				const existing = sessions.get(id)
				if (!existing) {
					return sessions
				}
				const next = new Map(sessions)
				next.set(id, update(existing))
				return next
			})

		const deleteSession = (id: string) =>
			Ref.update(sessionsRef, (sessions) => {
				if (!sessions.has(id)) {
					return sessions
				}
				const next = new Map(sessions)
				next.delete(id)
				return next
			})

		const tryClaimLease = Effect.fn("BotGateway.tryClaimLease")(function* (botId: BotId, id: string) {
			const key = leaseKeyForBot(botId)
			const existing = yield* redis.get(key)
			if (existing === id) {
				yield* redis.expire(key, config.leaseTtlSeconds)
				return true
			}
			if (existing !== null) {
				return false
			}

			const result = yield* redis.send<string | null>("SET", [
				key,
				id,
				"EX",
				String(config.leaseTtlSeconds),
				"NX",
			])
			return result === "OK"
		})

		const renewLease = Effect.fn("BotGateway.renewLease")(function* (botId: BotId, id: string) {
			const key = leaseKeyForBot(botId)
			const existing = yield* redis.get(key)
			if (existing !== id) {
				return false
			}
			yield* redis.expire(key, config.leaseTtlSeconds)
			return true
		})

		const releaseLease = Effect.fn("BotGateway.releaseLease")(function* (botId: BotId, id: string) {
			const key = leaseKeyForBot(botId)
			const existing = yield* redis.get(key)
			if (existing === id) {
				yield* redis.del(key)
			}
		})

		const validateBotToken = Effect.fn("BotGateway.validateBotToken")(function* (token: string) {
			const tokenHash = yield* Effect.promise(() => hashToken(token))
			const botOption = yield* botRepo.findByTokenHash(tokenHash)
			if (Option.isNone(botOption)) {
				return yield* Effect.fail(new GatewayAuthError({ message: "Invalid bot token" }))
			}
			return botOption.value
		})

		const parseClientFrame = (payload: string) =>
			Effect.try({
				try: () => Schema.decodeUnknownSync(BotGatewayClientFrame)(JSON.parse(payload)),
				catch: (cause) =>
					new GatewayProtocolError({
						message: `Failed to decode gateway frame: ${String(cause)}`,
					}),
			})

		const startDeliveryLoop = (id: string) =>
			Effect.gen(function* () {
				while (true) {
					const session = yield* getSession(id)
					if (!session || session.closed) {
						return
					}

					yield* Effect.gen(function* () {
						yield* annotateSessionContext({
							sessionId: id,
							botId: session.botId,
							botName: session.botName,
							resumeOffset: session.currentOffset,
						})

						const batch = yield* durableStreams.readBatch(session.botId, session.currentOffset)
						yield* Effect.annotateCurrentSpan("gateway.batch_size", batch.events.length)
						yield* annotateSessionContext({
							sessionId: id,
							botId: session.botId,
							botName: session.botName,
							nextOffset: batch.nextOffset,
						})

						if (batch.events.length === 0) {
							yield* updateSession(id, (current) => ({
								...current,
								currentOffset: batch.nextOffset,
							}))
							return
						}

						const ackDeferred = yield* Deferred.make<void, GatewayProtocolError>()
						yield* updateSession(id, (current) => ({
							...current,
							pendingAck: {
								nextOffset: batch.nextOffset,
								deferred: ackDeferred,
							},
						}))

						yield* sendFrame(session.socket, {
							op: "DISPATCH",
							sessionId: id,
							events: batch.events,
							nextOffset: batch.nextOffset,
						})

						const ackResult = yield* Deferred.await(ackDeferred).pipe(
							Effect.timeoutOrElse({
								orElse: () =>
									Effect.fail(
										new GatewayProtocolError({
											message: `Timed out waiting for ACK from session ${id}`,
										}),
									),
								duration: config.batchAckTimeoutMs,
							}),
						)
						void ackResult
					}).pipe(Effect.withSpan("botGateway.deliveryBatch"))
				}
			}).pipe(
				Effect.catchTags({
					DurableStreamGatewayError: (error: DurableStreamGatewayError) =>
						Effect.gen(function* () {
							yield* annotateErrorType("DurableStreamGatewayError")
							yield* annotateReconnectReason("durable_stream_unavailable")
							yield* Effect.logWarning("Gateway delivery loop failed", { error, sessionId: id })
						}).pipe(
							Effect.andThen(
								Effect.gen(function* () {
									const session = yield* getSession(id)
									if (session) {
										yield* annotateSessionContext({
											sessionId: id,
											botId: session.botId,
											botName: session.botName,
										})
										yield* sendFrame(session.socket, {
											op: "RECONNECT",
											reason: "durable_stream_unavailable",
										})
										yield* Effect.sync(() =>
											session.socket.close(1012, "durable_stream_unavailable"),
										)
									}
								}),
							),
						),
					GatewayProtocolError: (error: GatewayProtocolError) =>
						Effect.gen(function* () {
							yield* annotateErrorType("GatewayProtocolError")
							yield* annotateReconnectReason(error.message)
							yield* Effect.logWarning("Gateway delivery loop protocol failure", {
								error,
								sessionId: id,
							})
						}).pipe(
							Effect.andThen(
								Effect.gen(function* () {
									const session = yield* getSession(id)
									if (session) {
										yield* annotateSessionContext({
											sessionId: id,
											botId: session.botId,
											botName: session.botName,
										})
										yield* sendFrame(session.socket, {
											op: "RECONNECT",
											reason: error.message,
										})
										yield* Effect.sync(() => session.socket.close(1012, error.message))
									}
								}),
							),
						),
				}),
			)

		const identify = Effect.fn("BotGateway.identify")(function* (
			socket: ServerWebSocket<{ sessionId: string | null }>,
			frame: Schema.Schema.Type<typeof BotGatewayIdentifyFrame>,
			resumed: boolean,
			resumeSessionId?: string,
		) {
			const bot = yield* validateBotToken(frame.botToken)
			const id = resumeSessionId ?? sessionId()
			yield* annotateSessionContext({
				sessionId: id,
				botId: bot.id,
				botName: bot.name,
				resumeOffset: frame.resumeOffset,
				resumed,
				op: "IDENTIFY",
			})
			const leaseClaimed = yield* tryClaimLease(bot.id, id)
			if (!leaseClaimed) {
				yield* annotateErrorType("GatewayProtocolError")
				yield* Effect.logWarning("Bot gateway identify rejected", {
					reason: "lease_already_claimed",
					botId: bot.id,
					botName: bot.name,
					sessionId: id,
					resumed,
				})
				yield* sendFrame(socket, {
					op: "INVALID_SESSION",
					reason: "another active session already owns this bot token",
				})
				return
			}

			yield* durableStreams.ensureStream(bot.id)
			const session: GatewaySession = {
				sessionId: id,
				botId: bot.id,
				botName: bot.name,
				currentOffset: frame.resumeOffset,
				socket,
				pendingAck: null,
				closed: false,
			}
			yield* Ref.update(sessionsRef, (sessions) => {
				const next = new Map(sessions)
				next.set(id, session)
				return next
			})
			socket.data.sessionId = id

			yield* sendFrame(socket, {
				op: "READY",
				sessionId: id,
				resumed,
				resumeOffset: frame.resumeOffset,
			})
			yield* Effect.logInfo("Bot gateway session ready", {
				sessionId: id,
				botId: bot.id,
				botName: bot.name,
				resumed,
				resumeOffset: frame.resumeOffset,
			})

			Effect.runForkWith(runtime)(startDeliveryLoop(id))
		})

		const onOpen = (socket: ServerWebSocket<{ sessionId: string | null }>) =>
			Effect.gen(function* () {
				yield* Effect.logInfo("Bot gateway websocket opened")
				yield* sendFrame(socket, {
					op: "HELLO",
					heartbeatIntervalMs: config.heartbeatIntervalMs,
				} satisfies Schema.Schema.Type<typeof BotGatewayHelloFrame>)
			})

		const onMessage = (
			socket: ServerWebSocket<{ sessionId: string | null }>,
			rawPayload: string | BufferSource,
		) =>
			Effect.gen(function* () {
				const frame = yield* parseClientFrame(decodePayload(rawPayload))
				yield* annotateSessionContext({
					sessionId: socket.data.sessionId ?? ("sessionId" in frame ? frame.sessionId : undefined),
					op: frame.op,
				})
				switch (frame.op) {
					case "IDENTIFY": {
						yield* identify(socket, frame, false)
						return
					}
					case "RESUME": {
						yield* identify(
							socket,
							{
								op: "IDENTIFY",
								botToken: frame.botToken,
								resumeOffset: frame.resumeOffset,
							},
							true,
							frame.sessionId,
						)
						return
					}
					case "HEARTBEAT": {
						const id = socket.data.sessionId ?? frame.sessionId ?? null
						if (id) {
							const session = yield* getSession(id)
							if (session) {
								yield* annotateSessionContext({
									sessionId: id,
									botId: session.botId,
									botName: session.botName,
								})
								yield* renewLease(session.botId, id)
							}
						}
						yield* sendFrame(socket, {
							op: "HEARTBEAT_ACK",
							sessionId: id ?? undefined,
						} satisfies Schema.Schema.Type<typeof BotGatewayHeartbeatAckFrame>)
						return
					}
					case "ACK": {
						const session = yield* getSession(frame.sessionId)
						if (!session || session.pendingAck === null) {
							return
						}
						if (session.pendingAck.nextOffset !== frame.nextOffset) {
							return
						}

						yield* annotateSessionContext({
							sessionId: frame.sessionId,
							botId: session.botId,
							botName: session.botName,
							nextOffset: frame.nextOffset,
						})
						yield* updateSession(frame.sessionId, (current) => ({
							...current,
							currentOffset: frame.nextOffset,
							pendingAck: null,
						}))
						yield* Deferred.succeed(session.pendingAck.deferred, undefined)
						return
					}
				}
			}).pipe(
				Effect.catchTags({
					GatewayAuthError: (error) =>
						Effect.gen(function* () {
							yield* annotateErrorType("GatewayAuthError")
							yield* Effect.logWarning("Bot gateway auth rejected", {
								reason: error.message,
								sessionId: socket.data.sessionId ?? undefined,
							})
							yield* sendFrame(socket, {
								op: "INVALID_SESSION",
								reason: error.message,
							})
						}),
					GatewayProtocolError: (error) =>
						Effect.gen(function* () {
							yield* annotateErrorType("GatewayProtocolError")
							yield* Effect.logWarning("Bot gateway protocol rejected", {
								reason: error.message,
								sessionId: socket.data.sessionId ?? undefined,
							})
							yield* sendFrame(socket, {
								op: "INVALID_SESSION",
								reason: error.message,
							})
							yield* Effect.sync(() => socket.close(1008, error.message))
						}),
				}),
			)

		const onClose = (socket: ServerWebSocket<{ sessionId: string | null }>) =>
			Effect.gen(function* () {
				const id = socket.data.sessionId
				if (!id) {
					return
				}
				const session = yield* getSession(id)
				if (!session) {
					return
				}

				yield* annotateSessionContext({
					sessionId: id,
					botId: session.botId,
					botName: session.botName,
				})
				yield* Effect.logInfo("Bot gateway websocket closed", {
					sessionId: id,
					botId: session.botId,
					botName: session.botName,
				})
				session.closed = true
				if (session.pendingAck) {
					yield* Deferred.fail(
						session.pendingAck.deferred,
						new GatewayProtocolError({
							message: `Session ${id} closed before ACK`,
						}),
					).pipe(Effect.catch(() => Effect.void))
				}
				yield* releaseLease(session.botId, id).pipe(Effect.catch(() => Effect.void))
				yield* deleteSession(id)
			})

		return {
			onOpen,
			onMessage,
			onClose,
			validateBotToken,
			proxyRead: durableStreams.proxyRead,
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

const DatabaseLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* GatewayConfig
		return Database.layer({
			url: config.databaseUrl,
			ssl: !config.isDev,
		})
	}),
)

const ConfigProviderLive = ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))

type StartupDependency = "config" | "database" | "redis" | "tracer" | "server"

const makeStartupError = (dependency: StartupDependency, message: string, cause?: unknown) =>
	new GatewayStartupError({
		dependency,
		message,
		cause,
	})

export const instrumentStartupLayer = <ROut, E, RIn>(
	layer: Layer.Layer<ROut, E, RIn>,
	options: {
		readonly dependency: StartupDependency
		readonly startMessage: string
		readonly successMessage: string
		readonly successLogs?: (context: Context.Context<ROut>) => Record<string, unknown>
		readonly failureMessage: string
	},
) =>
	Layer.unwrap(
		Effect.logInfo(options.startMessage).pipe(
			Effect.as(
				layer.pipe(
					Layer.tap((context) => {
						const logs = options.successLogs?.(context)
						return logs
							? Effect.logInfo(options.successMessage, logs)
							: Effect.logInfo(options.successMessage)
					}),
					Layer.tapCause((cause) =>
						Effect.logError(options.failureMessage, {
							dependency: options.dependency,
							cause: Cause.pretty(cause),
						}),
					),
					Layer.catchCause((cause) =>
						Layer.effectDiscard(
							Effect.fail(
								makeStartupError(
									options.dependency,
									options.failureMessage,
									Cause.squash(cause),
								),
							),
						),
					),
				),
			),
		),
	)

export const InstrumentedConfigLive = instrumentStartupLayer(GatewayConfig.layer, {
	dependency: "config",
	startMessage: "Loading gateway startup config...",
	successMessage: "Gateway startup config loaded",
	successLogs: (context) => {
		const config = Context.get(context, GatewayConfig)
		return {
			port: config.port,
			durableStreamsUrl: config.durableStreamsUrl,
			websocketPath: "/bot-gateway/ws",
		}
	},
	failureMessage: "Failed to load gateway startup config",
})

export const InstrumentedDatabaseLive = instrumentStartupLayer(
	DatabaseLive.pipe(Layer.provide(InstrumentedConfigLive)),
	{
		dependency: "database",
		startMessage: "Initializing bot gateway database layer...",
		successMessage: "Bot gateway database layer initialized",
		failureMessage: "Bot gateway database layer initialization failed",
	},
)

export const InstrumentedRedisLive = instrumentStartupLayer(Redis.Default, {
	dependency: "redis",
	startMessage: "Initializing bot gateway Redis layer...",
	successMessage: "Bot gateway Redis layer initialized",
	failureMessage: "Bot gateway Redis layer initialization failed",
})

export const InstrumentedTracerLive = instrumentStartupLayer(TracerLive, {
	dependency: "tracer",
	startMessage: "Initializing bot gateway tracer layer...",
	successMessage: "Bot gateway tracer layer initialized",
	failureMessage: "Bot gateway tracer layer initialization failed",
})

const RepoLive = Layer.mergeAll(BotRepo.layer).pipe(Layer.provide(InstrumentedDatabaseLive))
const DurableStreamClientLive = DurableStreamClient.layer.pipe(Layer.provide(InstrumentedConfigLive))
const BotGatewayHubLive = BotGatewayHub.layer.pipe(
	Layer.provideMerge(InstrumentedConfigLive),
	Layer.provideMerge(InstrumentedRedisLive),
	Layer.provideMerge(RepoLive),
	Layer.provideMerge(DurableStreamClientLive),
)

export const MainLive = Layer.mergeAll(
	InstrumentedConfigLive,
	InstrumentedDatabaseLive,
	RepoLive,
	InstrumentedRedisLive,
	DurableStreamClientLive,
	BotGatewayHubLive,
	InstrumentedTracerLive,
).pipe(Layer.provideMerge(ConfigProviderLive))

type GatewayServe = (options: any) => {
	readonly port?: number
	stop: (closeActiveConnections?: boolean) => void
}

export const createGatewayServer = (options: {
	readonly config: (typeof GatewayConfig)["Service"]
	readonly hub: (typeof BotGatewayHub)["Service"]
	readonly runtime: Context.Context<never>
	readonly serve?: GatewayServe
}) =>
	Effect.gen(function* () {
		const {
			config,
			hub,
			runtime,
			serve = (serveOptions) => Bun.serve<{ sessionId: string | null }>(serveOptions),
		} = options

		const handleStreamProxyRequest = (request: Request, url: URL) =>
			Effect.gen(function* () {
				yield* annotateHttpRequest("/bot-gateway/stream", request.method)
				const authHeader = request.headers.get("Authorization")
				if (!authHeader || !authHeader.startsWith("Bearer ")) {
					yield* annotateErrorType("GatewayAuthError")
					yield* annotateResponseStatus(401)
					return new Response("Missing bot token", { status: 401 })
				}
				const bot = yield* hub.validateBotToken(authHeader.slice(7))
				yield* annotateSessionContext({
					botId: bot.id,
					botName: bot.name,
				})
				const upstream = yield* hub.proxyRead(bot.id, url.searchParams)
				const body = yield* Effect.promise(() => upstream.text())
				yield* annotateResponseStatus(upstream.status)
				return new Response(body, {
					status: upstream.status,
					headers: upstream.headers,
				})
			}).pipe(
				Effect.catchTag("GatewayAuthError", (error) =>
					Effect.gen(function* () {
						yield* annotateErrorType("GatewayAuthError")
						yield* annotateResponseStatus(401)
						return new Response(error.message, { status: 401 })
					}),
				),
				Effect.catchTag("DurableStreamGatewayError", (error) =>
					Effect.gen(function* () {
						yield* annotateErrorType("DurableStreamGatewayError")
						yield* annotateResponseStatus(503)
						return new Response(error.message, { status: 503 })
					}),
				),
				Effect.withSpan("botGateway.http.streamProxy"),
				Effect.annotateLogs({
					route: "/bot-gateway/stream",
					method: request.method,
				}),
			)

		yield* Effect.logInfo("Binding bot gateway server...", {
			port: config.port,
			websocketPath: "/bot-gateway/ws",
		})

		const server = yield* Effect.acquireRelease(
			Effect.try({
				try: () =>
					serve({
						port: config.port,
						fetch(request: Request, server: any) {
							const url = new URL(request.url)
							if (request.method === "GET" && url.pathname === "/health") {
								return new Response("OK")
							}

							if (request.method === "GET" && url.pathname === "/bot-gateway/ws") {
								return Effect.runPromiseWith(runtime)(
									Effect.gen(function* () {
										yield* annotateHttpRequest("/bot-gateway/ws", request.method)
										yield* Effect.logInfo(
											"Bot gateway websocket upgrade requested",
											getWebSocketRequestMetadata(request),
										)
										if (server.upgrade(request, { data: { sessionId: null } })) {
											yield* Effect.logInfo("Bot gateway websocket upgrade accepted")
											return undefined
										}
										yield* annotateErrorType("WebSocketUpgradeError")
										yield* Effect.logWarning(
											"Bot gateway websocket upgrade failed",
											getWebSocketRequestMetadata(request),
										)
										yield* annotateResponseStatus(400)
										return new Response("Failed to upgrade websocket", { status: 400 })
									}).pipe(
										Effect.withSpan("botGateway.http.websocketUpgrade"),
										Effect.annotateLogs({
											route: "/bot-gateway/ws",
											method: request.method,
										}),
									),
								)
							}

							if (request.method === "GET" && url.pathname === "/bot-gateway/stream") {
								return Effect.runPromiseWith(runtime)(handleStreamProxyRequest(request, url))
							}

							return new Response("Not found", { status: 404 })
						},
						websocket: {
							open(socket: ServerWebSocket<{ sessionId: string | null }>) {
								Effect.runForkWith(runtime)(
									Effect.gen(function* () {
										yield* Effect.annotateCurrentSpan("http.route", "/bot-gateway/ws")
										yield* hub.onOpen(socket)
									}).pipe(
										Effect.withSpan("botGateway.websocket.open"),
										Effect.annotateLogs({ route: "/bot-gateway/ws" }),
									),
								)
							},
							message(
								socket: ServerWebSocket<{ sessionId: string | null }>,
								message: string | BufferSource,
							) {
								const op = extractGatewayOp(message)
								Effect.runForkWith(runtime)(
									Effect.gen(function* () {
										yield* Effect.annotateCurrentSpan("http.route", "/bot-gateway/ws")
										yield* annotateSessionContext({
											sessionId: socket.data.sessionId ?? undefined,
											op,
										})
										yield* hub.onMessage(socket, message)
									}).pipe(
										Effect.withSpan("botGateway.websocket.message"),
										Effect.annotateLogs({
											route: "/bot-gateway/ws",
											op,
										}),
									),
								)
							},
							close(socket: ServerWebSocket<{ sessionId: string | null }>) {
								Effect.runForkWith(runtime)(
									Effect.gen(function* () {
										yield* Effect.annotateCurrentSpan("http.route", "/bot-gateway/ws")
										yield* annotateSessionContext({
											sessionId: socket.data.sessionId ?? undefined,
										})
										yield* hub.onClose(socket)
									}).pipe(
										Effect.withSpan("botGateway.websocket.close"),
										Effect.annotateLogs({ route: "/bot-gateway/ws" }),
									),
								)
							},
						},
					}),
				catch: (cause) => makeStartupError("server", "Bot gateway server bind failed", cause),
			}),
			(server) => Effect.sync(() => server.stop(true)),
		)

		yield* Effect.logInfo("Bot gateway listening", {
			port: server.port ?? config.port,
			websocketPath: "/bot-gateway/ws",
		})

		return server
	})

export const makeProgram = (options?: {
	readonly serve?: GatewayServe
	readonly mainLive?: Layer.Layer<any, any, never>
}) =>
	Effect.gen(function* () {
		const config = yield* GatewayConfig
		const hub = yield* BotGatewayHub
		const runtime = (yield* Effect.context<any>()) as Context.Context<never>

		yield* createGatewayServer({
			config,
			hub,
			runtime,
			serve: options?.serve,
		})

		return yield* Effect.never
	}).pipe(Effect.scoped, Effect.provide(options?.mainLive ?? MainLive))

export const program = makeProgram()
if (import.meta.main) {
	BunRuntime.runMain(program as Effect.Effect<never, unknown, never>)
}
