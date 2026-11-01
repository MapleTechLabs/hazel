/**
 * Chat sync's effect kinds (`infra/durable-object-sync-plan.md` §4). Defined here and merged into
 * each receiving side's registry (`worker/objects/effects/*-effects.ts`). Payloads may be in an
 * outbox across a deploy: change them additively only.
 *
 * Inbound (provider → Hazel): a provider's source (`chat-sync-inbound.ts`) resolves the `OrgObject` through the directory's
 * `chat_sync_index` and applies `org.chatSyncIngest` there; the org finds the link and the author,
 * then sends `channel.chatSyncIngest` to the linked channel, which writes the message.
 *
 * Outbound (Hazel → provider): a message or reaction write in a `ChannelObject` enqueues
 * `chatSync.outbound` per outbound link (`chat-sync-outbound.ts`); the channel's own outbox
 * delivers it to the provider's REST API. Inbound writes never enqueue it (no echo).
 */
import {
	ChannelId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	ExternalUserId,
	ExternalWebhookId,
	MessageId,
	MessageReactionId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Context, Schema } from "effect"
import { UserProjection } from "../../worker/objects/org/projections"
import { defineEffect } from "../../worker/objects/effects/registry"

export const ChatSyncDirection = Schema.Literals(["both", "hazel_to_external", "external_to_hazel"])
export type ChatSyncDirection = typeof ChatSyncDirection.Type

const Settings = Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown))

/** One active link of a channel, as its `ChannelObject` keeps it (`channel.setChatSyncLinks`). */
export const ChatSyncChannelTarget = Schema.Struct({
	channelLinkId: SyncChannelLinkId,
	syncConnectionId: SyncConnectionId,
	organizationId: OrganizationId,
	provider: Schema.String,
	/** The provider workspace (Discord guild, Slack team); absent on links projected before it. */
	externalWorkspaceId: Schema.optional(Schema.String),
	externalChannelId: ExternalChannelId,
	direction: ChatSyncDirection,
	settings: Settings,
})
export type ChatSyncChannelTarget = typeof ChatSyncChannelTarget.Type

/** A Hazel user's linked provider account (`integration_connections`, level `user`). */
export const ChatSyncLinkedAccount = Schema.Struct({
	userId: UserId,
	provider: Schema.String,
	externalAccountId: Schema.String,
})
export type ChatSyncLinkedAccount = typeof ChatSyncLinkedAccount.Type

/** The channel's links and the org's linked accounts (mentions), replacing the previous ones. */
export const SetChatSyncLinksPayload = Schema.Struct({
	links: Schema.Array(ChatSyncChannelTarget),
	accounts: Schema.Array(ChatSyncLinkedAccount),
})
export type SetChatSyncLinksPayload = typeof SetChatSyncLinksPayload.Type

export const ChatSyncAttachment = Schema.Struct({
	externalAttachmentId: Schema.NullOr(Schema.String),
	fileName: Schema.String,
	fileSize: Schema.Number,
	publicUrl: Schema.String,
})
export type ChatSyncAttachment = typeof ChatSyncAttachment.Type

/** A provider user an inbound message mentions, for a readable name when they map to nobody. */
export const ChatSyncMention = Schema.Struct({
	externalUserId: ExternalUserId,
	displayName: Schema.String,
})
export type ChatSyncMention = typeof ChatSyncMention.Type

/**
 * A provider event as its source (gateway, events webhook) saw it; the org resolves its link and
 * author. `content` is in the provider's syntax; the org turns its mentions into Hazel's.
 */
export const ChatSyncInboundEvent = Schema.TaggedUnion({
	MessageCreate: {
		externalMessageId: ExternalMessageId,
		externalWebhookId: Schema.NullOr(ExternalWebhookId),
		content: Schema.String,
		externalReplyToMessageId: Schema.NullOr(ExternalMessageId),
		attachments: Schema.Array(ChatSyncAttachment),
		mentions: Schema.optional(Schema.Array(ChatSyncMention)),
	},
	MessageUpdate: {
		externalMessageId: ExternalMessageId,
		externalWebhookId: Schema.NullOr(ExternalWebhookId),
		content: Schema.String,
		mentions: Schema.optional(Schema.Array(ChatSyncMention)),
	},
	MessageDelete: {
		externalMessageId: ExternalMessageId,
		externalWebhookId: Schema.NullOr(ExternalWebhookId),
	},
	ReactionAdd: { externalMessageId: ExternalMessageId, emoji: Schema.String },
	ReactionRemove: { externalMessageId: ExternalMessageId, emoji: Schema.String },
	ThreadCreate: {
		externalThreadId: ExternalThreadId,
		name: Schema.String,
		/** The synced message the thread was started on, when it has one. */
		externalParentMessageId: Schema.optional(ExternalMessageId),
	},
})
export type ChatSyncInboundEvent = typeof ChatSyncInboundEvent.Type

/** `org.chatSyncIngest`: applied by a provider source at each org indexed for the external channel. */
export const OrgChatSyncIngestPayload = Schema.Struct({
	provider: Schema.String,
	externalChannelId: ExternalChannelId,
	dedupeKey: Schema.String,
	/**
	 * Who acted, already upserted into the directory: the provider user's shadow (or the
	 * integration bot when the event names nobody). `externalUserId` finds a linked Hazel user.
	 */
	author: Schema.NullOr(
		Schema.Struct({ externalUserId: Schema.NullOr(ExternalUserId), user: UserProjection }),
	),
	event: ChatSyncInboundEvent,
})
export type OrgChatSyncIngestPayload = typeof OrgChatSyncIngestPayload.Type

/** An inbound write for the linked channel, its link and author resolved by the org. */
export const ChannelIngestEvent = Schema.TaggedUnion({
	MessageCreate: {
		externalMessageId: ExternalMessageId,
		content: Schema.String,
		authorId: UserId,
		externalReplyToMessageId: Schema.NullOr(ExternalMessageId),
		attachments: Schema.Array(ChatSyncAttachment),
	},
	MessageUpdate: { externalMessageId: ExternalMessageId, content: Schema.String },
	MessageDelete: { externalMessageId: ExternalMessageId },
	ReactionAdd: { externalMessageId: ExternalMessageId, userId: UserId, emoji: Schema.String },
	ReactionRemove: { externalMessageId: ExternalMessageId, userId: UserId, emoji: Schema.String },
})
export type ChannelIngestEvent = typeof ChannelIngestEvent.Type

export const ChannelChatSyncIngestPayload = Schema.Struct({
	organizationId: OrganizationId,
	channelId: ChannelId,
	syncConnectionId: SyncConnectionId,
	channelLinkId: SyncChannelLinkId,
	dedupeKey: Schema.String,
	event: ChannelIngestEvent,
})
export type ChannelChatSyncIngestPayload = typeof ChannelChatSyncIngestPayload.Type

/** Point a synced message at the Hazel thread made for its provider thread (in the parent channel). */
export const AttachThreadPayload = Schema.Struct({
	channelLinkId: SyncChannelLinkId,
	externalMessageId: ExternalMessageId,
	threadChannelId: ChannelId,
	externalThreadId: ExternalThreadId,
})
export type AttachThreadPayload = typeof AttachThreadPayload.Type

/** Re-attribute the channel's provider-synced messages (a provider account was linked or unlinked). */
export const ReassignAuthorsPayload = Schema.Struct({
	channelLinkIds: Schema.Array(SyncChannelLinkId),
	fromAuthorId: UserId,
	toAuthorId: UserId,
})
export type ReassignAuthorsPayload = typeof ReassignAuthorsPayload.Type

/** A link's settings changed from the channel side (a provisioned or refused webhook identity). */
export const LinkSettingsPayload = Schema.Struct({
	channelLinkId: SyncChannelLinkId,
	settings: Schema.Record(Schema.String, Schema.Unknown),
})
export type LinkSettingsPayload = typeof LinkSettingsPayload.Type

/** A Hazel write to mirror on one link's provider channel. */
export const ChatSyncOutboundEvent = Schema.TaggedUnion({
	MessageCreate: { messageId: MessageId },
	MessageUpdate: { messageId: MessageId, version: Schema.String },
	MessageDelete: { messageId: MessageId },
	ReactionCreate: { reactionId: MessageReactionId, messageId: MessageId, emoji: Schema.String },
	ReactionDelete: { messageId: MessageId, emoji: Schema.String, userId: UserId },
	/** A Hazel thread started on `messageId` (`channel.setThreadChannel` in the parent). */
	ThreadCreate: { messageId: MessageId, threadChannelId: ChannelId },
})
export type ChatSyncOutboundEvent = typeof ChatSyncOutboundEvent.Type

export const ChatSyncOutboundPayload = Schema.Struct({
	channelLinkId: SyncChannelLinkId,
	event: ChatSyncOutboundEvent,
})
export type ChatSyncOutboundPayload = typeof ChatSyncOutboundPayload.Type

/** A provider thread was created for a Hazel thread: link it like its parent (from the parent channel). */
export const LinkThreadPayload = Schema.Struct({
	/** The parent channel's link the thread was created under. */
	channelLinkId: SyncChannelLinkId,
	threadChannelId: ChannelId,
	externalThreadId: ExternalThreadId,
	externalThreadName: Schema.String,
})
export type LinkThreadPayload = typeof LinkThreadPayload.Type

/** A `chat_sync_index` row: a connection (`externalChannelId: null`) or one of its links. */
export const ChatSyncIndexPayload = Schema.Struct({
	provider: Schema.String,
	externalWorkspaceId: Schema.String,
	externalChannelId: Schema.NullOr(Schema.String),
	organizationId: OrganizationId,
	channelId: Schema.NullOr(ChannelId),
})
export type ChatSyncIndexPayload = typeof ChatSyncIndexPayload.Type

export const ChatSyncChannelEffects = {
	setChatSyncLinks: defineEffect("channel.setChatSyncLinks", "channel", SetChatSyncLinksPayload),
	chatSyncIngest: defineEffect("channel.chatSyncIngest", "channel", ChannelChatSyncIngestPayload),
	chatSyncReassignAuthors: defineEffect(
		"channel.chatSyncReassignAuthors",
		"channel",
		ReassignAuthorsPayload,
	),
	chatSyncAttachThread: defineEffect("channel.chatSyncAttachThread", "channel", AttachThreadPayload),
}

export const ChatSyncOrgEffects = {
	chatSyncIngest: defineEffect("org.chatSyncIngest", "org", OrgChatSyncIngestPayload),
	chatSyncLinkSettings: defineEffect("org.chatSyncLinkSettings", "org", LinkSettingsPayload),
	chatSyncLinkThread: defineEffect("org.chatSyncLinkThread", "org", LinkThreadPayload),
}

export const ChatSyncDirectoryEffects = {
	upsertChatSyncIndex: defineEffect("directory.upsertChatSyncIndex", "directory", ChatSyncIndexPayload),
	deleteChatSyncIndex: defineEffect("directory.deleteChatSyncIndex", "directory", ChatSyncIndexPayload),
}

export const ChatSyncDeliveryEffects = {
	outbound: defineEffect("chatSync.outbound", "chat-sync", ChatSyncOutboundPayload),
}

/**
 * Set while a `ChannelObject` writes an inbound provider event: its message events must not
 * produce `chatSync.outbound` (no echo back to the provider).
 */
export const InboundChatSyncWrite = Context.Reference<boolean>("@hazel/backend/InboundChatSyncWrite", {
	defaultValue: () => false,
})
