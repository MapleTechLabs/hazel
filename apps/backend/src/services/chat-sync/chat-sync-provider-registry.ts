import { Discord } from "@hazel/integrations"
import { Context, Config, Effect, Layer, Option, Redacted, Schema, Schedule } from "effect"
import {
	type ChatSyncOutboundAttachment,
	formatMessageContentWithAttachments,
} from "./chat-sync-attachment-content"

export class ChatSyncProviderNotSupportedError extends Schema.TaggedError<ChatSyncProviderNotSupportedError>()(
	"ChatSyncProviderNotSupportedError",
	{
		provider: Schema.String,
	},
) {}

export class ChatSyncProviderConfigurationError extends Schema.TaggedError<ChatSyncProviderConfigurationError>()(
	"ChatSyncProviderConfigurationError",
	{
		provider: Schema.String,
		message: Schema.String,
	},
) {}

export class ChatSyncProviderApiError extends Schema.TaggedError<ChatSyncProviderApiError>()(
	"ChatSyncProviderApiError",
	{
		provider: Schema.String,
		message: Schema.String,
		status: Schema.optional(Schema.Number),
		detail: Schema.optional(Schema.String),
	},
) {}

import { ExternalChannelId, ExternalMessageId, ExternalThreadId } from "@hazel/schema"

export interface ChatSyncProviderAdapter {
	readonly provider: string
	readonly createMessage: (params: {
		externalChannelId: ExternalChannelId
		content: string
		replyToExternalMessageId?: ExternalMessageId
	}) => Effect.Effect<ExternalMessageId, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly createMessageWithAttachments: (params: {
		externalChannelId: ExternalChannelId
		content: string
		attachments: ReadonlyArray<ChatSyncOutboundAttachment>
		replyToExternalMessageId?: ExternalMessageId
	}) => Effect.Effect<ExternalMessageId, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly updateMessage: (params: {
		externalChannelId: ExternalChannelId
		externalMessageId: ExternalMessageId
		content: string
	}) => Effect.Effect<void, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly deleteMessage: (params: {
		externalChannelId: ExternalChannelId
		externalMessageId: ExternalMessageId
	}) => Effect.Effect<void, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly addReaction: (params: {
		externalChannelId: ExternalChannelId
		externalMessageId: ExternalMessageId
		emoji: string
	}) => Effect.Effect<void, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly removeReaction: (params: {
		externalChannelId: ExternalChannelId
		externalMessageId: ExternalMessageId
		emoji: string
	}) => Effect.Effect<void, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
	readonly createThread: (params: {
		externalChannelId: ExternalChannelId
		externalMessageId: ExternalMessageId
		name: string
	}) => Effect.Effect<ExternalThreadId, ChatSyncProviderConfigurationError | ChatSyncProviderApiError>
}

const DISCORD_MAX_MESSAGE_LENGTH = 2000
const DISCORD_SNOWFLAKE_MIN_LENGTH = 17
const DISCORD_SNOWFLAKE_MAX_LENGTH = 30
const DISCORD_THREAD_NAME_MAX_LENGTH = 100
const DISCORD_SYNC_RETRY_SCHEDULE = Schedule.max([
	Schedule.exponential("250 millis").pipe(Schedule.jittered),
	Schedule.recurs(3),
])

const isDiscordSnowflake = (value: string): boolean =>
	/^\d+$/.test(value) &&
	value.length >= DISCORD_SNOWFLAKE_MIN_LENGTH &&
	value.length <= DISCORD_SNOWFLAKE_MAX_LENGTH

export class ChatSyncProviderRegistry extends Context.Service<ChatSyncProviderRegistry>()(
	"ChatSyncProviderRegistry",
	{
		make: Effect.gen(function* () {
			const discordApiClient = yield* Discord.DiscordApiClient

			// Read config once at service initialization to avoid ConfigError leaking into adapter methods
			const discordBotTokenOption = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(Config.option)

			const getDiscordToken = Effect.fn("ChatSyncProviderRegistry.getDiscordToken")(function* () {
				if (Option.isNone(discordBotTokenOption)) {
					return yield* Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: "DISCORD_BOT_TOKEN is not configured",
						}),
					)
				}
				return Redacted.value(discordBotTokenOption.value)
			})

			const getStatusCode = (error: unknown): number | undefined => {
				if (typeof error !== "object" || error === null || !("status" in error)) {
					return undefined
				}

				const status = (error as { status: unknown }).status
				return typeof status === "number" ? status : undefined
			}

			const isRetryableDiscordError = (error: unknown): boolean => {
				const status = getStatusCode(error)
				if (status === undefined) {
					return false
				}
				return status === 429 || status === 408 || (status >= 500 && status < 600)
			}

			const validateDiscordId = (value: string, field: string) => {
				if (!isDiscordSnowflake(value)) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: `${field} must be a valid Discord snowflake`,
						}),
					)
				}
				return Effect.void
			}

			const validateDiscordMessage = (content: string) => {
				if (content.length === 0) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: "Message content cannot be empty",
						}),
					)
				}
				if (content.length > DISCORD_MAX_MESSAGE_LENGTH) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: `Message content exceeds Discord limit of ${DISCORD_MAX_MESSAGE_LENGTH} characters`,
						}),
					)
				}
				return Effect.void
			}

			const validateDiscordEmoji = (emoji: string) => {
				if (!emoji.trim()) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: "Reaction emoji cannot be empty",
						}),
					)
				}
				return Effect.void
			}

			const validateDiscordThreadName = (name: string) => {
				if (!name.trim()) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: "Thread name cannot be empty",
						}),
					)
				}
				if (name.length > DISCORD_THREAD_NAME_MAX_LENGTH) {
					return Effect.fail(
						new ChatSyncProviderConfigurationError({
							provider: "discord",
							message: "Thread name is too long",
						}),
					)
				}
				return Effect.void
			}

			const toDiscordContent = (params: {
				content: string
				attachments: ReadonlyArray<ChatSyncOutboundAttachment>
			}) =>
				formatMessageContentWithAttachments({
					content: params.content,
					attachments: params.attachments,
					maxLength: DISCORD_MAX_MESSAGE_LENGTH,
				})

			const discordAdapter: ChatSyncProviderAdapter = {
				provider: "discord",
				createMessage: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordMessage(params.content)
						if (params.replyToExternalMessageId) {
							yield* validateDiscordId(
								params.replyToExternalMessageId,
								"replyToExternalMessageId",
							)
						}
						return yield* discordApiClient
							.createMessage({
								channelId: params.externalChannelId,
								content: params.content,
								replyToMessageId: params.replyToExternalMessageId,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
								Effect.map((messageId) => messageId as ExternalMessageId),
							)
					}),
				createMessageWithAttachments: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						if (params.replyToExternalMessageId) {
							yield* validateDiscordId(
								params.replyToExternalMessageId,
								"replyToExternalMessageId",
							)
						}
						const content = toDiscordContent({
							content: params.content,
							attachments: params.attachments,
						})
						yield* validateDiscordMessage(content)
						return yield* discordApiClient
							.createMessage({
								channelId: params.externalChannelId,
								content,
								replyToMessageId: params.replyToExternalMessageId,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
								Effect.map((messageId) => messageId as ExternalMessageId),
							)
					}),
				updateMessage: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordId(params.externalMessageId, "externalMessageId")
						yield* validateDiscordMessage(params.content)
						yield* discordApiClient
							.updateMessage({
								channelId: params.externalChannelId,
								messageId: params.externalMessageId,
								content: params.content,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
							)
					}),
				deleteMessage: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordId(params.externalMessageId, "externalMessageId")
						yield* discordApiClient
							.deleteMessage({
								channelId: params.externalChannelId,
								messageId: params.externalMessageId,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
							)
					}),
				addReaction: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordId(params.externalMessageId, "externalMessageId")
						yield* validateDiscordEmoji(params.emoji)
						yield* discordApiClient
							.addReaction({
								channelId: params.externalChannelId,
								messageId: params.externalMessageId,
								emoji: params.emoji,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
							)
					}),
				removeReaction: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordId(params.externalMessageId, "externalMessageId")
						yield* validateDiscordEmoji(params.emoji)
						yield* discordApiClient
							.removeReaction({
								channelId: params.externalChannelId,
								messageId: params.externalMessageId,
								emoji: params.emoji,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
							)
					}),
				createThread: (params) =>
					Effect.gen(function* () {
						const token = yield* getDiscordToken()
						yield* validateDiscordId(params.externalChannelId, "externalChannelId")
						yield* validateDiscordId(params.externalMessageId, "externalMessageId")
						yield* validateDiscordThreadName(params.name)
						return yield* discordApiClient
							.createThread({
								channelId: params.externalChannelId,
								messageId: params.externalMessageId,
								name: params.name,
								botToken: token,
							})
							.pipe(
								Effect.retry({
									while: isRetryableDiscordError,
									schedule: DISCORD_SYNC_RETRY_SCHEDULE,
								}),
								Effect.mapError(
									(error) =>
										new ChatSyncProviderApiError({
											provider: "discord",
											message: error.message,
											status: getStatusCode(error),
											detail: `discord_api_status_${getStatusCode(error) ?? "unknown"}`,
										}),
								),
								Effect.map((threadId) => threadId as ExternalThreadId),
							)
					}),
			}

			const adapters = {
				discord: discordAdapter,
			} as const satisfies Record<string, ChatSyncProviderAdapter>

			const getAdapter = Effect.fn("ChatSyncProviderRegistry.getAdapter")(function* (provider: string) {
				const adapter = Option.fromNullishOr(adapters[provider as keyof typeof adapters])
				return yield* Option.match(adapter, {
					onNone: () =>
						Effect.fail(
							new ChatSyncProviderNotSupportedError({
								provider,
							}),
						),
					onSome: Effect.succeed,
				})
			})

			return { getAdapter }
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(Layer.provide(Discord.DiscordApiClient.layer))
}
