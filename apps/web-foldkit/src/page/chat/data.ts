import { ChannelId, type MessageId, type UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import {
	channelCollection,
	messageCollection,
	messageReactionCollection,
	pinnedMessageCollection,
	userCollection,
} from "~/db/collections"
import { extractUrls } from "~/components/link-preview.utils"
import { liveQueryStream } from "../../data/live-query"
import type { ChatMessage, ChatReaction } from "./rows"

/**
 * Data bridge for the channel page (S2 option a): the legacy TanStack DB collections and the
 * exact query builders of `routes/_app/$orgSlug/chat/$id.tsx`, emitted as Schema-typed rows.
 */

export const PAGE_SIZE = 30

export const ChannelInfo = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type ChannelInfo = typeof ChannelInfo.Type

/** Rows come out of collections decoded with the domain schemas, so ids are already branded. */
interface MessageQueryRow {
	readonly id: MessageId
	readonly channelId: ChannelId
	readonly authorId: UserId
	readonly content: string
	readonly embeds: ReadonlyArray<unknown> | null
	readonly replyToMessageId: MessageId | null
	readonly threadChannelId: ChannelId | null
	readonly createdAt: Date
	readonly updatedAt: Date | null
	readonly pinnedMessage?: { readonly id: string } | null
	readonly author?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
		readonly userType: string
	} | null
}

export const toChatMessage = (row: MessageQueryRow): ChatMessage => ({
	id: row.id,
	channelId: row.channelId,
	authorId: row.authorId,
	content: row.content,
	// `Message.Provider`'s `hasEmbed`: rich embeds, or any URL in the text.
	hasEmbeds: (row.embeds?.length ?? 0) > 0 || extractUrls(row.content).length > 0,
	replyToMessageId: row.replyToMessageId ?? null,
	threadChannelId: row.threadChannelId ?? null,
	createdAtMs: new Date(row.createdAt).getTime(),
	updatedAtMs: row.updatedAt === null ? null : new Date(row.updatedAt).getTime(),
	isPinned: !!row.pinnedMessage?.id,
	author: row.author
		? {
				firstName: row.author.firstName,
				lastName: row.author.lastName,
				avatarUrl: row.author.avatarUrl ?? null,
				userType: row.author.userType,
			}
		: null,
})

/** Newest first, `limit` rows: the legacy infinite query with its window widened page by page. */
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
				.leftJoin({ author: userCollection }, ({ message, author }) => eq(message.authorId, author.id))
				.where(({ message }) => eq(message.channelId, channelId))
				.select(({ message, pinned, author }) => ({ ...message, pinnedMessage: pinned, author }))
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(limit)
				.offset(0),
		(rows) => toMessage(rows.map(toChatMessage)),
	)

interface ReactionQueryRow {
	readonly id: string
	readonly messageId: MessageId
	readonly userId: UserId
	readonly emoji: string
}

export const reactionsStream = <Message>(
	channelId: ChannelId,
	toMessage: (reactions: ReadonlyArray<ChatReaction>) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ReactionQueryRow, Message>(
		(q) =>
			q
				.from({ reactions: messageReactionCollection })
				.where(({ reactions }) => eq(reactions.channelId, channelId)),
		(rows) =>
			toMessage(
				rows.map((row) => ({ id: row.id, messageId: row.messageId, userId: row.userId, emoji: row.emoji })),
			),
	)

interface ChannelQueryRow {
	readonly id: ChannelId
	readonly name: string
	readonly type: string
	readonly icon: string | null
}

export const channelStream = <Message>(
	channelId: ChannelId,
	toMessage: (channel: ChannelInfo | null) => Message,
): Stream.Stream<Message> =>
	liveQueryStream<ChannelQueryRow, Message>(
		(q) => q.from({ channel: channelCollection }).where(({ channel }) => eq(channel.id, channelId)).findOne(),
		(rows) => {
			const row = rows[0]
			return toMessage(
				row ? { id: row.id, name: row.name, type: row.type, icon: row.icon ?? null } : null,
			)
		},
	)
