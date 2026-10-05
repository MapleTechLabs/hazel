/**
 * Hazel Bot SDK - Convenience layer for Hazel chat app integrations
 *
 * This module provides a simplified, Hazel-specific API on top of the websocket gateway runtime.
 * Hazel message, channel, membership, and command events are pre-configured.
 */

import { HttpApiClient } from "effect/http-api"
import { FetchHttpClient } from "effect/http"
import type {
	AttachmentId,
	BotId,
	ChannelId,
	ChannelMemberId,
	MessageId,
	OrganizationId,
	TypingIndicatorId,
	UserId,
} from "@hazel/schema"
import {
	ACTOR_SERVICE_ERROR_BOT_MESSAGE,
	BotGatewayAckFrame,
	BotGatewayClientFrame,
	BotGatewayDispatchFrame,
	BotGatewayEnvelope,
	BotGatewayHeartbeatFrame,
	BotGatewayHelloFrame,
	BotGatewayInvalidSessionFrame,
	BotGatewayReadyFrame,
	BotGatewayReconnectFrame,
	BotGatewayResumeFrame,
	BotGatewayServerFrame,
	isTemporaryActorServiceError,
} from "@hazel/domain"
import type { IntegrationConnection } from "@hazel/domain/models"
import {
	CreateMessageRequest,
	HazelApi,
	SyncBotCommandsRequest,
	ToggleReactionRequest,
	UpdateBotSettingsRequest,
	UpdateMessageRequest,
} from "@hazel/domain/http"
import { Channel, ChannelMember, Message } from "@hazel/domain/models"
import { createTracingLayer } from "@hazel/effect-bun/Telemetry"
import {
	Cache,
	Config,
	Duration,
	Effect,
	Layer,
	LogLevel,
	ManagedRuntime,
	Option,
	Redacted,
	Ref,
	Schema,
	Semaphore,
	Context,
} from "effect"
import { BotAuth, createAuthContextFromToken } from "./auth.ts"
import { createLoggerLayer, logLevelFromString, type BotLogConfig, type LogFormat } from "./log-config.ts"
import { createCommandLogContext, withLogContext, type BotIdentity } from "./log-context.ts"
import {
	CommandGroup,
	EmptyCommandGroup,
	type CommandDef,
	type EmptyCommands,
	type TypedCommandContext,
} from "./command.ts"
import {
	CommandArgsDecodeError,
	CommandHandlerError,
	CommandSyncError,
	EventHandlerError,
	GatewayDecodeError,
	GatewayReadError,
	GatewaySessionStoreError,
	MentionableSyncError,
	MessageDeleteError,
	MessageListError,
	MessageReactError,
	MessageReplyError,
	MessageSendError,
	MessageUpdateError,
} from "./errors.ts"
import {
	BotStateStoreTag,
	InMemoryBotStateStoreLive,
	InMemoryGatewaySessionStoreLive,
	GatewaySessionStoreTag,
	createGatewayWebSocketUrl,
} from "./gateway.ts"
import { BotRpcClient, BotRpcClientConfigTag, BotRpcClientLive } from "./rpc/client.ts"
import { BotHealthServerLive } from "./services/health-server.ts"
import { createActorsClient } from "@hazel/actors/client"
import {
	BotNotConfiguredError,
	createAIStreamSessionInternal,
	createStreamSessionInternal,
	type ActorsClientService,
	type AIStreamOptions,
	type AIStreamSession,
	type CreateStreamOptions,
	type MessageCreateFn,
	type MessageUpdateFn,
} from "./streaming/index.ts"

const DEFAULT_ACTORS_ENDPOINT = "https://rivet.hazel.sh"
const GENERIC_COMMAND_ERROR_MESSAGE = "An unexpected error occurred. Please try again."
const GATEWAY_SESSION_ID_STATE_KEY = "gateway_session_id"

/**
 * Internal configuration context for HazelBotClient
 * Contains commands to sync and backend URL for HTTP calls
 */
export interface HazelBotRuntimeConfig<Commands extends CommandGroup<any> = CommandGroup<any>> {
	readonly backendUrl: string
	readonly gatewayUrl: string
	readonly botToken: string
	readonly commands: Commands
	readonly mentionable: boolean
	readonly actorsEndpoint: string
	readonly resumeOffset: string
	readonly maxConcurrentPartitions: number
	readonly heartbeatIntervalMs?: number
}

export class HazelBotRuntimeConfigTag extends Context.Service<
	HazelBotRuntimeConfigTag,
	HazelBotRuntimeConfig
>()("@hazel/bot-sdk/HazelBotRuntimeConfig") {}

/**
 * Hazel-specific type aliases for convenience
 */
export type MessageType = Schema.Schema.Type<typeof Message.Schema>
export type ChannelType = Schema.Schema.Type<typeof Channel.Schema>
export type ChannelMemberType = Schema.Schema.Type<typeof ChannelMember.Schema>

/**
 * Hazel-specific event handlers
 */
export type MessageHandler<E = EventHandlerError, R = never> = (
	message: MessageType,
) => Effect.Effect<void, E, R>
export type ChannelHandler<E = EventHandlerError, R = never> = (
	channel: ChannelType,
) => Effect.Effect<void, E, R>
export type ChannelMemberHandler<E = EventHandlerError, R = never> = (
	member: ChannelMemberType,
) => Effect.Effect<void, E, R>

/**
 * Typed command handler - receives CommandContext with typed args
 */
export type CommandHandler<Args, E = CommandHandlerError, R = never> = (
	ctx: TypedCommandContext<Args>,
) => Effect.Effect<void, E, R>

/**
 * Handler for when the bot is @mentioned in a message
 */
export type MentionHandler<E = EventHandlerError, R = never> = (
	message: MessageType,
) => Effect.Effect<void, E, R>

// Re-export command types for convenience
export {
	Command,
	CommandGroup,
	type CommandDef,
	type CommandNames,
	type TypedCommandContext,
} from "./command.ts"

/**
 * Options for sending a message
 */
export interface SendMessageOptions {
	/** Reply to a specific message */
	readonly replyToMessageId?: MessageId | null
	/** Send message in a thread */
	readonly threadChannelId?: ChannelId | null
	/** Attachment IDs to include */
	readonly attachmentIds?: readonly AttachmentId[]
	/** Embeds to include (rich content, live state, etc.) */
	readonly embeds?: import("@hazel/domain/models").MessageEmbed.MessageEmbeds | null
}

/**
 * Hazel Bot Client - Effect Service with typed convenience methods
 * Uses scoped: since it manages scoped resources (RateLimiter)
 */
export class HazelBotClient extends Context.Service<HazelBotClient>()("HazelBotClient", {
	make: Effect.gen(function* () {
		const auth = yield* BotAuth
		// Get the RPC client from context
		const rpc = yield* BotRpcClient
		// Get the RPC client config (for HTTP API calls)
		const rpcClientConfig = yield* BotRpcClientConfigTag
		// Create typed HTTP API client for public API endpoints
		const httpApiClient = yield* HttpApiClient.make(HazelApi, {
			baseUrl: rpcClientConfig.backendUrl,
		}).pipe(
			Effect.provide(
				FetchHttpClient.layer.pipe(
					Layer.provide(
						Layer.succeed(FetchHttpClient.RequestInit, {
							headers: { Authorization: `Bearer ${rpcClientConfig.botToken}` },
						}),
					),
				),
			),
		)
		// Get auth context (contains botId, botName, userId for message authoring)
		const authContext = yield* auth.getContext.pipe(Effect.orDie)

		// Create bot identity for log context
		const botIdentity: BotIdentity = {
			botId: authContext.botId,
			botName: authContext.botName,
		}

		// Create semaphore for outbound message operations
		// Limit to 10 concurrent requests to prevent API rate limiting
		const messageSemaphore = Semaphore.makeUnsafe(10)
		const messageLimiter = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			Semaphore.withPermit(messageSemaphore)(effect)

		// Get the runtime config (optional - contains commands to sync)
		const runtimeConfigOption = yield* Effect.serviceOption(HazelBotRuntimeConfigTag)
		const gatewaySessionStore = yield* GatewaySessionStoreTag
		const botStateStore = yield* BotStateStoreTag

		// Command handler registry - stores handlers keyed by command name
		// biome-ignore lint/suspicious/noExplicitAny: handlers are typed at registration, stored loosely
		const commandHandlers = new Map<
			string,
			(ctx: TypedCommandContext<any>) => Effect.Effect<void, any, any>
		>()

		// Mention handler registry - uses Ref for safe mutable state
		// biome-ignore lint/suspicious/noExplicitAny: handlers are typed at registration, stored loosely
		type MentionHandlerFn = (message: MessageType) => Effect.Effect<void, any, any>
		const mentionHandlersRef = yield* Ref.make<Array<MentionHandlerFn>>([])
		// biome-ignore lint/suspicious/noExplicitAny: event handlers are typed at registration, stored loosely
		type MessageHandlerFn = (message: MessageType) => Effect.Effect<void, any, any>
		type ChannelHandlerFn = (channel: ChannelType) => Effect.Effect<void, any, any>
		type ChannelMemberHandlerFn = (member: ChannelMemberType) => Effect.Effect<void, any, any>
		const messageHandlersRef = yield* Ref.make<Array<MessageHandlerFn>>([])
		const messageUpdateHandlersRef = yield* Ref.make<Array<MessageHandlerFn>>([])
		const messageDeleteHandlersRef = yield* Ref.make<Array<MessageHandlerFn>>([])
		const channelCreatedHandlersRef = yield* Ref.make<Array<ChannelHandlerFn>>([])
		const channelUpdatedHandlersRef = yield* Ref.make<Array<ChannelHandlerFn>>([])
		const channelDeletedHandlersRef = yield* Ref.make<Array<ChannelHandlerFn>>([])
		const channelMemberAddedHandlersRef = yield* Ref.make<Array<ChannelMemberHandlerFn>>([])
		const channelMemberRemovedHandlersRef = yield* Ref.make<Array<ChannelMemberHandlerFn>>([])

		// Helper to extract user mentions from content
		// Mention format: @[userId:USER_ID]
		const MENTION_PATTERN = /@\[userId:([^\]]+)\]/g
		const extractUserMentions = (content: string): string[] =>
			[...content.matchAll(MENTION_PATTERN)].map((m) => m[1]).filter(Boolean)

		// Get mentionable flag from runtime config
		const mentionableEnabled = Option.match(runtimeConfigOption, {
			onNone: () => false,
			onSome: (c) => c.mentionable ?? false,
		})

		// Cache for enabled integrations (30s TTL, max 100 entries)
		const enabledIntegrationsCache = yield* Cache.make({
			capacity: 100,
			timeToLive: Duration.seconds(30),
			lookup: (orgId: OrganizationId) =>
				httpApiClient["bot-commands"].getEnabledIntegrations({ params: { orgId } }).pipe(
					Effect.map((r) => new Set(r.providers)),
					Effect.withSpan("bot.integration.getEnabled", { attributes: { orgId } }),
				),
		})

		const getGatewayRuntimeConfig = () =>
			Option.match(runtimeConfigOption, {
				onNone: () => null,
				onSome: (config) => config,
			})

		const getBotState = <A>(key: string, schema: Schema.Schema<A>) =>
			botStateStore.get(authContext.botId as BotId, key).pipe(
				Effect.flatMap((value) =>
					value === null
						? Effect.succeed(null)
						: Effect.try({
								try: () => JSON.parse(value) as unknown,
								catch: (cause) =>
									new GatewayDecodeError({
										message: `Failed to parse bot state for key ${key}`,
										payload: value,
										cause,
									}),
							}).pipe(
								Effect.flatMap((parsed) =>
									Schema.decodeUnknownEffect(schema)(parsed).pipe(
										Effect.mapError(
											(cause) =>
												new GatewayDecodeError({
													message: `Failed to decode bot state for key ${key}`,
													payload: value,
													cause,
												}),
										),
									),
								),
								Effect.map((decoded) => decoded as A | null),
							),
				),
			)

		const setBotState = <A>(key: string, schema: Schema.Schema<A>, value: A) =>
			Schema.encodeEffect(schema)(value).pipe(
				Effect.flatMap((encoded) =>
					botStateStore.set(authContext.botId as BotId, key, JSON.stringify(encoded)),
				),
			)

		const deleteBotState = (key: string) => botStateStore.delete(authContext.botId as BotId, key)

		const mapCommandHandlerError = (commandName: string, cause: unknown): CommandHandlerError =>
			new CommandHandlerError({
				message: `Command handler failed for /${commandName}`,
				commandName,
				cause,
			})

		const mapEventHandlerError = (eventType: string, cause: unknown): EventHandlerError =>
			new EventHandlerError({
				message: `Gateway handler failed for ${eventType}`,
				eventType,
				cause,
			})

		const runGatewayHandlers = <A>(
			handlers: ReadonlyArray<(value: A) => Effect.Effect<void, any, any>>,
			value: A,
			eventType: string,
		) =>
			Effect.forEach(
				handlers,
				(handler) =>
					handler(value).pipe(Effect.mapError((cause) => mapEventHandlerError(eventType, cause))),
				{ discard: true },
			)

		const runMentionHandlers = (message: MessageType) =>
			Effect.gen(function* () {
				if (!mentionableEnabled) {
					return
				}

				const handlers = yield* Ref.get(mentionHandlersRef)
				if (handlers.length === 0) {
					return
				}

				if (message.authorId === authContext.userId) {
					return
				}

				const mentions = extractUserMentions(message.content)
				if (!mentions.includes(authContext.userId)) {
					return
				}

				yield* runGatewayHandlers(handlers, message, "message.create")
			})

		const decodeCommandArgs = (event: Extract<BotGatewayEnvelope, { eventType: "command.invoke" }>) =>
			Option.match(
				Option.flatMap(commandGroup, (group) =>
					Option.fromNullishOr(
						group.commands.find((c: CommandDef) => c.name === event.payload.commandName),
					),
				),
				{
					onNone: () => Effect.succeed(event.payload.arguments),
					onSome: (def) =>
						Schema.decodeUnknownEffect(def.argsSchema)(event.payload.arguments).pipe(
							Effect.mapError(
								(cause) =>
									new CommandArgsDecodeError({
										message: `Failed to decode args for /${event.payload.commandName}`,
										commandName: event.payload.commandName,
										cause,
									}),
							),
							Effect.catchTag("CommandArgsDecodeError", (error) =>
								Effect.logWarning(
									`Failed to decode args for /${event.payload.commandName}, using raw arguments`,
									{ error, rawArgs: event.payload.arguments },
								).pipe(Effect.as(event.payload.arguments)),
							),
						),
				},
			)

		const dispatchGatewayEvent = (envelope: Schema.Schema.Type<typeof BotGatewayEnvelope>) =>
			Effect.gen(function* () {
				switch (envelope.eventType) {
					case "command.invoke": {
						const handler = commandHandlers.get(envelope.payload.commandName)
						if (!handler) {
							yield* Effect.logWarning(
								`No handler for command: ${envelope.payload.commandName}`,
							)
							return
						}

						const decodedArgs = yield* decodeCommandArgs(envelope)
						const ctx: TypedCommandContext<unknown> = {
							commandName: envelope.payload.commandName,
							channelId: envelope.payload.channelId,
							userId: envelope.payload.userId,
							orgId: envelope.payload.orgId,
							args: decodedArgs,
							timestamp: envelope.payload.timestamp,
						}
						const logCtx = createCommandLogContext({
							...botIdentity,
							commandName: envelope.payload.commandName,
							channelId: envelope.payload.channelId,
							userId: envelope.payload.userId,
							orgId: envelope.payload.orgId,
						})

						yield* withLogContext(
							logCtx,
							"bot.command.handle",
							handler(ctx).pipe(
								Effect.mapError((cause) =>
									mapCommandHandlerError(envelope.payload.commandName, cause),
								),
							),
						)
						return
					}
					case "message.create": {
						const handlers = yield* Ref.get(messageHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						yield* runMentionHandlers(envelope.payload)
						return
					}
					case "message.update": {
						const handlers = yield* Ref.get(messageUpdateHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "message.delete": {
						const handlers = yield* Ref.get(messageDeleteHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "channel.create": {
						const handlers = yield* Ref.get(channelCreatedHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "channel.update": {
						const handlers = yield* Ref.get(channelUpdatedHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "channel.delete": {
						const handlers = yield* Ref.get(channelDeletedHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "channel_member.add": {
						const handlers = yield* Ref.get(channelMemberAddedHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
					case "channel_member.remove": {
						const handlers = yield* Ref.get(channelMemberRemovedHandlersRef)
						yield* runGatewayHandlers(handlers, envelope.payload, envelope.eventType)
						return
					}
				}
			})

		const processGatewayBatch = (
			envelopes: ReadonlyArray<Schema.Schema.Type<typeof BotGatewayEnvelope>>,
		) =>
			Effect.gen(function* () {
				const partitions = new Map<string, Array<Schema.Schema.Type<typeof BotGatewayEnvelope>>>()
				for (const envelope of envelopes) {
					const existing = partitions.get(envelope.partitionKey)
					if (existing) {
						existing.push(envelope)
					} else {
						partitions.set(envelope.partitionKey, [envelope])
					}
				}

				yield* Effect.forEach(
					Array.from(partitions.values()),
					(partitionEvents) =>
						Effect.forEach(
							partitionEvents,
							(envelope) =>
								dispatchGatewayEvent(envelope).pipe(
									Effect.tapCause((cause) =>
										Effect.logError("Gateway event handler failed", {
											eventType: envelope.eventType,
											partitionKey: envelope.partitionKey,
											cause,
										}),
									),
								),
							{
								discard: true,
							},
						),
					{
						concurrency: getGatewayRuntimeConfig()?.maxConcurrentPartitions ?? 8,
						discard: true,
					},
				)
			})

		const loadResumeOffset = (runtimeConfig: HazelBotRuntimeConfig) =>
			gatewaySessionStore.load(authContext.botId as BotId).pipe(
				Effect.catchTag("GatewaySessionStoreError", (error) =>
					Effect.logWarning("Failed to load saved gateway offset, using configured default", {
						error,
						botId: authContext.botId,
					}).pipe(Effect.as(null)),
				),
				Effect.map((storedOffset) => storedOffset ?? runtimeConfig.resumeOffset),
			)

		const loadGatewaySessionId = () =>
			getBotState(GATEWAY_SESSION_ID_STATE_KEY, Schema.String).pipe(
				Effect.catchTags({
					GatewayDecodeError: (error) =>
						Effect.logWarning("Failed to decode saved gateway session id, reconnecting fresh", {
							error,
							botId: authContext.botId,
						}).pipe(Effect.as(null)),
					GatewaySessionStoreError: (error) =>
						Effect.logWarning("Failed to load saved gateway session id, reconnecting fresh", {
							error,
							botId: authContext.botId,
						}).pipe(Effect.as(null)),
				}),
			)

		const normalizeSocketPayload = (payload: unknown): string => {
			if (typeof payload === "string") {
				return payload
			}
			if (payload instanceof ArrayBuffer) {
				return new TextDecoder().decode(new Uint8Array(payload))
			}
			if (ArrayBuffer.isView(payload)) {
				return new TextDecoder().decode(
					new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength),
				)
			}
			return String(payload)
		}

		const encodeGatewayFrame = (frame: BotGatewayClientFrame): string => JSON.stringify(frame)

		const startWebSocketGatewayLoop = (runtimeConfig: HazelBotRuntimeConfig) =>
			Effect.gen(function* () {
				const services = yield* Effect.context<any>()
				let nextResumeOffset = yield* loadResumeOffset(runtimeConfig)
				let nextSessionId = yield* loadGatewaySessionId()
				let hasConnected = false

				const connectOnce = Effect.tryPromise({
					try: () =>
						new Promise<{ resumeOffset: string; sessionId: string | null }>((resolve, reject) => {
							const socket = new WebSocket(
								createGatewayWebSocketUrl(runtimeConfig.gatewayUrl).toString(),
							)
							let finished = false
							let sessionId: string | null = nextSessionId
							let currentResumeOffset = nextResumeOffset
							let heartbeatTimer: ReturnType<typeof setInterval> | null = null

							const finish = (
								state: { resumeOffset: string; sessionId: string | null },
								error?: unknown,
							) => {
								if (finished) {
									return
								}
								finished = true
								if (heartbeatTimer) {
									clearInterval(heartbeatTimer)
								}
								if (error) {
									reject(error)
									return
								}
								resolve(state)
							}

							const sendFrame = (frame: BotGatewayClientFrame) => {
								if (socket.readyState === WebSocket.OPEN) {
									socket.send(encodeGatewayFrame(frame))
								}
							}

							const startHeartbeat = (
								hello: Schema.Schema.Type<typeof BotGatewayHelloFrame>,
							) => {
								const intervalMs =
									runtimeConfig.heartbeatIntervalMs ?? hello.heartbeatIntervalMs
								if (heartbeatTimer) {
									clearInterval(heartbeatTimer)
								}
								heartbeatTimer = setInterval(() => {
									sendFrame({
										op: "HEARTBEAT",
										sessionId: sessionId ?? undefined,
									} satisfies Schema.Schema.Type<typeof BotGatewayHeartbeatFrame>)
								}, intervalMs)
							}

							socket.addEventListener("message", (event) => {
								const payload = normalizeSocketPayload(event.data)
								let frame: Schema.Schema.Type<typeof BotGatewayServerFrame>
								try {
									frame = Schema.decodeUnknownSync(BotGatewayServerFrame)(
										JSON.parse(payload),
									)
								} catch (error) {
									socket.close(1011, "invalid_gateway_frame")
									finish(
										{
											resumeOffset: currentResumeOffset,
											sessionId,
										},
										error,
									)
									return
								}

								switch (frame.op) {
									case "HELLO": {
										startHeartbeat(frame)
										sendFrame(
											sessionId
												? ({
														op: "RESUME",
														botToken: runtimeConfig.botToken,
														sessionId,
														resumeOffset: currentResumeOffset,
													} satisfies Schema.Schema.Type<
														typeof BotGatewayResumeFrame
													>)
												: {
														op: "IDENTIFY",
														botToken: runtimeConfig.botToken,
														resumeOffset: currentResumeOffset,
													},
										)
										return
									}
									case "READY": {
										sessionId = frame.sessionId
										Effect.runPromiseWith(services)(
											setBotState(
												GATEWAY_SESSION_ID_STATE_KEY,
												Schema.String,
												frame.sessionId,
											).pipe(
												Effect.catchTags({
													GatewaySessionStoreError: (error) =>
														Effect.logWarning(
															"Failed to persist gateway session id",
															{
																error,
																botId: authContext.botId,
																sessionId: frame.sessionId,
															},
														),
												}),
												Effect.andThen(
													Effect.logInfo(
														hasConnected || frame.resumed
															? "Bot gateway websocket reconnected"
															: "Bot gateway websocket connected",
														{
															botId: authContext.botId,
															sessionId: frame.sessionId,
															resumed: frame.resumed,
															offset: currentResumeOffset,
														},
													),
												),
											),
										).catch(() => undefined)
										hasConnected = true
										return
									}
									case "DISPATCH": {
										Effect.runPromiseWith(services)(
											Effect.gen(function* () {
												yield* processGatewayBatch(frame.events)
												yield* gatewaySessionStore.save(
													authContext.botId as BotId,
													frame.nextOffset,
												)
											}),
										)
											.then(() => {
												currentResumeOffset = frame.nextOffset
												sendFrame({
													op: "ACK",
													sessionId: frame.sessionId,
													nextOffset: frame.nextOffset,
												} satisfies Schema.Schema.Type<typeof BotGatewayAckFrame>)
											})
											.catch((error) => {
												socket.close(1011, "dispatch_failed")
												finish(
													{
														resumeOffset: currentResumeOffset,
														sessionId,
													},
													error,
												)
											})
										return
									}
									case "HEARTBEAT_ACK": {
										return
									}
									case "RECONNECT": {
										socket.close(1012, frame.reason)
										finish({
											resumeOffset: currentResumeOffset,
											sessionId,
										})
										return
									}
									case "INVALID_SESSION": {
										Effect.runPromiseWith(services)(
											Effect.gen(function* () {
												yield* gatewaySessionStore.save(
													authContext.botId as BotId,
													runtimeConfig.resumeOffset,
												)
												yield* deleteBotState(GATEWAY_SESSION_ID_STATE_KEY)
											}).pipe(
												Effect.catchTags({
													GatewaySessionStoreError: (error) =>
														Effect.logWarning(
															"Failed to clear saved gateway session after invalidation",
															{
																error,
																botId: authContext.botId,
																sessionId,
															},
														),
												}),
											),
										)
											.catch(() => undefined)
											.finally(() => {
												currentResumeOffset = runtimeConfig.resumeOffset
												sessionId = null
												socket.close(1008, frame.reason)
												finish({
													resumeOffset: currentResumeOffset,
													sessionId,
												})
											})
										return
									}
								}
							})

							socket.addEventListener("error", () => {
								finish(
									{
										resumeOffset: currentResumeOffset,
										sessionId,
									},
									new Error("Gateway websocket connection failed"),
								)
							})

							socket.addEventListener("close", () => {
								finish({
									resumeOffset: currentResumeOffset,
									sessionId,
								})
							})
						}),
					catch: (cause) =>
						new GatewayReadError({
							message: "Failed to connect to bot gateway websocket",
							cause,
						}),
				})

				yield* Effect.forever(
					Effect.gen(function* () {
						const nextState = yield* connectOnce.pipe(
							Effect.catch((error) =>
								Effect.logWarning("Bot gateway websocket failed, retrying", {
									error,
									botId: authContext.botId,
									offset: nextResumeOffset,
									sessionId: nextSessionId,
								}).pipe(
									Effect.andThen(Effect.sleep(Duration.seconds(1))),
									Effect.as({
										resumeOffset: nextResumeOffset,
										sessionId: nextSessionId,
									}),
								),
							),
						)
						nextResumeOffset = nextState.resumeOffset
						nextSessionId = nextState.sessionId
					}).pipe(Effect.andThen(Effect.sleep(Duration.millis(250)))),
				).pipe(Effect.forkScoped)
			})

		const startGatewayLoop = () =>
			Effect.gen(function* () {
				const runtimeConfig = getGatewayRuntimeConfig()
				if (!runtimeConfig) {
					return
				}

				yield* startWebSocketGatewayLoop(runtimeConfig)
			})

		// Get command group from runtime config for schema decoding
		const commandGroup = Option.map(runtimeConfigOption, (c) => c.commands)

		/**
		 * Convert Schema.Struct fields to backend argument format
		 */
		const schemaFieldsToArgs = (fields: Schema.Struct.Fields) => {
			return Object.entries(fields).map(([name, fieldSchema]) => {
				// Check if the field is optional by looking at the schema's AST
				// PropertySignature with isOptional or Schema with optional wrapper
				const isOptional =
					"isOptional" in fieldSchema && typeof fieldSchema.isOptional === "boolean"
						? fieldSchema.isOptional
						: false
				return {
					name,
					required: !isOptional,
					type: "string" as const, // For now, all args are strings from the frontend
					description: undefined,
					placeholder: undefined,
				}
			})
		}

		/**
		 * Sync commands with the backend via HTTP (type-safe HttpApiClient)
		 * Uses Option.match for cleaner handling
		 */
		const syncCommands = Option.match(runtimeConfigOption, {
			onNone: () => Effect.void,
			onSome: (config) =>
				Effect.gen(function* () {
					const cmds = config.commands.commands
					if (cmds.length === 0) {
						return
					}

					yield* Effect.logDebug(`Syncing ${cmds.length} commands with backend...`)

					// Call the sync endpoint using type-safe HttpApiClient
					const response = yield* httpApiClient["bot-commands"].syncCommands({
						payload: new SyncBotCommandsRequest({
							commands: cmds.map((cmd: CommandDef) => ({
								name: cmd.name,
								description: cmd.description,
								arguments: schemaFieldsToArgs(cmd.args),
								usageExample: cmd.usageExample ?? null,
							})),
						}),
					})

					yield* Effect.logDebug(`Synced ${response.syncedCount} commands successfully`)
				}).pipe(
					Effect.mapError(
						(cause) =>
							new CommandSyncError({
								message: "Failed to sync commands with backend",
								cause,
							}),
					),
				),
		})

		/**
		 * Sync mentionable flag with the backend
		 * Updates the bot's mentionable setting in the database
		 */
		const syncMentionable = Option.match(runtimeConfigOption, {
			onNone: () => Effect.void,
			onSome: (config) =>
				Effect.gen(function* () {
					yield* Effect.logDebug(`Syncing mentionable=${config.mentionable} with backend...`)

					yield* httpApiClient["bot-commands"].updateBotSettings({
						payload: new UpdateBotSettingsRequest({ mentionable: config.mentionable }),
					})

					yield* Effect.logDebug("Mentionable flag synced successfully")
				}).pipe(
					Effect.mapError(
						(cause) =>
							new MentionableSyncError({
								message: "Failed to sync mentionable flag with backend",
								cause,
							}),
					),
				),
		})

		/**
		 * Helper to create actors service from runtime config.
		 * Shared between stream.create and ai.stream to avoid code duplication.
		 */
		const createActorsServiceFn = () =>
			Option.match(runtimeConfigOption, {
				onNone: () =>
					Effect.fail(
						new BotNotConfiguredError({
							message: "Bot runtime config not available for streaming",
						}),
					),
				onSome: (config) => {
					const client = createActorsClient(config.actorsEndpoint)
					return Effect.succeed({
						getMessageActor: (messageId: string) =>
							Effect.sync(() =>
								client.message.getOrCreate([messageId], {
									params: { token: config.botToken },
								}),
							),
						client,
						botToken: config.botToken,
					} as ActorsClientService)
				},
			})

		/**
		 * Helper to create the message creation function.
		 * Shared between stream.create and ai.stream to avoid code duplication.
		 */
		const createMessageFnHelper: MessageCreateFn = (
			chId: ChannelId,
			content: string,
			opts?: {
				readonly replyToMessageId?: MessageId | null
				readonly threadChannelId?: ChannelId | null
				readonly embeds?:
					| readonly {
							readonly liveState?: {
								readonly enabled: true
								readonly loading?: {
									readonly text?: string
									readonly icon?: "sparkle" | "brain"
									readonly showSpinner?: boolean
									readonly throbbing?: boolean
								}
							}
					  }[]
					| null
			},
		) =>
			messageLimiter(
				httpApiClient["api-v1-messages"]
					.createMessage({
						payload: new CreateMessageRequest({
							channelId: chId,
							content,
							replyToMessageId: opts?.replyToMessageId ?? null,
							threadChannelId: opts?.threadChannelId ?? null,
							embeds: opts?.embeds ?? null,
						}),
					})
					.pipe(
						Effect.map((r) => r.data),
						Effect.mapError(
							(cause) =>
								new MessageSendError({
									message: "Failed to create message",
									channelId: chId,
									cause,
								}),
						),
					),
			)

		const getUserFacingCommandErrorMessage = (cause: unknown) =>
			isTemporaryActorServiceError(cause)
				? ACTOR_SERVICE_ERROR_BOT_MESSAGE
				: GENERIC_COMMAND_ERROR_MESSAGE

		const sendCommandErrorMessage = (ctx: TypedCommandContext<any>, content: string) =>
			createMessageFnHelper(ctx.channelId, content, {
				replyToMessageId: null,
				threadChannelId: null,
				embeds: null,
			}).pipe(
				Effect.mapError(
					(cause) =>
						new MessageSendError({
							message: "Failed to notify user about command failure",
							channelId: ctx.channelId,
							cause,
						}),
				),
			)

		/**
		 * Helper to update a message (for persisting streaming state).
		 * Shared between stream.create and ai.stream to avoid code duplication.
		 */
		const updateMessageFnHelper: MessageUpdateFn = (messageId, payload) =>
			messageLimiter(
				httpApiClient["api-v1-messages"]
					.updateMessage({
						params: { id: messageId },
						payload: new UpdateMessageRequest({
							content: payload.content,
							embeds: payload.embeds ?? null,
						}),
					})
					.pipe(
						Effect.map((r) => r.data),
						Effect.mapError(
							(cause) =>
								new MessageUpdateError({
									message: "Failed to update message",
									messageId,
									cause,
								}),
						),
					),
			)

		return {
			/**
			 * Register a handler for new messages
			 */
			onMessage: <E = EventHandlerError, R = never>(handler: MessageHandler<E, R>) =>
				Ref.update(messageHandlersRef, (handlers) => [...handlers, handler as MessageHandlerFn]),

			/**
			 * Register a handler for message updates
			 */
			onMessageUpdate: <E = EventHandlerError, R = never>(handler: MessageHandler<E, R>) =>
				Ref.update(messageUpdateHandlersRef, (handlers) => [
					...handlers,
					handler as MessageHandlerFn,
				]),

			/**
			 * Register a handler for message deletes
			 */
			onMessageDelete: <E = EventHandlerError, R = never>(handler: MessageHandler<E, R>) =>
				Ref.update(messageDeleteHandlersRef, (handlers) => [
					...handlers,
					handler as MessageHandlerFn,
				]),

			/**
			 * Register a handler for new channels
			 */
			onChannelCreated: <E = EventHandlerError, R = never>(handler: ChannelHandler<E, R>) =>
				Ref.update(channelCreatedHandlersRef, (handlers) => [
					...handlers,
					handler as ChannelHandlerFn,
				]),

			/**
			 * Register a handler for channel updates
			 */
			onChannelUpdated: <E = EventHandlerError, R = never>(handler: ChannelHandler<E, R>) =>
				Ref.update(channelUpdatedHandlersRef, (handlers) => [
					...handlers,
					handler as ChannelHandlerFn,
				]),

			/**
			 * Register a handler for channel deletes
			 */
			onChannelDeleted: <E = EventHandlerError, R = never>(handler: ChannelHandler<E, R>) =>
				Ref.update(channelDeletedHandlersRef, (handlers) => [
					...handlers,
					handler as ChannelHandlerFn,
				]),

			/**
			 * Register a handler for new channel members
			 */
			onChannelMemberAdded: <E = EventHandlerError, R = never>(handler: ChannelMemberHandler<E, R>) =>
				Ref.update(channelMemberAddedHandlersRef, (handlers) => [
					...handlers,
					handler as ChannelMemberHandlerFn,
				]),

			/**
			 * Register a handler for removed channel members
			 */
			onChannelMemberRemoved: <E = EventHandlerError, R = never>(handler: ChannelMemberHandler<E, R>) =>
				Ref.update(channelMemberRemovedHandlersRef, (handlers) => [
					...handlers,
					handler as ChannelMemberHandlerFn,
				]),

			/**
			 * Register a handler for when the bot is @mentioned in a message.
			 * Requires `mentionable: true` in bot config.
			 *
			 * @example
			 * ```typescript
			 * yield* bot.onMention((message) =>
			 *   Effect.gen(function* () {
			 *     yield* bot.message.reply(message, "You mentioned me! How can I help?")
			 *   })
			 * )
			 * ```
			 */
			onMention: <E = EventHandlerError, R = never>(handler: MentionHandler<E, R>) =>
				Ref.update(mentionHandlersRef, (handlers) => [...handlers, handler as MentionHandlerFn]),

			/**
			 * Message operations - send, reply, update, delete, react
			 * Uses the public HTTP API at /api/v1/messages with type-safe HttpApiClient
			 * All operations are rate-limited to prevent API throttling
			 */
			message: {
				/**
				 * Send a message to a channel
				 * @param channelId - The channel to send the message to
				 * @param content - Message content
				 * @param options - Optional settings (reply, thread, attachments, embeds)
				 */
				send: (channelId: ChannelId, content: string, options?: SendMessageOptions) =>
					messageLimiter(
						httpApiClient["api-v1-messages"]
							.createMessage({
								payload: new CreateMessageRequest({
									channelId,
									content,
									replyToMessageId: options?.replyToMessageId ?? null,
									threadChannelId: options?.threadChannelId ?? null,
									attachmentIds: options?.attachmentIds
										? [...options.attachmentIds]
										: undefined,
									embeds: options?.embeds ?? null,
								}),
							})
							.pipe(
								Effect.map((r) => r.data),
								Effect.mapError(
									(cause) =>
										new MessageSendError({
											message: "Failed to send message",
											channelId,
											cause,
										}),
								),
								Effect.withSpan("bot.message.send", { attributes: { channelId } }),
							),
					),

				/**
				 * Reply to a message
				 * @param message - The message to reply to
				 * @param content - Reply content
				 * @param options - Optional settings (thread, attachments)
				 */
				reply: (
					message: MessageType,
					content: string,
					options?: Omit<SendMessageOptions, "replyToMessageId">,
				) =>
					messageLimiter(
						httpApiClient["api-v1-messages"]
							.createMessage({
								payload: new CreateMessageRequest({
									channelId: message.channelId,
									content,
									replyToMessageId: message.id,
									threadChannelId: options?.threadChannelId ?? null,
									attachmentIds: options?.attachmentIds
										? [...options.attachmentIds]
										: undefined,
									embeds: null,
								}),
							})
							.pipe(
								Effect.map((r) => r.data),
								Effect.mapError(
									(cause) =>
										new MessageReplyError({
											message: "Failed to reply to message",
											channelId: message.channelId,
											replyToMessageId: message.id,
											cause,
										}),
								),
								Effect.withSpan("bot.message.reply", {
									attributes: {
										channelId: message.channelId,
										replyToMessageId: message.id,
									},
								}),
							),
					),

				/**
				 * Update a message
				 * @param message - The message to update (requires id)
				 * @param content - New content
				 */
				update: (message: MessageType, content: string) =>
					messageLimiter(
						httpApiClient["api-v1-messages"]
							.updateMessage({
								params: { id: message.id },
								payload: new UpdateMessageRequest({ content }),
							})
							.pipe(
								Effect.map((r) => r.data),
								Effect.mapError(
									(cause) =>
										new MessageUpdateError({
											message: "Failed to update message",
											messageId: message.id,
											cause,
										}),
								),
								Effect.withSpan("bot.message.update", {
									attributes: { messageId: message.id },
								}),
							),
					),

				/**
				 * Delete a message
				 * @param id - Message ID to delete
				 */
				delete: (id: MessageId) =>
					messageLimiter(
						httpApiClient["api-v1-messages"]
							.deleteMessage({
								params: { id },
							})
							.pipe(
								Effect.mapError(
									(cause) =>
										new MessageDeleteError({
											message: "Failed to delete message",
											messageId: id,
											cause,
										}),
								),
								Effect.withSpan("bot.message.delete", { attributes: { messageId: id } }),
							),
					),

				/**
				 * Toggle a reaction on a message
				 * @param message - The message to react to
				 * @param emoji - Emoji to toggle
				 */
				react: (message: MessageType, emoji: string) =>
					messageLimiter(
						httpApiClient["api-v1-messages"]
							.toggleReaction({
								params: { id: message.id },
								payload: new ToggleReactionRequest({
									emoji,
									channelId: message.channelId,
								}),
							})
							.pipe(
								Effect.mapError(
									(cause) =>
										new MessageReactError({
											message: "Failed to toggle reaction",
											messageId: message.id,
											emoji,
											cause,
										}),
								),
								Effect.withSpan("bot.message.react", {
									attributes: { messageId: message.id, emoji },
								}),
							),
					),

				/**
				 * List messages in a channel with cursor-based pagination (Stripe-style)
				 * @param channelId - The channel to list messages from
				 * @param options - Pagination options (startingAfter, endingBefore, limit)
				 * @returns Messages in reverse chronological order (newest first) with has_more indicator
				 *
				 * @example
				 * ```typescript
				 * // Get first page (newest 25 messages)
				 * const page1 = yield* bot.message.list(channelId)
				 *
				 * // Get older messages (next page)
				 * if (page1.has_more) {
				 *   const lastMsg = page1.data[page1.data.length - 1]
				 *   const page2 = yield* bot.message.list(channelId, { startingAfter: lastMsg.id })
				 * }
				 * ```
				 */
				list: (
					channelId: ChannelId,
					options?: {
						/** Cursor for older messages (fetch messages before this message) */
						readonly startingAfter?: MessageId
						/** Cursor for newer messages (fetch messages after this message) */
						readonly endingBefore?: MessageId
						/** Maximum number of messages to return (1-100, default 25) */
						readonly limit?: number
					},
				) =>
					httpApiClient["api-v1-messages"]
						.listMessages({
							query: {
								channel_id: channelId,
								starting_after: options?.startingAfter,
								ending_before: options?.endingBefore,
								limit: options?.limit,
							},
						})
						.pipe(
							Effect.mapError(
								(cause) =>
									new MessageListError({
										message: "Failed to list messages",
										channelId,
										cause,
									}),
							),
							Effect.withSpan("bot.message.list", { attributes: { channelId } }),
						),
			},

			/**
			 * Channel operations - update, createThread
			 */
			channel: {
				/**
				 * Update a channel
				 * @param channel - The channel to update (requires full channel object)
				 * @param updates - Fields to update
				 */
				update: (
					channel: ChannelType,
					updates: {
						name?: string
						description?: string | null
					},
				) =>
					rpc["channel.update"]({
						id: channel.id,
						name: updates.name ?? channel.name,
						...updates,
					}).pipe(
						Effect.map((r: any) => r.data),
						Effect.withSpan("bot.channel.update", { attributes: { channelId: channel.id } }),
					),

				/**
				 * Ensure a thread exists on a message and return it.
				 *
				 * @param messageId - The message to create a thread on
				 * @param channelId - Deprecated/unused. Kept for backwards compatibility.
				 * @returns The thread channel data (use `.id` as the thread's ChannelId)
				 *
				 * @throws MessageNotFoundError if the message doesn't exist
				 */
				createThread: (messageId: MessageId, channelId: ChannelId) =>
					rpc["channel.createThread"]({
						messageId,
					}).pipe(
						Effect.timeout(Duration.seconds(15)),
						Effect.tapCause((cause) =>
							Effect.logError("[bot.channel.createThread] Failed to ensure thread", {
								messageId,
								channelId,
								cause,
							}),
						),
						Effect.map((r: any) => r.data),
						Effect.withSpan("bot.channel.createThread", {
							attributes: { messageId, channelId },
						}),
					),
			},

			/**
			 * Typing indicator operations
			 */
			typing: {
				/**
				 * Start showing typing indicator
				 * @param channelId - Channel ID
				 * @param memberId - Channel member ID
				 */
				start: (channelId: ChannelId, memberId: ChannelMemberId) =>
					rpc["typingIndicator.create"]({
						channelId,
						memberId,
						lastTyped: Date.now(),
					}).pipe(
						Effect.map((r: any) => r.data),
						Effect.withSpan("bot.typing.start", { attributes: { channelId, memberId } }),
					),

				/**
				 * Stop showing typing indicator
				 * @param id - Typing indicator ID
				 */
				stop: (id: TypingIndicatorId) =>
					rpc["typingIndicator.delete"]({
						id,
					}).pipe(
						Effect.map((r: any) => r.data),
						Effect.withSpan("bot.typing.stop", { attributes: { typingIndicatorId: id } }),
					),
			},

			/**
			 * Integration operations - get OAuth tokens for connected integrations
			 * Requires the provider to be listed in the bot's `allowedIntegrations`
			 */
			integration: {
				/**
				 * Get a valid OAuth access token for an integration provider.
				 * The token is auto-refreshed if expired.
				 *
				 * @param orgId - The organization ID to get the token for
				 * @param provider - The integration provider ("linear" | "github" | "figma" | "notion")
				 * @returns The access token, provider, and expiry info
				 *
				 * @example
				 * ```typescript
				 * const { accessToken } = yield* bot.integration.getToken(orgId, "linear")
				 * // Use accessToken to call Linear API directly
				 * ```
				 */
				getToken: (orgId: OrganizationId, provider: IntegrationConnection.IntegrationProvider) =>
					httpApiClient["bot-commands"].getIntegrationToken({ params: { orgId, provider } }).pipe(
						Effect.withSpan("bot.integration.getToken", {
							attributes: { orgId, provider },
						}),
					),

				/**
				 * Get the set of enabled integration providers for an organization.
				 * Returns the intersection of bot's allowedIntegrations and org's active connections.
				 * Results are cached for 30 seconds to reduce API calls.
				 *
				 * @param orgId - The organization ID to check
				 * @returns A Set of enabled integration providers
				 *
				 * @example
				 * ```typescript
				 * const enabled = yield* bot.integration.getEnabled(orgId)
				 * if (enabled.has("linear")) {
				 *   // Linear tools are available
				 * }
				 * ```
				 */
				getEnabled: (orgId: OrganizationId) => Cache.get(enabledIntegrationsCache, orgId),

				/**
				 * Invalidate the enabled integrations cache for an organization.
				 * Call this when you know the integration status has changed.
				 *
				 * @param orgId - The organization ID to invalidate cache for
				 */
				invalidateCache: (orgId: OrganizationId) => Cache.invalidate(enabledIntegrationsCache, orgId),
			},

			/**
			 * Register a handler for a slash command (typesafe version)
			 * @param command - The command definition created with Command.make
			 * @param handler - Handler function that receives typed CommandContext
			 *
			 * @example
			 * ```typescript
			 * const EchoCommand = Command.make("echo", {
			 *   description: "Echo text back",
			 *   args: { text: Schema.String },
			 * })
			 *
			 * yield* bot.onCommand(EchoCommand, (ctx) =>
			 *   Effect.gen(function* () {
			 *     yield* bot.message.send(ctx.channelId, `Echo: ${ctx.args.text}`)
			 *   })
			 * )
			 * ```
			 */
			onCommand: <
				Name extends string,
				Args extends Schema.Struct.Fields,
				E = CommandHandlerError,
				R = never,
			>(
				command: CommandDef<Name, Args>,
				handler: CommandHandler<Schema.Schema.Type<Schema.Struct<Args>>, E, R>,
			) =>
				Effect.sync(() => {
					commandHandlers.set(
						command.name,
						handler as (ctx: TypedCommandContext<any>) => Effect.Effect<void, any, any>,
					)
				}),

			/**
			 * Create an error handler wrapper for command handlers.
			 * Logs errors and sends a user-friendly message to the channel.
			 *
			 * @param ctx - The command context (for channelId and commandName)
			 * @returns A function that wraps an effect with error handling
			 *
			 * @example
			 * ```typescript
			 * yield* bot.onCommand(MyCommand, (ctx) =>
			 *   Effect.gen(function* () {
			 *     // ... command logic
			 *   }).pipe(bot.withErrorHandler(ctx))
			 * )
			 * ```
			 */
			withErrorHandler:
				<Args>(ctx: TypedCommandContext<Args>) =>
				<A, E, R>(effect: Effect.Effect<A, E, R>) =>
					effect.pipe(
						Effect.mapError(
							(cause) =>
								new CommandHandlerError({
									message: `Error in /${ctx.commandName} command`,
									commandName: ctx.commandName,
									cause,
								}),
						),
						Effect.catchTag("CommandHandlerError", (error) =>
							Effect.gen(function* () {
								yield* Effect.logError(`Error in /${ctx.commandName} command`, { error })
								yield* sendCommandErrorMessage(
									ctx,
									getUserFacingCommandErrorMessage(error.cause),
								)
								return yield* Effect.fail(error)
							}),
						),
					),

			/**
			 * Start the bot client
			 * Syncs commands and mentionable flag with backend and begins consuming the durable bot gateway
			 */
			start: Effect.gen(function* () {
				yield* Effect.logDebug("Starting bot client...")

				// Sync commands with backend (if configured)
				yield* syncCommands

				// Sync mentionable flag with backend
				yield* syncMentionable

				yield* startGatewayLoop()

				yield* Effect.logDebug("Bot client started successfully")
			}),

			/**
			 * Get bot authentication context
			 */
			getAuthContext: auth.getContext.pipe(Effect.orDie),

			state: {
				get: (key: string) => botStateStore.get(authContext.botId as BotId, key),
				set: (key: string, value: string) =>
					botStateStore.set(authContext.botId as BotId, key, value),
				delete: (key: string) => botStateStore.delete(authContext.botId as BotId, key),
				getJson: <A>(key: string, schema: Schema.Schema<A>) => getBotState(key, schema),
				setJson: <A>(key: string, schema: Schema.Schema<A>, value: A) =>
					setBotState(key, schema, value),
			},

			/**
			 * Helper to create actors service from runtime config.
			 * Uses Option.match for explicit handling of missing config.
			 * Fails with BotNotConfiguredError if config is not available.
			 */
			createActorsService: createActorsServiceFn,

			/**
			 * Helper to create the message creation function.
			 * Shared between stream.create and ai.stream.
			 */
			createMessageFn: createMessageFnHelper,

			/**
			 * Helper to update a message (for persisting streaming state).
			 * @internal
			 */
			updateMessageFn: updateMessageFnHelper,

			/**
			 * Low-level streaming API for real-time message updates.
			 * Creates messages with live state and provides direct control over the actor.
			 *
			 * @example
			 * ```typescript
			 * yield* Effect.scoped(
			 *   Effect.gen(function* () {
			 *     const stream = yield* bot.stream.create(channelId)
			 *     yield* stream.appendText("Hello ")
			 *     yield* stream.startThinking()
			 *     yield* stream.complete()
			 *   })
			 * )
			 * ```
			 */
			stream: {
				/**
				 * Create a new stream session for real-time message updates.
				 * @param channelId - The channel to create the message in
				 * @param options - Optional configuration (initialData, replyToMessageId, threadChannelId)
				 */
				create: (channelId: ChannelId, options?: CreateStreamOptions) =>
					Effect.gen(function* () {
						const actorsService = yield* createActorsServiceFn()

						return yield* createStreamSessionInternal(
							createMessageFnHelper,
							updateMessageFnHelper,
							actorsService,
							channelId,
							options,
						)
					}),
			},

			/**
			 * High-level AI streaming API with helpers for processing AI model output.
			 * Automatically handles thinking steps, tool calls, and text streaming.
			 *
			 * @example
			 * ```typescript
			 * yield* Effect.scoped(
			 *   Effect.gen(function* () {
			 *     const stream = yield* bot.ai.stream(channelId, { model: "claude-3.5-sonnet" })
			 *     yield* stream.processChunk({ type: "text", text: "Hello" })
			 *     yield* stream.complete()
			 *   })
			 * )
			 * ```
			 */
			ai: {
				/**
				 * Create an AI stream session with helpers for processing AI model output.
				 * @param channelId - The channel to create the message in
				 * @param options - Optional configuration including model info
				 */
				stream: (channelId: ChannelId, options?: AIStreamOptions) =>
					Effect.gen(function* () {
						const actorsService = yield* createActorsServiceFn()

						return yield* createAIStreamSessionInternal(
							createMessageFnHelper,
							updateMessageFnHelper,
							actorsService,
							channelId,
							options,
						)
					}),

				/**
				 * Error handler for AI streaming sessions.
				 * Unlike the generic `withErrorHandler`, this one:
				 * 1. Marks the AI session as failed (calls `session.fail()`)
				 * 2. Does NOT create a separate error message (the ErrorCard displays it inline)
				 *
				 * @param ctx - The command context
				 * @param session - The AI stream session to mark as failed on error
				 * @returns A function that wraps an effect with AI-aware error handling
				 *
				 * @example
				 * ```typescript
				 * yield* bot.onCommand(AskCommand, (ctx) =>
				 *   Effect.gen(function* () {
				 *     const session = yield* bot.ai.stream(ctx.channelId, {...})
				 *
				 *     yield* model.streamText({...}).pipe(
				 *       Stream.runForEach((part) => session.processChunk(mapPart(part))),
				 *     ).pipe(bot.ai.withErrorHandler(ctx, session))
				 *
				 *     yield* session.complete()
				 *   })
				 * )
				 * ```
				 */
				withErrorHandler:
					<Args>(ctx: TypedCommandContext<Args>, session: AIStreamSession) =>
					<A, E, R>(effect: Effect.Effect<A, E, R>) =>
						effect.pipe(
							Effect.mapError(
								(cause) =>
									new CommandHandlerError({
										message: `Error in AI streaming for /${ctx.commandName}`,
										commandName: ctx.commandName,
										cause,
									}),
							),
							Effect.catchTag("CommandHandlerError", (error) =>
								Effect.gen(function* () {
									yield* Effect.logError(`Error in AI streaming for /${ctx.commandName}`, {
										error,
									})
									const userMessage = getUserFacingCommandErrorMessage(error.cause)

									// Mark the session as failed - this updates the existing message
									yield* session.fail(userMessage).pipe(
										Effect.catchCause((cause) =>
											Effect.gen(function* () {
												yield* Effect.logError("Failed to mark AI stream as failed", {
													cause,
												})
												yield* sendCommandErrorMessage(ctx, userMessage).pipe(
													Effect.catchCause((messageCause) =>
														Effect.logError(
															"Failed to send AI fallback error message",
															{
																cause: messageCause,
															},
														),
													),
												)
											}),
										),
									)
									// Do NOT create a new message - the ErrorCard will show the error
									return yield* Effect.fail(error)
								}),
							),
						),
			},
		}
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

/**
 * Configuration for creating a Hazel bot
 */
export interface HazelBotConfig<Commands extends CommandGroup<any> = EmptyCommands> {
	/**
	 * Backend URL for RPC API calls
	 * @default "https://api.hazel.sh"
	 * @example "http://localhost:3003" // For local development
	 */
	readonly backendUrl?: string

	/**
	 * Gateway URL for durable bot event delivery.
	 * Defaults to `backendUrl`.
	 */
	readonly gatewayUrl?: string

	/**
	 * Actors/Rivet endpoint for live state streaming
	 * @default "https://rivet.hazel.sh"
	 * @example "http://localhost:6420" // For local development
	 */
	readonly actorsEndpoint?: string

	/**
	 * Bot authentication token (required)
	 */
	readonly botToken: string

	/**
	 * Slash commands this bot supports (optional)
	 * Commands are synced to the backend on start and appear in the / autocomplete
	 *
	 * @example
	 * ```typescript
	 * const EchoCommand = Command.make("echo", {
	 *   description: "Echo text back",
	 *   args: { text: Schema.String },
	 * })
	 *
	 * const commands = CommandGroup.make(EchoCommand)
	 * ```
	 */
	readonly commands?: Commands

	/**
	 * Enable @mention handling. When true, the bot registers as mentionable
	 * and triggers onMention handlers when users @ the bot in messages.
	 * @default false
	 */
	readonly mentionable?: boolean

	/**
	 * Offset to start from when no saved session offset exists.
	 * Use `"now"` to tail only new events or `"-1"` to replay from the beginning.
	 * @default "now"
	 */
	readonly resumeOffset?: string

	/**
	 * Optional session store for persisting the last acknowledged durable-stream offset.
	 * Defaults to an in-memory store.
	 */
	readonly sessionStore?: import("./gateway.ts").GatewaySessionStore

	/**
	 * Optional bot-local state store for durable bot state like tracked thread mappings.
	 * Defaults to an in-memory store.
	 */
	readonly stateStore?: import("./gateway.ts").BotStateStore

	/**
	 * Maximum number of gateway partitions to process concurrently.
	 * Ordering is still preserved within each partition.
	 * @default 8
	 */
	readonly maxConcurrentPartitions?: number

	/**
	 * Override websocket heartbeat cadence when the gateway HELLO frame should be ignored.
	 */
	readonly heartbeatIntervalMs?: number

	/**
	 * Service name for tracing (optional)
	 * @default "hazel-bot"
	 */
	readonly serviceName?: string

	/**
	 * Health check server port. Set to `false` to disable.
	 * @default 0 (OS-assigned)
	 */
	readonly healthPort?: number | false

	/**
	 * Logging configuration (optional)
	 *
	 * @example
	 * ```typescript
	 * const runtime = createHazelBot({
	 *   botToken: process.env.BOT_TOKEN!,
	 *   logging: {
	 *     level: LogLevel.Debug,  // Enable DEBUG logs
	 *     format: "pretty",       // Human-readable output
	 *   },
	 * })
	 * ```
	 */
	readonly logging?: {
		/**
		 * Minimum log level to output
		 * @default LogLevel.Info
		 */
		readonly level?: LogLevel.LogLevel
		/**
		 * Output format: "pretty" for development, "structured" for production
		 * @default Automatic based on NODE_ENV
		 */
		readonly format?: LogFormat
	}
}

/**
 * Create a Hazel bot runtime with pre-configured Hazel gateway events
 *
 * This is the simplest way to create a bot for Hazel integrations.
 * All inbound Hazel events are delivered over the gateway websocket.
 *
 * @example
 * ```typescript
 * import { createHazelBot, HazelBotClient, Command, CommandGroup } from "@hazel/bot-sdk"
 * import { Context, Schema } from "effect"
 *
 * // Define typesafe commands
 * const EchoCommand = Command.make("echo", {
 *   description: "Echo text back",
 *   args: { text: Schema.String },
 * })
 *
 * const commands = CommandGroup.make(EchoCommand)
 *
 * const runtime = createHazelBot({
 *   botToken: process.env.BOT_TOKEN!,
 *   commands,
 * })
 *
 * const program = Effect.gen(function* () {
 *   const bot = yield* HazelBotClient
 *
 *   // Typesafe command handler - ctx.args.text is typed as string
 *   yield* bot.onCommand(EchoCommand, (ctx) =>
 *     Effect.gen(function* () {
 *       yield* bot.message.send(ctx.channelId, `Echo: ${ctx.args.text}`)
 *     })
 *   )
 *
 *   yield* bot.start
 * })
 *
 * runtime.runPromise(program.pipe(Effect.scoped))
 * ```
 */
export const createHazelBot = <Commands extends CommandGroup<any> = EmptyCommands>(
	config: HazelBotConfig<Commands>,
): ManagedRuntime.ManagedRuntime<HazelBotClient, unknown> => {
	const backendUrl = config.backendUrl ?? "https://api.hazel.sh"
	const gatewayUrl = config.gatewayUrl ?? "https://bot-gateway.hazel.sh"
	const actorsEndpoint =
		config.actorsEndpoint ??
		process.env.ACTORS_URL ??
		process.env.RIVET_PUBLIC_ENDPOINT ??
		process.env.RIVET_URL ??
		DEFAULT_ACTORS_ENDPOINT

	const AuthLayer = Layer.unwrap(
		createAuthContextFromToken(config.botToken, backendUrl).pipe(
			Effect.map((context) => BotAuth.layer(context)),
		),
	)

	// Create the RPC client config layer
	const RpcClientConfigLayer = Layer.succeed(BotRpcClientConfigTag, {
		backendUrl,
		botToken: config.botToken,
	})

	// Create the scoped RPC client layer
	const RpcClientLayer = BotRpcClientLive.pipe(Layer.provide(RpcClientConfigLayer))

	// Create runtime config layer for gateway consumption, command syncing, and mentionable state.
	const RuntimeConfigLayer = Layer.succeed(HazelBotRuntimeConfigTag, {
		backendUrl,
		gatewayUrl,
		botToken: config.botToken,
		commands: config.commands ?? EmptyCommandGroup,
		mentionable: config.mentionable ?? false,
		actorsEndpoint,
		resumeOffset: config.resumeOffset ?? "now",
		maxConcurrentPartitions: config.maxConcurrentPartitions ?? 8,
		heartbeatIntervalMs: config.heartbeatIntervalMs,
	})

	const GatewaySessionStoreLayer = config.sessionStore
		? Layer.succeed(GatewaySessionStoreTag, config.sessionStore)
		: InMemoryGatewaySessionStoreLive

	const BotStateStoreLayer = config.stateStore
		? Layer.succeed(BotStateStoreTag, config.stateStore)
		: InMemoryBotStateStoreLive

	// Create logger layer with configurable level and format
	// Defaults: INFO level, format based on NODE_ENV
	// LOG_LEVEL env var overrides config (e.g. LOG_LEVEL=debug bun run dev)
	const LoggerLayer = Layer.unwrap(
		Effect.gen(function* () {
			const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))
			const envLogLevel = yield* Config.String("LOG_LEVEL").pipe(Config.withDefault(""))
			const defaultFormat: LogFormat = nodeEnv === "production" ? "structured" : "pretty"

			const resolvedLevel = envLogLevel
				? logLevelFromString(envLogLevel)
				: (config.logging?.level ?? "Info")

			const logConfig: BotLogConfig = {
				level: resolvedLevel,
				format: config.logging?.format ?? defaultFormat,
			}

			return createLoggerLayer(logConfig)
		}),
	)

	// Create tracing layer with configurable service name
	const TracingLayer = createTracingLayer(config.serviceName ?? "hazel-bot")

	// Create health server layer (enabled by default on port 0 = OS-assigned)
	const healthPort = config.healthPort ?? 0
	const HealthServerLayer =
		config.healthPort === false ? Layer.empty : BotHealthServerLive(healthPort as number)

	// Compose all layers with proper dependency order
	const AllLayers = Layer.mergeAll(
		HazelBotClient.layer.pipe(
			Layer.provide(RpcClientLayer),
			Layer.provide(RpcClientConfigLayer),
			Layer.provide(BotStateStoreLayer),
			Layer.provide(GatewaySessionStoreLayer),
			Layer.provide(RuntimeConfigLayer),
		),
		HealthServerLayer,
	).pipe(Layer.provide(AuthLayer), Layer.provide(LoggerLayer), Layer.provide(TracingLayer))

	// Create runtime
	return ManagedRuntime.make(AllLayers as Layer.Layer<HazelBotClient, any>)
}
