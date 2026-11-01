/**
 * The chat-sync provider contract. A provider is two halves:
 *
 * - `ChatSyncProviderDefinition`: pure facts and formatting (limits, how threads work, mention and
 *   emoji syntax, own-echo detection). Read anywhere, no IO.
 * - `ChatSyncClient`: the provider's API, as an outbound delivery calls it from a `ChannelObject`.
 *   It owns how a message is attributed (Discord: a webhook per channel; Slack: a custom username
 *   and icon), and saves any identity it provisions through the link context.
 *
 * The core (`chat-sync-org.ts`, `chat-sync-channel.ts`, `chat-sync-outbound.ts`) knows only this
 * contract; each provider lives in `providers/<id>/`.
 */
import { Database } from "@hazel/db"
import type { ExternalMessageId, ExternalThreadId, ExternalWebhookId } from "@hazel/schema"
import { type Effect, Schema } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import type { ChatSyncOutboundAttachment } from "./chat-sync-attachment-content"
import type { ChatSyncChannelTarget } from "./chat-sync-effects"

export type { ChatSyncOutboundAttachment }

export const ChatSyncProviderId = Schema.Literals(["discord"])
export type ChatSyncProviderId = typeof ChatSyncProviderId.Type

export const isChatSyncProviderId = Schema.is(ChatSyncProviderId)

export class ChatSyncProviderNotSupportedError extends Schema.TaggedError<ChatSyncProviderNotSupportedError>()(
	"ChatSyncProviderNotSupportedError",
	{ provider: Schema.String },
) {}

/** The provider is not set up here (a missing token or setting); retrying will not help. */
export class ChatSyncProviderConfigurationError extends Schema.TaggedError<ChatSyncProviderConfigurationError>()(
	"ChatSyncProviderConfigurationError",
	{ provider: Schema.String, message: Schema.String },
) {}

/** The provider answered with an error, or could not be reached (no `status`: retryable). */
export class ChatSyncProviderApiError extends Schema.TaggedError<ChatSyncProviderApiError>()(
	"ChatSyncProviderApiError",
	{
		provider: Schema.String,
		message: Schema.String,
		status: Schema.optional(Schema.Number),
		detail: Schema.optional(Schema.String),
	},
) {}

export type ChatSyncClientError = ChatSyncProviderConfigurationError | ChatSyncProviderApiError

/** Whether another attempt at a provider call may succeed: transport failures, 408, 429, 5xx. */
export const isRetryableStatus = (status: number | undefined) =>
	status === undefined || status === 408 || status === 429 || status >= 500

export interface ChatSyncProviderDefinition {
	readonly id: ChatSyncProviderId
	/** Shown to people: the integration bot's name, "Connect Discord". */
	readonly displayName: string
	readonly maxMessageLength: number
	readonly maxThreadNameLength: number
	/** Renders a mention of a provider user (`<@123>`). */
	readonly mention: (externalUserId: string) => string
	/** Matches the provider's user mentions in inbound text; group 1 is the external user id. */
	readonly mentionPattern: RegExp
	/** A Hazel reaction emoji as the provider names it, and back. */
	readonly emojiToProvider: (emoji: string) => string
	readonly emojiFromProvider: (emoji: string) => string
	/**
	 * Whether an inbound event is Hazel's own outbound message coming back (posted through an
	 * identity the link provisioned, which the source could not tell from a person).
	 */
	readonly isOwnEcho: (
		settings: Record<string, unknown> | null,
		externalWebhookId: ExternalWebhookId | null,
	) => boolean
}

/** Who wrote a Hazel message, for providers that can post under a person's name. */
export interface ChatSyncAuthor {
	readonly name: string
	readonly avatarUrl: string | null
}

/** Saving link settings failed (`DatabaseError` is retried, the rest settle the delivery). */
export type ChatSyncSaveSettingsError = Database.DatabaseError | SqlError | Schema.SchemaError

/** The link a client call is for, and how to persist link settings the client changed. */
export interface ChatSyncLinkContext {
	readonly link: ChatSyncChannelTarget
	readonly saveSettings: (
		settings: Record<string, unknown>,
	) => Effect.Effect<void, ChatSyncSaveSettingsError>
}

export interface ChatSyncClient {
	readonly postMessage: (
		context: ChatSyncLinkContext,
		message: {
			readonly content: string
			readonly attachments: ReadonlyArray<ChatSyncOutboundAttachment>
			readonly replyToExternalMessageId: ExternalMessageId | undefined
			readonly author: ChatSyncAuthor
		},
	) => Effect.Effect<ExternalMessageId, ChatSyncClientError | ChatSyncSaveSettingsError>
	readonly updateMessage: (
		context: ChatSyncLinkContext,
		message: {
			readonly externalMessageId: ExternalMessageId
			readonly content: string
			readonly attachments: ReadonlyArray<ChatSyncOutboundAttachment>
		},
	) => Effect.Effect<void, ChatSyncClientError | ChatSyncSaveSettingsError>
	readonly deleteMessage: (
		context: ChatSyncLinkContext,
		message: { readonly externalMessageId: ExternalMessageId },
	) => Effect.Effect<void, ChatSyncClientError | ChatSyncSaveSettingsError>
	readonly addReaction: (
		context: ChatSyncLinkContext,
		reaction: { readonly externalMessageId: ExternalMessageId; readonly emoji: string },
	) => Effect.Effect<void, ChatSyncClientError>
	readonly removeReaction: (
		context: ChatSyncLinkContext,
		reaction: { readonly externalMessageId: ExternalMessageId; readonly emoji: string },
	) => Effect.Effect<void, ChatSyncClientError>
	/**
	 * Start a provider thread on a synced message. The id it answers is the thread's external
	 * channel id: where its replies are posted, and what its channel link is keyed by.
	 */
	readonly createThread: (
		context: ChatSyncLinkContext,
		thread: { readonly externalMessageId: ExternalMessageId; readonly name: string },
	) => Effect.Effect<ExternalThreadId, ChatSyncClientError>
}
