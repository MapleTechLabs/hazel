import type { ChannelId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import type { Stream } from "effect"
import {
	channelCollection,
	messageCollection,
	messageReactionCollection,
	pinnedMessageCollection,
	userCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
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
