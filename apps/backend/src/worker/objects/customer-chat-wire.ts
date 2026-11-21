/**
 * What crosses between objects for the author side of messages in channels linked to customers
 * (`docs/customers/author-side.md`): wire schemas and effect kinds. A leaf module.
 *
 * - `OrgObject` → `CustomersObject`: `customers.chatMessage` (each message in a linked channel, its
 *   author classified), `customers.inboxMessage` (each message in a support inbox's channel),
 *   `customers.chatAuthorChanged` (a member changed someone's side), `customers.chatAuthorsBackfill`
 *   (a newly linked channel's past authors).
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
	/**
	 * Set when the message is in a support inbox (an email mailbox's channel) rather than a channel
	 * linked to the customer: `accountId` was matched from the sender, not from a channel link.
	 */
	inbox: Schema.optionalKey(Schema.Literals(["email"])),
})
export type ChatMessagePayload = typeof ChatMessagePayload.Type

/**
 * A message in a support inbox's channel or one of its threads (`docs/customers/email.md`): its
 * account is matched by the customers object, from the sender (a new conversation) or the
 * conversation's issue (a reply).
 */
export const InboxMessagePayload = Schema.Struct({
	organizationId: OrganizationId,
	/** The inbox's channel (a thread's parent). */
	channelId: ChannelId,
	messageChannelId: ChannelId,
	messageId: MessageId,
	createdAt: Timestamp,
	author: ChatAuthorWire,
	threadRootMessageId: Schema.NullOr(MessageId),
	content: Schema.String,
	inbox: Schema.Literals(["email"]),
})
export type InboxMessagePayload = typeof InboxMessagePayload.Type

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
	inboxMessage: defineEffect("customers.inboxMessage", "customers", InboxMessagePayload),
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
	/** One per link: outbox ids carry it, so a channel linked again is asked again. */
	requestId: Schema.String,
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
	requestId: Schema.String,
	authors: Schema.Array(ReportedChatAuthor),
})
export type ChatAuthorsReportedPayload = typeof ChatAuthorsReportedPayload.Type

export const CustomerChatChannelEffects = {
	reportChatAuthors: defineEffect("channel.reportChatAuthors", "channel", ReportChatAuthorsPayload),
}

export const CustomerChatOrgEffects = {
	chatAuthorsReported: defineEffect("org.chatAuthorsReported", "org", ChatAuthorsReportedPayload),
}
