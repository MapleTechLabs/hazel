import { ChannelId, type MessageId, type UserId } from "@hazel/schema"
import { Schema } from "effect"
import { extractUrls } from "~/components/link-preview.utils"
import type { ChatMessage, ChatReaction } from "./rows"

/** Row shapes of the channel page's live queries and their mapping to Model types (no collection imports). */

export const PAGE_SIZE = 30

export const ChannelInfo = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type ChannelInfo = typeof ChannelInfo.Type

/** Rows come out of collections decoded with the domain schemas, so ids are already branded. */
export interface MessageQueryRow {
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

export interface ReactionQueryRow {
	readonly id: string
	readonly messageId: MessageId
	readonly userId: UserId
	readonly emoji: string
}

export interface ChannelQueryRow {
	readonly id: ChannelId
	readonly name: string
	readonly type: string
	readonly icon: string | null
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

export const toChatReaction = (row: ReactionQueryRow): ChatReaction => ({
	id: row.id,
	messageId: row.messageId,
	userId: row.userId,
	emoji: row.emoji,
})
