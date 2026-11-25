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

/**
 * A joined unread row: the member, the channel's newest message and the user's own section and
 * organization settings (absent when they have none).
 */
export interface UnreadChannelMutes {
	readonly type: string
	readonly isMuted: boolean
	readonly mutedUntil: Date | null
	readonly joinedAt: Date
	readonly lastReadAt: Date | null | undefined
	readonly readStateSince: Date | null
	readonly lastMessageAt: Date
	readonly lastMessageAuthorId: UserId
	readonly sectionMuted?: boolean | undefined
	readonly sectionMutedUntil?: Date | null | undefined
	readonly orgMuted?: boolean | undefined
	readonly orgMutedUntil?: Date | null | undefined
}

export const isDirectMessageType = (type: string) => type === "direct" || type === "single"

/**
 * Whether a joined row is unread, and when its mute ends: the channel's own, its section's or the
 * organization's (DMs take only their own), as the server's rules count them. `undefined` when it
 * is read or muted for good; otherwise the latest timed mute's end (null when none), which the
 * caller, holding the clock, compares with now.
 */
export const unreadMuteEnd = (
	row: UnreadChannelMutes,
	userId: UserId,
): { readonly mutedUntilMs: number | null } | undefined => {
	const mutes = isDirectMessageType(row.type)
		? [{ isMuted: row.isMuted, until: row.mutedUntil }]
		: [
				{ isMuted: row.isMuted, until: row.mutedUntil },
				{ isMuted: row.sectionMuted === true, until: row.sectionMutedUntil ?? null },
				{ isMuted: row.orgMuted === true, until: row.orgMutedUntil ?? null },
			]
	if (mutes.some((mute) => mute.isMuted)) return undefined
	const isUnread = hasUnreadMessages(
		{
			lastReadAt: row.lastReadAt ? new Date(row.lastReadAt) : null,
			joinedAt: new Date(row.joinedAt),
			readStateSince: row.readStateSince ? new Date(row.readStateSince) : null,
		},
		{ lastMessageAt: new Date(row.lastMessageAt), lastMessageAuthorId: row.lastMessageAuthorId },
		userId,
	)
	if (!isUnread) return undefined
	const untils = mutes.flatMap((mute) => (mute.until ? [new Date(mute.until).getTime()] : []))
	return { mutedUntilMs: untils.length === 0 ? null : Math.max(...untils) }
}
