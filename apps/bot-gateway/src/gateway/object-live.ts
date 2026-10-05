/**
 * The `BotGateway` Durable Object: one per bot. It owns the bot's append-only event log (SQLite)
 * and its single WebSocket session (hibernatable, opened by the gateway Worker's relay once the
 * bot is authenticated, see `relay.ts`).
 *
 * - `publish` (RPC, from the backend) appends an event and dispatches it if the session is idle.
 * - The session gets one DISPATCH batch at a time; its ACK advances the cursor, trims the log and
 *   sends the next batch. An ACK not received within the batch timeout ends the session with
 *   RECONNECT (an alarm enforces it), and the bot resumes from its last acknowledged offset.
 * - Session state (cursor, in-flight batch) lives in the socket attachment, so it survives
 *   hibernation and dies with the socket. The log lives in SQLite and survives everything.
 *
 * Offset, ACK, admission and retention rules are in `log.ts`.
 */
import {
	BotGatewayClientFrame,
	BotGatewayEnvelope,
	BotGatewayEventRejectedError,
	type BotGatewayHeartbeatAckFrame,
	type BotGatewayInvalidSessionFrame,
	type BotGatewayPublishResult,
	type BotGatewayReadyFrame,
	type BotGatewayReconnectFrame,
} from "@hazel/domain"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Option, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { BotGatewayObject } from "../object.ts"
import * as Store from "./event-store.ts"
import { decodeHandshake } from "./handshake.ts"
import {
	DEFAULT_BATCH_LIMITS,
	DEFAULT_RETENTION,
	decideAdmission,
	encodeDispatchFrame,
	evaluateAck,
	formatOffset,
	nextAlarmAt,
	parseResumeOffset,
	resolveCursor,
	selectBatch,
	type SessionCursor,
} from "./log.ts"
import { readGatewaySettings } from "./settings.ts"

/** Persisted on the session's socket (`serializeAttachment`, 2 KiB max). */
interface SessionAttachment extends SessionCursor {
	readonly v: 1
	readonly botId: string
	readonly botName: string
}

const isSessionAttachment = (value: unknown): value is SessionAttachment =>
	typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1

/** The workerd socket calls this object makes (a subset of `WebSocket`). */
interface RawSocket {
	readonly readyState: number
	send(data: string): void
	close(code?: number, reason?: string): void
	serializeAttachment(value: unknown): void
	deserializeAttachment(): unknown
}

interface LiveSession {
	readonly socket: RawSocket
	readonly session: SessionAttachment
}

const WEBSOCKET_OPEN = 1

const decodeEnvelope = Schema.decodeUnknownEffect(BotGatewayEnvelope)
const decodeClientFrame = Schema.decodeUnknownOption(BotGatewayClientFrame)

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text)
	} catch {
		return undefined
	}
}

const sendFrame = (socket: RawSocket, frame: object | string) => {
	try {
		socket.send(typeof frame === "string" ? frame : JSON.stringify(frame))
	} catch {
		// The socket is closing; its close event ends the session.
	}
}

const closeSocket = (socket: RawSocket, code: number, reason: string) => {
	try {
		socket.close(code, reason)
	} catch {
		// Already closed.
	}
}

const invalidSession = (socket: RawSocket, reason: string) => {
	sendFrame(socket, { op: "INVALID_SESSION", reason } satisfies typeof BotGatewayInvalidSessionFrame.Type)
	closeSocket(socket, 1008, reason.slice(0, 120))
}

/** The activation, in alchemy's two phases; the outer one also runs at plan time, against a mock. */
export const activateBotGateway = Effect.gen(function* () {
	const state = yield* Cloudflare.DurableObjectState
	const env = yield* Cloudflare.WorkerEnvironment

	return Effect.gen(function* () {
		const raw = state.raw
		const sql = raw.storage.sql as unknown as Store.SqlStorageLike
		const settings = readGatewaySettings(env)
		yield* Effect.sync(() => Store.migrate(sql))

		const liveSessions = (): Array<LiveSession> =>
			(raw.getWebSockets() as unknown as Array<RawSocket>).flatMap((socket) => {
				if (socket.readyState !== WEBSOCKET_OPEN) return []
				const session = socket.deserializeAttachment()
				return isSessionAttachment(session) ? [{ socket, session }] : []
			})

		/** Send the next batch if nothing is in flight; returns the session's new state. */
		const deliver = (socket: RawSocket, session: SessionAttachment, now: number): SessionAttachment => {
			if (session.pending !== null) return session
			const batch = selectBatch(Store.readAfter(sql, session.cursor, DEFAULT_BATCH_LIMITS.maxEvents))
			const last = batch[batch.length - 1]
			if (last === undefined) return session
			const next: SessionAttachment = {
				...session,
				pending: last.seq,
				pendingDeadline: now + settings.batchAckTimeoutMs,
			}
			socket.serializeAttachment(next)
			sendFrame(socket, encodeDispatchFrame(session.sessionId, batch))
			return next
		}

		/** Arm the single native alarm for the earliest ACK deadline or retention expiry. */
		const scheduleAlarm = Effect.promise(async () => {
			const target = nextAlarmAt(
				liveSessions().flatMap(({ session }) =>
					session.pendingDeadline === null ? [] : [session.pendingDeadline],
				),
				Store.oldestAppendedAt(sql),
				DEFAULT_RETENTION,
			)
			if (target === undefined) return
			const current = await raw.storage.getAlarm()
			if (current === null || current > target) await raw.storage.setAlarm(target)
		})

		const publish = (eventJson: string) =>
			Effect.gen(function* () {
				const parsed = parseJson(eventJson)
				if (parsed === undefined) {
					return yield* new BotGatewayEventRejectedError({ message: "Event is not valid JSON" })
				}
				const envelope = yield* decodeEnvelope(parsed).pipe(
					Effect.mapError(
						(issue) =>
							new BotGatewayEventRejectedError({ message: `Invalid event envelope: ${issue}` }),
					),
				)
				const now = Date.now()
				const seq = Store.append(sql, eventJson, now)
				Store.enforceRetention(sql, now, DEFAULT_RETENTION)
				for (const { socket, session } of liveSessions()) deliver(socket, session, now)
				yield* scheduleAlarm
				yield* Effect.annotateCurrentSpan({
					"bot_gateway.offset": seq,
					"bot_gateway.event_type": envelope.eventType,
				})
				return { offset: formatOffset(seq) } satisfies BotGatewayPublishResult
			}).pipe(Effect.withSpan("BotGateway.publish"))

		const fetch = Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest
			const handshake = decodeHandshake(request.headers)
			if (handshake === undefined) {
				return HttpServerResponse.text("Invalid gateway handshake", { status: 400 })
			}
			if (request.headers.upgrade?.toLowerCase() !== "websocket") {
				return HttpServerResponse.text("Expected a WebSocket upgrade", { status: 426 })
			}

			const live = liveSessions()
			const admission = decideAdmission(live[0]?.session, handshake.request)
			if (admission._tag === "Reject") {
				yield* Effect.logInfo("Bot gateway session rejected", {
					botId: handshake.botId,
					reason: admission.reason,
				})
				return HttpServerResponse.jsonUnsafe({ reason: admission.reason }, { status: 409 })
			}
			if (admission._tag === "Replace") {
				for (const { socket } of live) invalidSession(socket, "session resumed by another connection")
			}

			const now = Date.now()
			const { request: sessionRequest } = handshake
			const session: SessionAttachment = {
				v: 1,
				sessionId: sessionRequest.op === "RESUME" ? sessionRequest.sessionId : crypto.randomUUID(),
				botId: handshake.botId,
				botName: handshake.botName,
				cursor: resolveCursor(parseResumeOffset(sessionRequest.resumeOffset), Store.bounds(sql)),
				pending: null,
				pendingDeadline: null,
			}
			const [response, socket] = yield* Cloudflare.upgrade()
			const rawSocket = socket.ws as unknown as RawSocket
			rawSocket.serializeAttachment(session)
			sendFrame(rawSocket, {
				op: "READY",
				sessionId: session.sessionId,
				resumed: sessionRequest.op === "RESUME",
				resumeOffset: sessionRequest.resumeOffset,
			} satisfies typeof BotGatewayReadyFrame.Type)
			deliver(rawSocket, session, now)
			yield* scheduleAlarm
			yield* Effect.logInfo("Bot gateway session ready", {
				sessionId: session.sessionId,
				botId: session.botId,
				botName: session.botName,
				resumed: sessionRequest.op === "RESUME",
				resumeOffset: sessionRequest.resumeOffset,
				cursor: formatOffset(session.cursor),
			})
			return response
		}).pipe(Effect.withSpan("BotGateway.connect"))

		const webSocketMessage = (socket: Cloudflare.WebSocket, message: string | ArrayBuffer) =>
			Effect.gen(function* () {
				const rawSocket = socket.ws as unknown as RawSocket
				const session = rawSocket.deserializeAttachment()
				if (!isSessionAttachment(session)) {
					closeSocket(rawSocket, 1011, "session_state_lost")
					return
				}
				const text = typeof message === "string" ? message : new TextDecoder().decode(message)
				const frame = Option.getOrUndefined(decodeClientFrame(parseJson(text)))
				if (frame === undefined) return invalidSession(rawSocket, "Failed to decode gateway frame")

				switch (frame.op) {
					case "ACK": {
						const outcome = evaluateAck(session, frame)
						if (outcome._tag === "Ignored") {
							yield* Effect.logDebug("Bot gateway ACK ignored", {
								sessionId: session.sessionId,
								reason: outcome.reason,
							})
							return
						}
						Store.trimThrough(sql, outcome.cursor)
						const acked: SessionAttachment = {
							...session,
							cursor: outcome.cursor,
							pending: null,
							pendingDeadline: null,
						}
						rawSocket.serializeAttachment(acked)
						deliver(rawSocket, acked, Date.now())
						yield* scheduleAlarm
						return
					}
					case "HEARTBEAT": {
						// The relay answers heartbeats; this covers a client reaching the object directly.
						sendFrame(rawSocket, {
							op: "HEARTBEAT_ACK",
							sessionId: session.sessionId,
						} satisfies typeof BotGatewayHeartbeatAckFrame.Type)
						return
					}
					case "IDENTIFY":
					case "RESUME":
						return invalidSession(rawSocket, "session already identified")
				}
			})

		const webSocketClose = (socket: Cloudflare.WebSocket, code: number, reason: string) =>
			Effect.gen(function* () {
				const session = socket.deserializeAttachment<SessionAttachment>()
				yield* Effect.logInfo("Bot gateway websocket closed", {
					sessionId: session?.sessionId,
					botId: session?.botId,
					code,
					reason,
				})
				// An unacknowledged batch is not lost: the bot resumes from its last ACK.
				closeSocket(socket.ws as unknown as RawSocket, 1000, "closed")
			})

		const alarm = () =>
			Effect.gen(function* () {
				const now = Date.now()
				for (const { socket, session } of liveSessions()) {
					if (session.pendingDeadline !== null && session.pendingDeadline <= now) {
						const reason = `Timed out waiting for ACK from session ${session.sessionId}`
						yield* Effect.logWarning("Bot gateway ACK timed out", {
							sessionId: session.sessionId,
							botId: session.botId,
						})
						sendFrame(socket, {
							op: "RECONNECT",
							reason,
						} satisfies typeof BotGatewayReconnectFrame.Type)
						closeSocket(socket, 1012, reason)
					}
				}
				Store.enforceRetention(sql, now, DEFAULT_RETENTION)
				yield* scheduleAlarm
			})

		return { publish, fetch, webSocketMessage, webSocketClose, alarm }
	})
})

/** The implementation, as the layer the host Worker provides. */
export const BotGatewayObjectLive = BotGatewayObject.make(activateBotGateway)
