import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"

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
})
export type AggregatedReaction = typeof AggregatedReaction.Type

export const GroupPosition = Schema.Literals(["start", "middle", "end", "standalone"])
export type GroupPosition = typeof GroupPosition.Type

export const DisplayRow = defineTaggedUnion({
	DateHeader: { key: Schema.String, label: Schema.String },
	MessageRow: {
		key: Schema.String,
		message: ChatMessage,
		groupPosition: GroupPosition,
		reactions: Schema.Array(AggregatedReaction),
	},
})
export type DisplayRow = typeof DisplayRow.Type

const GROUP_THRESHOLD_MS = 3 * 60 * 1000

const toGroupPosition = (isGroupStart: boolean, isGroupEnd: boolean): GroupPosition =>
	isGroupStart && isGroupEnd ? "standalone" : isGroupStart ? "start" : isGroupEnd ? "end" : "middle"

const sameAuthor = (a: ChatAuthor | null, b: ChatAuthor | null) =>
	a === b ||
	(a !== null &&
		b !== null &&
		a.firstName === b.firstName &&
		a.lastName === b.lastName &&
		a.avatarUrl === b.avatarUrl &&
		a.userType === b.userType)

const sameMessage = (a: ChatMessage, b: ChatMessage) =>
	a.id === b.id &&
	a.content === b.content &&
	a.hasEmbeds === b.hasEmbeds &&
	a.replyToMessageId === b.replyToMessageId &&
	a.threadChannelId === b.threadChannelId &&
	a.createdAtMs === b.createdAtMs &&
	a.updatedAtMs === b.updatedAtMs &&
	a.isPinned === b.isPinned &&
	a.authorId === b.authorId &&
	sameAuthor(a.author, b.author)

/** Reuses the previous object for every message whose fields did not change. */
export const shareMessages = (
	previous: ReadonlyArray<ChatMessage>,
	next: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatMessage> => {
	const previousById = new Map(previous.map((message) => [message.id, message]))
	return next.map((message) => {
		const old = previousById.get(message.id)
		return old !== undefined && sameMessage(old, message) ? old : message
	})
}

/** `processedReactionsAtomFamily`: grouped by emoji in the order reactions arrived. */
export const aggregateReactions = (
	reactions: ReadonlyArray<ChatReaction>,
	currentUserId: string | undefined,
): ReadonlyMap<string, ReadonlyArray<AggregatedReaction>> => {
	const byMessage = new Map<
		string,
		Map<string, { count: number; hasReacted: boolean; userIds: UserId[] }>
	>()
	for (const reaction of reactions) {
		let byEmoji = byMessage.get(reaction.messageId)
		if (byEmoji === undefined) byMessage.set(reaction.messageId, (byEmoji = new Map()))
		let entry = byEmoji.get(reaction.emoji)
		if (entry === undefined)
			byEmoji.set(reaction.emoji, (entry = { count: 0, hasReacted: false, userIds: [] }))
		entry.count++
		entry.userIds.push(reaction.userId)
		if (reaction.userId === currentUserId) entry.hasReacted = true
	}
	return new Map(
		[...byMessage].map(([messageId, byEmoji]) => [
			messageId,
			[...byEmoji].map(([emoji, entry]) => ({ emoji, ...entry })),
		]),
	)
}

const sameReactions = (a: ReadonlyArray<AggregatedReaction>, b: ReadonlyArray<AggregatedReaction>) =>
	a === b ||
	(a.length === b.length &&
		a.every(
			(reaction, index) =>
				reaction.emoji === b[index]!.emoji &&
				reaction.count === b[index]!.count &&
				reaction.hasReacted === b[index]!.hasReacted &&
				reaction.userIds.join() === b[index]!.userIds.join(),
		))

const NO_REACTIONS: ReadonlyArray<AggregatedReaction> = []

/**
 * Oldest-first rows with a date header before each day; `messagesNewestFirst` is the query order.
 * Rows are plain literals: the tagged-union constructors validate, which costs ms per 10k rows.
 */
export const toDisplayRows = (
	messagesNewestFirst: ReadonlyArray<ChatMessage>,
	reactionsByMessage: ReadonlyMap<string, ReadonlyArray<AggregatedReaction>>,
	previousRows: ReadonlyArray<DisplayRow>,
): ReadonlyArray<DisplayRow> => {
	const previousByKey = new Map(previousRows.map((row) => [row.key, row]))
	const rows: DisplayRow[] = []
	let lastDate = ""
	const count = messagesNewestFirst.length
	for (let index = count - 1; index >= 0; index--) {
		const message = messagesNewestFirst[index]!
		const previous = index < count - 1 ? messagesNewestFirst[index + 1]! : null
		const next = index > 0 ? messagesNewestFirst[index - 1]! : null
		const isGroupStart =
			previous === null ||
			message.authorId !== previous.authorId ||
			message.createdAtMs - previous.createdAtMs > GROUP_THRESHOLD_MS ||
			previous.replyToMessageId !== null
		const isGroupEnd =
			next === null ||
			message.authorId !== next.authorId ||
			next.createdAtMs - message.createdAtMs > GROUP_THRESHOLD_MS

		const date = new Date(message.createdAtMs).toDateString()
		if (date !== lastDate) {
			const key = `header-${date}`
			const old = previousByKey.get(key)
			rows.push(
				old !== undefined && old._tag === "DateHeader"
					? old
					: { _tag: "DateHeader", key, label: date },
			)
			lastDate = date
		}

		const groupPosition = toGroupPosition(isGroupStart, isGroupEnd)
		const reactions = reactionsByMessage.get(message.id) ?? NO_REACTIONS
		const old = previousByKey.get(message.id)
		rows.push(
			old !== undefined &&
				old._tag === "MessageRow" &&
				old.message === message &&
				old.groupPosition === groupPosition &&
				sameReactions(old.reactions, reactions)
				? old
				: { _tag: "MessageRow", key: message.id, message, groupPosition, reactions },
		)
	}
	return rows
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
