/**
 * What crosses between objects for the author side of messages in channels linked to customers
 * (`docs/customers/author-side.md`): wire schemas and effect kinds. A leaf module.
 *
 * - `OrgObject` → `CustomersObject`: `customers.chatMessage` (each message in a linked channel, its
 *   author classified), `customers.chatAuthorChanged` (a member changed someone's side),
 *   `customers.chatAuthorsBackfill` (a newly linked channel's past authors).
 * - `OrgObject` → `ChannelObject`: `channel.reportChatAuthors` asks a linked channel (or one of its
 *   threads) for its authors; the channel answers `org.chatAuthorsReported`.
 */
import { AuthorSide, AuthorSideReason } from "@hazel/domain/customers"
import { ChannelId, CustomerAccountId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineEffect } from "./effects/registry"

/** ISO timestamp text. */
const Timestamp = Schema.String

/** An author as the org classified them, with what the customer page shows of them. */
export const ChatAuthorWire = Schema.Struct({
	userId: UserId,
	side: AuthorSide,
	reason: AuthorSideReason,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	/** A real address only (chat-sync shadows have none): matches the account's contacts. */
	email: Schema.NullOr(Schema.String),
})
export type ChatAuthorWire = typeof ChatAuthorWire.Type

export const ChatMessagePayload = Schema.Struct({
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	/** The linked channel (a thread's parent). */
	channelId: ChannelId,
	/** Where the message is: the linked channel or one of its threads. */
	messageChannelId: ChannelId,
	messageId: MessageId,
	createdAt: Timestamp,
	author: ChatAuthorWire,
	/** A thread reply's root message (in `channelId`): support issues are keyed on it. */
	threadRootMessageId: Schema.optionalKey(Schema.NullOr(MessageId)),
	/** The text, shortened: a support issue's title when the message opens one. */
	content: Schema.optionalKey(Schema.String),
})
export type ChatMessagePayload = typeof ChatMessagePayload.Type

export const ChatAuthorChangedPayload = Schema.Struct({
	organizationId: OrganizationId,
	author: ChatAuthorWire,
})
export type ChatAuthorChangedPayload = typeof ChatAuthorChangedPayload.Type

export const ChatAuthorsBackfillPayload = Schema.Struct({
	organizationId: OrganizationId,
	accountId: CustomerAccountId,
	channelId: ChannelId,
	authors: Schema.Array(
		Schema.Struct({ author: ChatAuthorWire, firstMessageAt: Timestamp, lastMessageAt: Timestamp }),
	),
})
export type ChatAuthorsBackfillPayload = typeof ChatAuthorsBackfillPayload.Type

export const CustomerChatEffects = {
	chatMessage: defineEffect("customers.chatMessage", "customers", ChatMessagePayload),
	chatAuthorChanged: defineEffect("customers.chatAuthorChanged", "customers", ChatAuthorChangedPayload),
	chatAuthorsBackfill: defineEffect(
		"customers.chatAuthorsBackfill",
		"customers",
		ChatAuthorsBackfillPayload,
	),
}

export const ReportChatAuthorsPayload = Schema.Struct({
	organizationId: OrganizationId,
	/** The linked channel the report is for (this channel, or the parent of this thread). */
	linkedChannelId: ChannelId,
})
export type ReportChatAuthorsPayload = typeof ReportChatAuthorsPayload.Type

/** One author of a channel's live messages. */
export const ReportedChatAuthor = Schema.Struct({
	userId: UserId,
	firstMessageAt: Timestamp,
	lastMessageAt: Timestamp,
})

export const ChatAuthorsReportedPayload = Schema.Struct({
	linkedChannelId: ChannelId,
	authors: Schema.Array(ReportedChatAuthor),
	/** The channel's threads (none from a thread), each asked in turn. */
	threadChannelIds: Schema.Array(ChannelId),
})
export type ChatAuthorsReportedPayload = typeof ChatAuthorsReportedPayload.Type

export const CustomerChatChannelEffects = {
	reportChatAuthors: defineEffect("channel.reportChatAuthors", "channel", ReportChatAuthorsPayload),
}

export const CustomerChatOrgEffects = {
	chatAuthorsReported: defineEffect("org.chatAuthorsReported", "org", ChatAuthorsReportedPayload),
}
