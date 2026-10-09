import type { ChannelId, MessageId } from "@hazel/schema"
import { BasicIndex, coalesce, eq } from "@tanstack/db"
import type { Stream } from "effect"
import {
	channelCollection,
	messageCollection,
	messageReactionCollection,
	pinnedMessageCollection,
	userCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { liveQueryChangeSetStream } from "../../data/live-query-changes"
import {
	type ChannelInfo,
	type ChannelQueryRow,
	type MessageQueryRow,
	type ParentChannelInfo,
	type ReactionQueryRow,
	toChatMessage,
	toChatReaction,
} from "./queries"
import type { ChatMessage, ChatReaction } from "./rows"

/**
 * Data bridge for the channel page (S2 option a): the legacy collections and the exact query
 * builders of `routes/_app/$orgSlug/chat/$id.tsx` behind `liveQueryStream`.
 */

export const messagesStream = <Message>(
	channelId: ChannelId,
	limit: number,
	toMessage: (messages: ReadonlyArray<ChatMessage>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<MessageQueryRow, Message>(
		(q) =>
			q
				.from({ message: messageCollection })
				.leftJoin({ pinned: pinnedMessageCollection }, ({ message, pinned }) =>
					eq(message.id, pinned.messageId),
				)
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.where(({ message }) => eq(message.channelId, channelId))
				.select(({ message, pinned, author }) => ({ ...message, pinnedMessage: pinned, author }))
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(limit)
				.offset(0),
		(rows) => toMessage(rows.map(toChatMessage)),
	)

/**
 * The window of `messagesStream` as change sets: `offset` newest messages skipped, `limit` kept.
 * Only inserted and updated rows are converted per change (S2 condition 2).
 */
/** Messages by channel, so a channel's share of the loaded messages is a lookup, not a scan. */
const messagesByChannel = messageCollection.createIndex((row) => row.channelId, {
	indexType: BasicIndex,
	name: "messagesByChannel",
})

/**
 * Whether the window loads the whole channel and orders it in the query. TanStack fills an ordered
 * window by walking the `createdAt` index from the newest message of any channel, so a quiet
 * channel next to a busy one walks all of the busy one's newer rows (24 ms in the heavy fixture).
 * An expression as the order key (not a plain column) skips that walk; a busy channel keeps it.
 */
const loadsWholeChannel = (channelId: ChannelId) =>
	messagesByChannel.equalityLookup(channelId).size * 5 <= messageCollection.size

export const messageChangesStream = <Message>(
	channelId: ChannelId,
	limit: number,
	offset: number,
	toMessage: (changes: { order: ReadonlyArray<MessageId>; upserts: ReadonlyArray<ChatMessage> }) => Message,
): Stream.Stream<Message> =>
	liveQueryChangeSetStream<MessageQueryRow, Message>(
		(q) => {
			const isWholeChannel = loadsWholeChannel(channelId)
			return q
				.from({ message: messageCollection })
				.leftJoin({ pinned: pinnedMessageCollection }, ({ message, pinned }) =>
					eq(message.id, pinned.messageId),
				)
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.where(({ message }) => eq(message.channelId, channelId))
				.select(({ message, pinned, author }) => ({ ...message, pinnedMessage: pinned, author }))
				.orderBy(
					({ message }) => (isWholeChannel ? coalesce(message.createdAt) : message.createdAt),
					"desc",
				)
				.limit(limit)
				.offset(offset)
		},
		(row) => row.id,
		({ order, upserts }) =>
			toMessage({ order: order as ReadonlyArray<MessageId>, upserts: upserts.map(toChatMessage) }),
	)

export const reactionsStream = <Message>(
	channelId: ChannelId,
	toMessage: (reactions: ReadonlyArray<ChatReaction>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ReactionQueryRow, Message>(
		(q) =>
			q
				.from({ reactions: messageReactionCollection })
				.where(({ reactions }) => eq(reactions.channelId, channelId)),
		(rows) => toMessage(rows.map(toChatReaction)),
	)

export const channelStream = <Message>(
	channelId: ChannelId,
	toMessage: (channel: ChannelInfo | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelQueryRow, Message>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(
				row
					? {
							id: row.id,
							name: row.name,
							type: row.type,
							icon: row.icon ?? null,
							organizationId: row.organizationId,
							parentChannelId: row.parentChannelId ?? null,
						}
					: null,
			)
		},
	)

/** `useParentChannel`: the thread's parent for the header breadcrumb. */
export const parentChannelStream = <Message>(
	parentChannelId: ChannelId,
	toMessage: (channel: ParentChannelInfo | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelQueryRow, Message>(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where((t) => eq(t.channel.id, parentChannelId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(row ? { id: row.id, name: row.name, icon: row.icon ?? null } : null)
		},
	)

/** `threadMessagesWithAuthorAtomFamily`: the open thread panel's messages, oldest first. */
export const threadPanelStream = <Message>(
	threadChannelId: ChannelId,
	toMessage: (messages: ReadonlyArray<ChatMessage>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<MessageQueryRow, Message>(
		(q) =>
			q
				.from({ message: messageCollection })
				.leftJoin({ author: userCollection }, ({ message, author }) =>
					eq(message.authorId, author.id),
				)
				.where(({ message }) => eq(message.channelId, threadChannelId))
				.select(({ message, author }) => ({ ...message, author, pinnedMessage: null }))
				.orderBy(({ message }) => message.createdAt, "asc"),
		(rows) => toMessage(rows.map(toChatMessage)),
	)
