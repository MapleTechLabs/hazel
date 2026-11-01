/**
 * Discord's chat-sync client: the bot's REST API (`DISCORD_BOT_TOKEN`), and per-author posting
 * through a webhook the link provisions on first use when it posts as each author. A webhook that
 * Discord refuses or fails leaves the link posting as the bot.
 */
import { Discord } from "@hazel/integrations"
import type { ExternalMessageId, ExternalThreadId } from "@hazel/schema"
import type { ChatSyncChannelLink } from "@hazel/domain/models"
import { Cause, Config, Effect, Option, Redacted, Schedule } from "effect"
import { formatMessageContentWithAttachments } from "../../chat-sync-attachment-content"
import {
	isWebhookStrategyEnabled,
	outboundIdentityOf,
	webhookPermission,
	webhookPermissionOf,
	withOutboundIdentity,
} from "../../chat-sync-settings"
import {
	ChatSyncProviderApiError,
	type ChatSyncClient,
	ChatSyncProviderConfigurationError,
	type ChatSyncLinkContext,
	isRetryableStatus,
} from "../../provider"
import { discord, discordWebhookConfigOf } from "./definition"

interface WebhookTarget {
	readonly webhookId: string
	readonly webhookToken: string
}

const RETRY_SCHEDULE = Schedule.max([
	Schedule.exponential("250 millis").pipe(Schedule.jittered),
	Schedule.recurs(3),
])

/** Retried in place: Discord answered 408, 429 or 5xx (a transport failure is left to the outbox). */
const isRetryableAnswer = (error: unknown) => {
	const status = (error as { readonly status?: unknown }).status
	return typeof status === "number" && isRetryableStatus(status)
}

const isSnowflake = (value: string) => /^\d{17,30}$/.test(value)

const configError = (message: string) =>
	new ChatSyncProviderConfigurationError({ provider: "discord", message })

/** Discord's answer, or a transport failure or timeout (no status: retryable). */
const apiError = (error: { readonly _tag: string; readonly message: string; readonly status?: number }) => {
	const status = error._tag === "DiscordApiError" ? error.status : undefined
	return new ChatSyncProviderApiError({
		provider: "discord",
		message: error.message,
		status,
		detail: `discord_api_status_${status ?? "unknown"}`,
	})
}

const requireIds = (ids: Record<string, string | undefined>) =>
	Effect.forEach(
		Object.entries(ids),
		([field, value]) =>
			value === undefined || isSnowflake(value)
				? Effect.void
				: Effect.fail(configError(`${field} must be a valid Discord snowflake`)),
		{ discard: true },
	)

const requireContent = (content: string) =>
	content.length === 0
		? Effect.fail(configError("Message content cannot be empty"))
		: content.length > discord.maxMessageLength
			? Effect.fail(
					configError(
						`Message content exceeds Discord limit of ${discord.maxMessageLength} characters`,
					),
				)
			: Effect.void

export const makeDiscordClient = Effect.gen(function* () {
	const api = yield* Discord.DiscordApiClient
	const botTokenOption = yield* Config.Redacted("DISCORD_BOT_TOKEN").pipe(Config.option)
	const botToken = Option.match(botTokenOption, {
		onNone: () => Effect.fail(configError("DISCORD_BOT_TOKEN is not configured")),
		onSome: (token) => Effect.succeed(Redacted.value(token)),
	})

	/** A bot call: retried on 408/429/5xx, then mapped to the chat-sync error. */
	const viaBot = <
		A,
		E extends { readonly _tag: string; readonly message: string; readonly status?: number },
	>(
		call: (token: string) => Effect.Effect<A, E>,
	) =>
		Effect.flatMap(botToken, (token) =>
			call(token).pipe(
				Effect.retry({
					while: isRetryableAnswer,
					schedule: RETRY_SCHEDULE,
				}),
				Effect.mapError(apiError),
			),
		)

	/**
	 * The link's webhook when it posts as each author, provisioned on first use. `None`: post as
	 * the bot (identity off, refused before, not configured, or Discord failing).
	 */
	const webhookOf = (context: ChatSyncLinkContext) =>
		Effect.gen(function* () {
			const { link } = context
			const identity = outboundIdentityOf(link.settings)
			if (!isWebhookStrategyEnabled(identity)) return Option.none<WebhookTarget>()
			if (webhookPermissionOf(link.settings)?.status === "denied") return Option.none<WebhookTarget>()
			const current = discordWebhookConfigOf(identity)
			if (Option.isSome(current)) return Option.some<WebhookTarget>(current.value)
			if (Option.isNone(botTokenOption)) return Option.none<WebhookTarget>()

			const created = yield* api
				.createWebhook({
					channelId: link.externalChannelId,
					botToken: Redacted.value(botTokenOption.value),
				})
				.pipe(Effect.mapError(apiError), Effect.result)
			if (created._tag === "Success") {
				yield* context.saveSettings(
					withOutboundIdentity(
						link.settings,
						{
							enabled: true,
							strategy: "webhook",
							providers: {
								...identity.providers,
								discord: { kind: "discord.webhook", ...created.success },
							},
						} as ChatSyncChannelLink.OutboundIdentitySettings,
						webhookPermission("allowed"),
					),
				)
				return Option.some<WebhookTarget>(created.success)
			}
			const error = created.failure
			yield* context.saveSettings(
				error.status === 403
					? withOutboundIdentity(
							link.settings,
							{ ...identity, strategy: "fallback_bot" },
							webhookPermission("denied", `Webhook create forbidden (HTTP ${error.status})`),
						)
					: withOutboundIdentity(
							link.settings,
							identity,
							webhookPermission("unknown", error.message),
						),
			)
			yield* Effect.logWarning("Failed to provision Discord webhook identity", Cause.fail(error), {
				externalChannelId: link.externalChannelId,
			})
			return Option.none<WebhookTarget>()
		})

	/** `webhook` when the link has one, else (or when Discord fails it) `bot`. */
	const withWebhookFallback = <A, E, E2>(
		context: ChatSyncLinkContext,
		webhook: (target: WebhookTarget) => Effect.Effect<A, E | ChatSyncProviderApiError>,
		bot: Effect.Effect<A, E2>,
	) =>
		Effect.gen(function* () {
			const identity = (value: "webhook" | "bot" | "webhook_failed_bot") =>
				Effect.annotateCurrentSpan({ "chat_sync.identity": value })
			const target = yield* webhookOf(context)
			if (Option.isNone(target)) return yield* identity("bot").pipe(Effect.andThen(bot))
			const sent = yield* webhook(target.value).pipe(
				Effect.map(Option.some),
				Effect.catchTag("ChatSyncProviderApiError", (error) =>
					Effect.logWarning(
						"Discord webhook call failed; falling back to the bot",
						Cause.fail(error),
					).pipe(Effect.as(Option.none<A>())),
				),
			)
			if (Option.isSome(sent)) return yield* identity("webhook").pipe(Effect.as(sent.value))
			return yield* identity("webhook_failed_bot").pipe(Effect.andThen(bot))
		})

	const client: ChatSyncClient = {
		// The bot is in every channel of a guild it was added to.
		prepareLink: () => Effect.void,
		postMessage: Effect.fn("DiscordChatSyncClient.postMessage")(function* (context, message) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, replyToMessageId: message.replyToExternalMessageId })
			const content = formatMessageContentWithAttachments({
				content: message.content,
				attachments: message.attachments,
				maxLength: discord.maxMessageLength,
			})
			yield* requireContent(content)
			const id = yield* withWebhookFallback(
				context,
				(webhook) =>
					api
						.executeWebhookMessage({
							...webhook,
							content,
							replyToExternalMessageId: message.replyToExternalMessageId,
							username: message.author.name || "Discord User",
							...(message.author.avatarUrl ? { avatarUrl: message.author.avatarUrl } : {}),
						})
						.pipe(Effect.mapError(apiError)),
				viaBot((token) =>
					api.createMessage({
						channelId,
						content,
						replyToMessageId: message.replyToExternalMessageId,
						botToken: token,
					}),
				),
			)
			return id as ExternalMessageId
		}),
		updateMessage: Effect.fn("DiscordChatSyncClient.updateMessage")(function* (context, message) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, messageId: message.externalMessageId })
			const content = formatMessageContentWithAttachments({
				content: message.content,
				attachments: message.attachments,
				maxLength: discord.maxMessageLength,
			})
			yield* requireContent(content)
			yield* withWebhookFallback(
				context,
				(webhook) =>
					api
						.updateWebhookMessage({
							...webhook,
							webhookMessageId: message.externalMessageId,
							content,
						})
						.pipe(Effect.asVoid, Effect.mapError(apiError)),
				viaBot((token) =>
					api.updateMessage({
						channelId,
						messageId: message.externalMessageId,
						content,
						botToken: token,
					}),
				).pipe(Effect.asVoid),
			)
		}),
		deleteMessage: Effect.fn("DiscordChatSyncClient.deleteMessage")(function* (context, message) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, messageId: message.externalMessageId })
			yield* withWebhookFallback(
				context,
				(webhook) =>
					api
						.deleteWebhookMessage({ ...webhook, webhookMessageId: message.externalMessageId })
						.pipe(Effect.asVoid, Effect.mapError(apiError)),
				viaBot((token) =>
					api.deleteMessage({
						channelId,
						messageId: message.externalMessageId,
						botToken: token,
					}),
				).pipe(Effect.asVoid),
			)
		}),
		addReaction: Effect.fn("DiscordChatSyncClient.addReaction")(function* (context, reaction) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, messageId: reaction.externalMessageId })
			if (!reaction.emoji.trim()) return yield* configError("Reaction emoji cannot be empty")
			yield* viaBot((token) =>
				api.addReaction({
					channelId,
					messageId: reaction.externalMessageId,
					emoji: discord.emojiToProvider(reaction.emoji),
					botToken: token,
				}),
			)
		}),
		removeReaction: Effect.fn("DiscordChatSyncClient.removeReaction")(function* (context, reaction) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, messageId: reaction.externalMessageId })
			if (!reaction.emoji.trim()) return yield* configError("Reaction emoji cannot be empty")
			yield* viaBot((token) =>
				api.removeReaction({
					channelId,
					messageId: reaction.externalMessageId,
					emoji: discord.emojiToProvider(reaction.emoji),
					botToken: token,
				}),
			)
		}),
		createThread: Effect.fn("DiscordChatSyncClient.createThread")(function* (context, thread) {
			const channelId = context.link.externalChannelId
			yield* requireIds({ channelId, messageId: thread.externalMessageId })
			const name = thread.name.trim()
			if (!name) return yield* configError("Thread name cannot be empty")
			if (name.length > discord.maxThreadNameLength)
				return yield* configError("Thread name is too long")
			const token = yield* botToken
			const id = yield* api
				.createThread({ channelId, messageId: thread.externalMessageId, name, botToken: token })
				.pipe(
					Effect.retry({
						while: isRetryableAnswer,
						schedule: RETRY_SCHEDULE,
					}),
					// Already made (an earlier attempt landed but its answer or our write was lost):
					// a message's thread has the message's id, so take that one.
					Effect.catchIf(
						(error) =>
							error._tag === "DiscordApiError" &&
							error.code === Discord.DISCORD_THREAD_ALREADY_CREATED,
						() => Effect.succeed(thread.externalMessageId as string),
					),
					Effect.mapError(apiError),
				)
			return id as ExternalThreadId
		}),
	}
	return client
})
