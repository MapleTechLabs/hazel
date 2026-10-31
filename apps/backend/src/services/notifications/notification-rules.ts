/**
 * Who a message notifies, and how: Discord's model, as pure functions over what the channel's
 * `OrgObject` knows of each member (`./notification-service.ts` loads it).
 *
 * For each member but the author, the first rule that applies wins:
 *
 * 1. The reason: `direct` in a DM or group DM, else `mention`, `reply`, `everyone` (`@channel`,
 *    `@here`) or plain `message`.
 * 2. The member's level for the channel (`channel_members.notificationLevel`), or the channel
 *    type's default: `all` in DMs, group DMs and threads, `mentions` elsewhere. `nothing` skips.
 * 3. Muted (`isMuted`, or `mutedUntil` still ahead), or a thread whose parent channel is muted or
 *    on `nothing`: only a personal mention or reply gets through.
 * 4. Level `mentions`: a plain message skips. (A DM message is always `direct`, so in a DM only
 *    `nothing` and a mute change anything.)
 * 5. Online and active in this channel: skip, they are reading it.
 * 6. Do not disturb, paused notifications or quiet hours: notify silently (a badge and an inbox
 *    row, no sound or system notification). Quiet hours need the user's timezone; without one
 *    they are left to the client, which knows its local time.
 */
import type { ChannelMember } from "@hazel/domain/models"
import type { ChannelId, UserId } from "@hazel/schema"

export type NotificationLevel = ChannelMember.NotificationLevel

export type ChannelType = "public" | "private" | "thread" | "direct" | "single"

export const NotificationReasons = ["direct", "mention", "reply", "everyone", "message"] as const
export type NotificationReason = (typeof NotificationReasons)[number]

export type SkipReason = "author" | "level" | "muted" | "viewing"

/** A new message, as the rules see it. */
export interface MessageActivity {
	readonly channelId: ChannelId
	readonly channelType: ChannelType
	/** A thread's channel. */
	readonly parentChannelId: ChannelId | null
	readonly authorId: UserId
	readonly mentionedUserIds: ReadonlyArray<UserId>
	/** `@channel` or `@here`. */
	readonly notifyAll: boolean
	readonly replyToAuthorId: UserId | null
}

export interface RecipientPresence {
	readonly status: "online" | "away" | "busy" | "dnd" | "offline"
	readonly activeChannelId: ChannelId | null
	/** "Pause notifications" on the user's status. */
	readonly suppressNotifications: boolean
}

export interface RecipientSettings {
	readonly doNotDisturb?: boolean | undefined
	/** `HH:mm`, in the user's timezone. */
	readonly quietHoursStart?: string | undefined
	readonly quietHoursEnd?: string | undefined
}

/** A member's notification settings in one channel. */
export interface ChannelSettings {
	readonly level: NotificationLevel | null
	readonly isMuted: boolean
	readonly mutedUntil: Date | null
}

/** A channel member, with what decides their notification. */
export interface Recipient {
	readonly userId: UserId
	readonly level: NotificationLevel | null
	readonly isMuted: boolean
	readonly mutedUntil: Date | null
	/** In a thread, the member's settings in its parent channel, if they are in it. */
	readonly parent: ChannelSettings | null
	readonly presence: RecipientPresence | null
	readonly settings: RecipientSettings | null
	/** IANA timezone for quiet hours; none, or an invalid one, leaves them to the client. */
	readonly timezone: string | null
}

export type NotificationDecision =
	| { readonly _tag: "Skip"; readonly why: SkipReason }
	| { readonly _tag: "Notify"; readonly reason: NotificationReason; readonly silent: boolean }

export const defaultLevel = (channelType: ChannelType): NotificationLevel =>
	channelType === "direct" || channelType === "single" || channelType === "thread" ? "all" : "mentions"

export const reasonFor = (activity: MessageActivity, userId: UserId): NotificationReason => {
	if (activity.channelType === "direct" || activity.channelType === "single") return "direct"
	if (activity.mentionedUserIds.includes(userId)) return "mention"
	if (activity.replyToAuthorId === userId) return "reply"
	if (activity.notifyAll) return "everyone"
	return "message"
}

const minutesOf = (time: string): number | null => {
	const match = /^(\d{1,2}):(\d{2})/.exec(time)
	return match === null ? null : Number(match[1]) * 60 + Number(match[2])
}

/** Minutes since local midnight in `timezone`, or null for an invalid timezone. */
export const minutesInZone = (nowMs: number, timezone: string): number | null => {
	const format = (timeZone: string) =>
		new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
			.formatToParts(new Date(nowMs))
			.reduce(
				(minutes, part) =>
					part.type === "hour"
						? minutes + Number(part.value) * 60
						: part.type === "minute"
							? minutes + Number(part.value)
							: minutes,
				0,
			)
	try {
		return format(timezone)
	} catch {
		return null
	}
}

/**
 * Whether `nowMs` is inside the quiet hours in `timezone`; a window may span midnight. Unset hours,
 * or no valid timezone, never are.
 */
export const isInQuietHours = (
	settings: RecipientSettings | null,
	timezone: string | null,
	nowMs: number,
) => {
	if (timezone === null || !settings?.quietHoursStart || !settings.quietHoursEnd) return false
	const start = minutesOf(settings.quietHoursStart)
	const end = minutesOf(settings.quietHoursEnd)
	if (start === null || end === null || start === end) return false
	const current = minutesInZone(nowMs, timezone)
	if (current === null) return false
	return start < end ? current >= start && current < end : current >= start || current < end
}

export const decide = (
	activity: MessageActivity,
	recipient: Recipient,
	nowMs: number,
): NotificationDecision => {
	if (recipient.userId === activity.authorId) return { _tag: "Skip", why: "author" }

	const reason = reasonFor(activity, recipient.userId)
	const level = recipient.level ?? defaultLevel(activity.channelType)
	if (level === "nothing") return { _tag: "Skip", why: "level" }

	const personal = reason === "mention" || reason === "reply"
	const isMuted = (settings: ChannelSettings) =>
		settings.isMuted || (settings.mutedUntil !== null && settings.mutedUntil.getTime() > nowMs)
	const parent = activity.channelType === "thread" ? recipient.parent : null
	const muted = isMuted(recipient) || (parent !== null && (isMuted(parent) || parent.level === "nothing"))
	if (muted && !personal) return { _tag: "Skip", why: "muted" }

	if (level === "mentions" && reason === "message") return { _tag: "Skip", why: "level" }

	const presence = recipient.presence
	if (presence?.status === "online" && presence.activeChannelId === activity.channelId) {
		return { _tag: "Skip", why: "viewing" }
	}

	const silent =
		presence?.status === "dnd" ||
		presence?.suppressNotifications === true ||
		recipient.settings?.doNotDisturb === true ||
		isInQuietHours(recipient.settings, recipient.timezone, nowMs)
	return { _tag: "Notify", reason, silent }
}
