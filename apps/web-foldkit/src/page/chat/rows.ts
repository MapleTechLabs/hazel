import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { MessageEmbed } from "@hazel/domain/models"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { AttachmentInfo } from "./lookups"

/**
 * Message list rows: the data the list renders, derived once per data change in `update` (port
 * of `processedMessages` + `messageRows` in `components/chat/message-list.tsx`). Unchanged rows
 * keep their object identity, so the row views' memoization hits.
 */

export const ChatAuthor = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.String,
})
export type ChatAuthor = typeof ChatAuthor.Type

export const ChatMessage = Schema.Struct({
	id: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	embeds: Schema.NullOr(MessageEmbed.MessageEmbeds),
	hasEmbeds: Schema.Boolean,
	replyToMessageId: Schema.NullOr(MessageId),
	threadChannelId: Schema.NullOr(ChannelId),
	createdAtMs: Schema.Number,
	updatedAtMs: Schema.NullOr(Schema.Number),
	isPinned: Schema.Boolean,
	author: Schema.NullOr(ChatAuthor),
})
export type ChatMessage = typeof ChatMessage.Type

export const ChatReaction = Schema.Struct({
	id: Schema.String,
	messageId: MessageId,
	userId: UserId,
	emoji: Schema.String,
})
export type ChatReaction = typeof ChatReaction.Type

export const AggregatedReaction = Schema.Struct({
	emoji: Schema.String,
	count: Schema.Number,
	hasReacted: Schema.Boolean,
	userIds: Schema.Array(UserId),
	/** Resolved for `custom:<name>` reactions from the org's custom emoji. */
	imageUrl: Schema.NullOr(Schema.String),
})
export type AggregatedReaction = typeof AggregatedReaction.Type

/** `buildChatAuthorIdentity`. */
export const AuthorIdentity = Schema.Struct({
	displayName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isBot: Schema.Boolean,
})
export type AuthorIdentity = typeof AuthorIdentity.Type

export const StatusEmoji = Schema.Struct({
	emoji: Schema.String,
	message: Schema.NullOr(Schema.String),
	expiresAtMs: Schema.NullOr(Schema.Number),
})
export type StatusEmoji = typeof StatusEmoji.Type

export const ReplyPreview = Schema.Struct({
	author: Schema.NullOr(AuthorIdentity),
	firstLine: Schema.String,
})
export type ReplyPreview = typeof ReplyPreview.Type

export const ThreadPreview = Schema.Struct({
	threadChannelId: ChannelId,
	customName: Schema.NullOr(Schema.String),
	count: Schema.Number,
	/** Null entries are authors whose user row has not synced (a placeholder square). */
	authors: Schema.Array(Schema.NullOr(AuthorIdentity)),
	lastReplyAtMs: Schema.NullOr(Schema.Number),
})
export type ThreadPreview = typeof ThreadPreview.Type

/** Names and image URLs the markdown viewer resolves for this message. */
export const MarkdownRefs = Schema.Struct({
	mentions: Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String })),
	emojis: Schema.Array(Schema.Struct({ name: Schema.String, imageUrl: Schema.String })),
})
export type MarkdownRefs = typeof MarkdownRefs.Type

export const GroupPosition = Schema.Literals(["start", "middle", "end", "standalone"])
export type GroupPosition = typeof GroupPosition.Type

export const MessageRowData = Schema.Struct({
	key: Schema.String,
	message: ChatMessage,
	groupPosition: GroupPosition,
	reactions: Schema.Array(AggregatedReaction),
	author: AuthorIdentity,
	status: Schema.NullOr(StatusEmoji),
	isDiscordSynced: Schema.Boolean,
	reply: Schema.NullOr(ReplyPreview),
	thread: Schema.NullOr(ThreadPreview),
	attachments: Schema.Array(AttachmentInfo),
	refs: MarkdownRefs,
})
export type MessageRowData = typeof MessageRowData.Type

export const DisplayRow = defineTaggedUnion({
	DateHeader: { key: Schema.String, label: Schema.String },
	MessageRow: MessageRowData.fields,
})
export type DisplayRow = typeof DisplayRow.Type
export type MessageRow = Extract<DisplayRow, { readonly _tag: "MessageRow" }>

/** Structural equality for row data (small objects), used to keep unchanged rows' identity. */
export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false
		return a.every((item, index) => deepEqual(item, b[index]))
	}
	if (Array.isArray(b)) return false
	const aKeys = Object.keys(a)
	const bRecord = b as Record<string, unknown>
	const aRecord = a as Record<string, unknown>
	return (
		aKeys.length === Object.keys(b).length &&
		aKeys.every((key) => key in bRecord && deepEqual(aRecord[key], bRecord[key]))
	)
}

/** Reuses the previous object for every message whose fields did not change. */
export const shareMessages = (
	previous: ReadonlyArray<ChatMessage>,
	next: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatMessage> => {
	const previousById = new Map(previous.map((message) => [message.id, message]))
	return next.map((message) => {
		const old = previousById.get(message.id)
		return old !== undefined && deepEqual(old, message) ? old : message
	})
}

/** Applies a change set: rows in `order`, upserts replacing, everything else kept by reference. */
export const applyMessageChanges = (
	previous: ReadonlyArray<ChatMessage>,
	order: ReadonlyArray<MessageId>,
	upserts: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatMessage> => {
	const byId = new Map(previous.map((message) => [message.id, message]))
	for (const message of upserts) {
		const old = byId.get(message.id)
		byId.set(message.id, old !== undefined && deepEqual(old, message) ? old : message)
	}
	const next = order.flatMap((id) => {
		const message = byId.get(id)
		return message === undefined ? [] : [message]
	})
	return next.length === previous.length && next.every((message, index) => message === previous[index])
		? previous
		: next
}

/** Keys of the date dividers, reusing the previous array when they did not change. */
export const shareStickyKeys = (previous: ReadonlyArray<string>, rows: ReadonlyArray<DisplayRow>) => {
	const next = rows.flatMap((row) => (row._tag === "DateHeader" ? [row.key] : []))
	return next.length === previous.length && next.every((key, index) => key === previous[index])
		? previous
		: next
}

/** Row keys for the list, reusing the previous array when nothing moved. */
export const shareKeys = (previous: ReadonlyArray<string>, rows: ReadonlyArray<DisplayRow>) =>
	previous.length === rows.length && rows.every((row, index) => row.key === previous[index])
		? previous
		: rows.map((row) => row.key)

/** Reuses `previous` when `next` holds the same ids in the same order. */
export const shareIds = <Id extends string>(previous: ReadonlyArray<Id>, next: ReadonlyArray<Id>) =>
	previous.length === next.length && next.every((id, index) => id === previous[index]) ? previous : next
