/**
 * Discord's unread state: a channel is unread while its newest message (`channel_activity`) is
 * someone else's and newer than the user's read position (`channel_read_state`). Never read, they
 * are read up to joining, or to when unread state began in the org (`readStateSince`) if later.
 * A muted channel never shows unread; its mentions still count (`notificationCount`).
 */
import type { UserId } from "@hazel/schema"

export interface UnreadMember {
	readonly isMuted: boolean
	readonly mutedUntil: Date | null
	readonly lastReadAt: Date | null
	readonly joinedAt: Date
	readonly readStateSince: Date | null
}

export interface UnreadActivity {
	readonly lastMessageAt: Date
	readonly lastMessageAuthorId: UserId
}

export const isMutedAt = (member: Pick<UnreadMember, "isMuted" | "mutedUntil">, nowMs: number) =>
	member.isMuted || (member.mutedUntil !== null && member.mutedUntil.getTime() > nowMs)

export type ReadPosition = Pick<UnreadMember, "lastReadAt" | "joinedAt" | "readStateSince">

/** When the member has read the channel up to. */
export const readUpToMs = (member: ReadPosition) =>
	member.lastReadAt !== null
		? member.lastReadAt.getTime()
		: Math.max(member.joinedAt.getTime(), member.readStateSince?.getTime() ?? 0)

/** Someone else wrote after the member's read position, muted or not. */
export const hasUnreadMessages = (
	member: ReadPosition,
	activity: UnreadActivity | undefined,
	userId: UserId,
) =>
	activity !== undefined &&
	activity.lastMessageAuthorId !== userId &&
	activity.lastMessageAt.getTime() > readUpToMs(member)

export const isChannelUnread = (
	member: UnreadMember,
	activity: UnreadActivity | undefined,
	userId: UserId,
	nowMs: number,
) => hasUnreadMessages(member, activity, userId) && !isMutedAt(member, nowMs)
