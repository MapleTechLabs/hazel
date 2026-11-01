/**
 * Slack's chat-sync client: the Web API with the workspace's bot token (`chat_sync_installations`).
 * Every message is posted under its Hazel author's name and avatar (`chat:write.customize`), so
 * a link needs no per-author identity of its own. A Hazel thread is replies to the synced message
 * (`thread_ts`); creating one is only naming it.
 */
import { Slack } from "@hazel/integrations"
import type { ExternalMessageId, ExternalThreadId } from "@hazel/schema"
import { Effect, Option, Redacted } from "effect"
import { formatMessageContentWithAttachments } from "../../chat-sync-attachment-content"
import { ChatSyncInstallations } from "../../chat-sync-installations"
import {
	type ChatSyncClient,
	ChatSyncProviderApiError,
	ChatSyncProviderConfigurationError,
} from "../../provider"
import { slack, slackTarget } from "./definition"

const configError = (message: string) =>
	new ChatSyncProviderConfigurationError({ provider: "slack", message })

const SLACK_TOKEN_ERRORS = new Set<string>(Slack.SLACK_TOKEN_ERRORS)
const SLACK_TRANSIENT_ERRORS = new Set<string>(Slack.SLACK_TRANSIENT_ERRORS)

export const makeSlackClient = Effect.gen(function* () {
	const api = yield* Slack.SlackApiClient
	const installations = yield* ChatSyncInstallations

	/** The workspace's bot token; a missing install is a configuration error (no retry). */
	const tokenFor = (externalWorkspaceId: string | undefined) =>
		Effect.gen(function* () {
			if (externalWorkspaceId === undefined) {
				return yield* configError("The link has no Slack workspace")
			}
			const token = yield* installations.token("slack", externalWorkspaceId).pipe(
				Effect.catchTags({
					// A directory blip: retry the delivery.
					DatabaseError: (error) =>
						Effect.fail(
							new ChatSyncProviderApiError({ provider: "slack", message: error.message }),
						),
					IntegrationEncryptionError: () =>
						Effect.fail(configError("The Slack token cannot be decrypted")),
					KeyVersionNotFoundError: () => Effect.fail(configError("The Slack token's key is gone")),
				}),
			)
			if (Option.isNone(token)) {
				return yield* configError("Hazel is not installed in this Slack workspace")
			}
			return Redacted.value(token.value)
		})

	/**
	 * Slack's answer as a chat-sync error. An `ok: false` answer is final (a dead token also drops
	 * the cached one) unless Slack calls it transient; HTTP 429/5xx and transport failures retry.
	 */
	const toChatSyncError =
		(externalWorkspaceId: string | undefined) =>
		(
			error: Slack.SlackApiError,
		): Effect.Effect<never, ChatSyncProviderApiError | ChatSyncProviderConfigurationError> => {
			if (error.reason === "api") {
				if (SLACK_TOKEN_ERRORS.has(error.message)) {
					return Effect.andThen(
						externalWorkspaceId === undefined
							? Effect.void
							: installations.invalidate("slack", externalWorkspaceId),
						Effect.fail(configError(`Slack refused the bot token (${error.message})`)),
					)
				}
				return Effect.fail(
					new ChatSyncProviderApiError({
						provider: "slack",
						message: error.message,
						status:
							error.message === "ratelimited"
								? 429
								: SLACK_TRANSIENT_ERRORS.has(error.message)
									? 503
									: 400,
						detail: `slack_${error.method}_${error.message}`,
					}),
				)
			}
			return Effect.fail(
				new ChatSyncProviderApiError({
					provider: "slack",
					message: error.message,
					status: error.status,
					detail: `slack_${error.method}_${error.reason}`,
				}),
			)
		}

	/** A Web API call with the workspace's token, its failure mapped. */
	const call = <A>(
		externalWorkspaceId: string | undefined,
		request: (token: string) => Effect.Effect<A, Slack.SlackApiError>,
	) =>
		tokenFor(externalWorkspaceId).pipe(
			Effect.flatMap((token) =>
				request(token).pipe(Effect.catchTag("SlackApiError", toChatSyncError(externalWorkspaceId))),
			),
		)

	const emojiName = (emoji: string) => {
		const name = Slack.unicodeToSlackEmoji(emoji)
		return name === null
			? Effect.fail(configError(`Slack has no name for ${emoji}`))
			: Effect.succeed(name)
	}

	const client: ChatSyncClient = {
		prepareLink: Effect.fn("SlackChatSyncClient.prepareLink")(function* (link) {
			const { channel } = slackTarget(link.externalChannelId)
			yield* call(link.externalWorkspaceId, (token) => api.joinChannel(token, channel))
		}),
		postMessage: Effect.fn("SlackChatSyncClient.postMessage")(function* (context, message) {
			const { channel, threadTs } = slackTarget(context.link.externalChannelId)
			yield* Effect.annotateCurrentSpan({
				"chat_sync.identity": "author",
				"chat_sync.thread": !!threadTs,
			})
			const text = formatMessageContentWithAttachments({
				content: message.content,
				attachments: message.attachments,
				maxLength: slack.maxMessageLength,
			})
			if (text.trim().length === 0) return yield* configError("Message content cannot be empty")
			const posted = yield* call(context.link.externalWorkspaceId, (token) =>
				api.postMessage(token, {
					channel,
					text,
					...(threadTs === undefined ? {} : { threadTs }),
					username: message.author.name || "Hazel",
					...(message.author.avatarUrl ? { iconUrl: message.author.avatarUrl } : {}),
				}),
			)
			return posted.ts as ExternalMessageId
		}),
		updateMessage: Effect.fn("SlackChatSyncClient.updateMessage")(function* (context, message) {
			const { channel } = slackTarget(context.link.externalChannelId)
			const text = formatMessageContentWithAttachments({
				content: message.content,
				attachments: message.attachments,
				maxLength: slack.maxMessageLength,
			})
			if (text.trim().length === 0) return yield* configError("Message content cannot be empty")
			yield* call(context.link.externalWorkspaceId, (token) =>
				api.updateMessage(token, { channel, ts: message.externalMessageId, text }),
			)
		}),
		deleteMessage: Effect.fn("SlackChatSyncClient.deleteMessage")(function* (context, message) {
			const { channel } = slackTarget(context.link.externalChannelId)
			yield* call(context.link.externalWorkspaceId, (token) =>
				api.deleteMessage(token, { channel, ts: message.externalMessageId }),
			)
		}),
		addReaction: Effect.fn("SlackChatSyncClient.addReaction")(function* (context, reaction) {
			const { channel } = slackTarget(context.link.externalChannelId)
			const name = yield* emojiName(reaction.emoji)
			yield* call(context.link.externalWorkspaceId, (token) =>
				api.addReaction(token, { channel, ts: reaction.externalMessageId, name }),
			)
		}),
		removeReaction: Effect.fn("SlackChatSyncClient.removeReaction")(function* (context, reaction) {
			const { channel } = slackTarget(context.link.externalChannelId)
			const name = yield* emojiName(reaction.emoji)
			yield* call(context.link.externalWorkspaceId, (token) =>
				api.removeReaction(token, { channel, ts: reaction.externalMessageId, name }),
			)
		}),
		// Replies to the synced message are the thread: its link is keyed by the message's ts.
		createThread: (context, thread) =>
			Effect.succeed(
				slack.threadChannelId(
					context.link.externalChannelId,
					thread.externalMessageId,
				) as ExternalThreadId,
			),
	}
	return client
})
