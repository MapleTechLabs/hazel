import { AttachmentId, ChannelId, ChannelMemberId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"

/**
 * What the channel page looks up besides its message window: people, presence, custom emoji,
 * attachments, threads and reply targets. Each is a live query result kept in the page Model.
 */

export const UserInfo = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.String,
	timezone: Schema.NullOr(Schema.String),
})
export type UserInfo = typeof UserInfo.Type

export const PresenceInfo = Schema.Struct({
	userId: UserId,
	status: Schema.String,
	statusEmoji: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
	statusExpiresAtMs: Schema.NullOr(Schema.Number),
	lastSeenAtMs: Schema.NullOr(Schema.Number),
})
export type PresenceInfo = typeof PresenceInfo.Type

export const ChannelMemberInfo = Schema.Struct({
	id: ChannelMemberId,
	userId: UserId,
	isHidden: Schema.Boolean,
	createdAtMs: Schema.Number,
})
export type ChannelMemberInfo = typeof ChannelMemberInfo.Type

export const AttachmentInfo = Schema.Struct({
	id: AttachmentId,
	messageId: Schema.NullOr(MessageId),
	fileName: Schema.String,
	fileSize: Schema.Number,
	url: Schema.String,
	uploadedAtMs: Schema.Number,
})
export type AttachmentInfo = typeof AttachmentInfo.Type

/** A message of one of the window's threads (thread previews need count, authors, last reply). */
export const ThreadMessageInfo = Schema.Struct({
	id: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	createdAtMs: Schema.Number,
})
export type ThreadMessageInfo = typeof ThreadMessageInfo.Type

export const ThreadChannelInfo = Schema.Struct({ id: ChannelId, name: Schema.String })
export type ThreadChannelInfo = typeof ThreadChannelInfo.Type

export const ReplyTarget = Schema.Struct({ id: MessageId, authorId: UserId, content: Schema.String })
export type ReplyTarget = typeof ReplyTarget.Type

export const TypingInfo = Schema.Struct({ memberId: ChannelMemberId, lastTyped: Schema.Number })
export type TypingInfo = typeof TypingInfo.Type

export const CustomEmojiInfo = Schema.Struct({ name: Schema.String, imageUrl: Schema.String })
export type CustomEmojiInfo = typeof CustomEmojiInfo.Type

export const BotInfo = Schema.Struct({ userId: UserId, name: Schema.String })
export type BotInfo = typeof BotInfo.Type

/** Everything the rows are derived from, besides messages and reactions. */
export const Lookups = Schema.Struct({
	users: Schema.Array(UserInfo),
	presence: Schema.Array(PresenceInfo),
	bots: Schema.Array(BotInfo),
	customEmojis: Schema.Array(CustomEmojiInfo),
	attachments: Schema.Array(AttachmentInfo),
	discordSyncedIds: Schema.Array(MessageId),
	threadChannels: Schema.Array(ThreadChannelInfo),
	threadMessages: Schema.Array(ThreadMessageInfo),
	replyTargets: Schema.Array(ReplyTarget),
})
export type Lookups = typeof Lookups.Type

export const emptyLookups: Lookups = {
	users: [],
	presence: [],
	bots: [],
	customEmojis: [],
	attachments: [],
	discordSyncedIds: [],
	threadChannels: [],
	threadMessages: [],
	replyTargets: [],
}

const toMs = (value: Date | string | number | null | undefined) =>
	value === null || value === undefined ? null : new Date(value).getTime()

export interface UserRow {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly email: string
	readonly avatarUrl?: string | null
	readonly userType: string
	readonly timezone?: string | null
}

export const toUserInfo = (row: UserRow): UserInfo => ({
	id: row.id,
	firstName: row.firstName,
	lastName: row.lastName,
	email: row.email,
	avatarUrl: row.avatarUrl ?? null,
	userType: row.userType,
	timezone: row.timezone ?? null,
})

export interface PresenceRow {
	readonly userId: UserId
	readonly status: string
	readonly statusEmoji?: string | null
	readonly customMessage?: string | null
	readonly statusExpiresAt?: Date | null
	readonly lastSeenAt?: Date | null
}

export const toPresenceInfo = (row: PresenceRow): PresenceInfo => ({
	userId: row.userId,
	status: row.status,
	statusEmoji: row.statusEmoji ?? null,
	customMessage: row.customMessage ?? null,
	statusExpiresAtMs: toMs(row.statusExpiresAt),
	lastSeenAtMs: toMs(row.lastSeenAt),
})

export interface AttachmentRow {
	readonly id: AttachmentId
	readonly messageId: MessageId | null
	readonly fileName: string
	readonly fileSize: number
	readonly externalUrl: string | null
	readonly uploadedAt: Date
}

export interface ChannelMemberRow {
	readonly id: ChannelMemberId
	readonly userId: UserId
	readonly isHidden: boolean
	readonly createdAt: Date
}

export const toChannelMemberInfo = (row: ChannelMemberRow): ChannelMemberInfo => ({
	id: row.id,
	userId: row.userId,
	isHidden: row.isHidden,
	createdAtMs: new Date(row.createdAt).getTime(),
})

/** Index helpers for derivation (built once per data change, not per row). */
export const byKey = <A, K extends string>(items: ReadonlyArray<A>, key: (item: A) => K) => {
	const map = new Map<K, A>()
	for (const item of items) map.set(key(item), item)
	return map
}
