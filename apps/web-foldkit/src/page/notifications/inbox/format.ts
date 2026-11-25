import type { MarkedRead, NotificationItem, Tab, UnreadChannelItem } from "./model"

/** Framework-free ports of the legacy notification helpers (date-fns 4, en-US) against a given `nowMs`. */

const startOfDay = (ms: number): number => {
	const date = new Date(ms)
	date.setHours(0, 0, 0, 0)
	return date.getTime()
}

/** date-fns `startOfWeek` with the en-US default `weekStartsOn: 0`. */
const startOfWeek = (ms: number): number => {
	const date = new Date(ms)
	date.setDate(date.getDate() - date.getDay())
	date.setHours(0, 0, 0, 0)
	return date.getTime()
}

const yesterdayOf = (nowMs: number): number => {
	const date = new Date(nowMs)
	date.setDate(date.getDate() - 1)
	return date.getTime()
}

export type GroupLabel = "Today" | "Yesterday" | "This week" | "Older"

export interface NotificationGroup {
	readonly label: GroupLabel
	readonly notifications: ReadonlyArray<NotificationItem>
}

/** `groupNotificationsByTime` (`hooks/use-grouped-notifications.ts`). */
export const groupByTime = (
	notifications: ReadonlyArray<NotificationItem>,
	nowMs: number,
): ReadonlyArray<NotificationGroup> => {
	const today = startOfDay(nowMs)
	const yesterday = startOfDay(yesterdayOf(nowMs))
	const week = startOfWeek(nowMs)
	const labelOf = (createdAtMs: number): GroupLabel =>
		startOfDay(createdAtMs) === today
			? "Today"
			: startOfDay(createdAtMs) === yesterday
				? "Yesterday"
				: startOfWeek(createdAtMs) === week
					? "This week"
					: "Older"
	const labels: ReadonlyArray<GroupLabel> = ["Today", "Yesterday", "This week", "Older"]
	return labels
		.map((label) => ({
			label,
			notifications: notifications.filter((item) => labelOf(item.createdAtMs) === label),
		}))
		.filter((group) => group.notifications.length > 0)
}

/** The reasons that name the user (Discord's Mentions); rows from before reasons count too. */
const MENTION_REASONS: ReadonlyArray<string> = ["mention", "reply", "everyone", "direct"]

export const isMention = (item: NotificationItem): boolean =>
	item.reason === null || MENTION_REASONS.includes(item.reason)

/** The notifications a tab lists; Unreads lists channels, not notifications. */
export const notificationsOfTab = (
	notifications: ReadonlyArray<NotificationItem>,
	tab: Exclude<Tab, "unreads">,
): ReadonlyArray<NotificationItem> => (tab === "all" ? notifications : notifications.filter(isMention))

/**
 * The Unreads rows: the unread channels not muted at `nowMs` and not marked read here since their
 * newest message, newest first.
 */
export const visibleUnreadChannels = (
	channels: ReadonlyArray<UnreadChannelItem>,
	markedRead: ReadonlyArray<MarkedRead>,
	nowMs: number,
): ReadonlyArray<UnreadChannelItem> =>
	channels
		.filter((channel) => channel.mutedUntilMs === null || channel.mutedUntilMs <= nowMs)
		.filter(
			(channel) =>
				!markedRead.some(
					(marked) =>
						marked.channelId === channel.channelId && channel.lastMessageAtMs <= marked.upToMs,
				),
		)
		.toSorted((a, b) => b.lastMessageAtMs - a.lastMessageAtMs)

/** An Unreads row's title: a direct message's channel may have no name of its own. */
export const unreadChannelTitle = (channel: UnreadChannelItem): string => {
	if (channel.name === "") return channel.type === "thread" ? "Thread" : "Direct message"
	return channel.type === "public" || channel.type === "private" ? `#${channel.name}` : channel.name
}

export const unreadChannelDetail = (channel: UnreadChannelItem): string => {
	if (channel.mentionCount === 0) return "New messages"
	return channel.mentionCount === 1 ? "1 mention" : `${channel.mentionCount} mentions`
}

/** A support SLA alert (`user.createCustomerNotification`): about an issue, not a message. */
export const isSupportAlert = (item: NotificationItem): boolean => item.resourceType === "customer_issue"

/** Which deadline (`sla_<reply|resolution>_<warning|breach>`) and whether it is still ahead. */
export const supportAlertOf = (item: NotificationItem) => ({
	isWarning: item.reason?.endsWith("_warning") ?? false,
	clock: item.reason?.includes("resolution") === true ? ("resolution" as const) : ("reply" as const),
})

const supportAlertLabel = (item: NotificationItem): string => {
	const { isWarning, clock } = supportAlertOf(item)
	const what = clock === "reply" ? "Reply" : "Resolution"
	return isWarning ? `${what} due soon` : `${what} overdue`
}

/** `getNotificationContext` (`components/notifications/notification-item.tsx`). */
export const contextOf = (item: NotificationItem): string => {
	if (isSupportAlert(item))
		return item.channel === null || item.channel.name === ""
			? supportAlertLabel(item)
			: `${supportAlertLabel(item)} in #${item.channel.name}`
	if (item.channel === null) return "New notification"
	const isMessage = item.resourceType === "message"
	// A direct message's channel has no name of its own.
	if (item.channel.type === "direct" || item.channel.type === "single" || item.channel.name === "")
		return isMessage ? "New direct message" : "Activity in a direct message"
	return isMessage ? `New message in #${item.channel.name}` : `Activity in #${item.channel.name}`
}

/** The ids of the users a message mentions (`@[userId:<id>]`), for the inbox to name them. */
export const mentionedUserIds = (content: string): ReadonlyArray<string> => [
	...new Set(Array.from(content.matchAll(/@\[userId:([^\]]+)\]/g), (match) => match[1] ?? "")),
]

/**
 * Message markup as one line of plain text: mentions as `@Name` (`@unknown` for a user not in
 * `names`, `@group` for a user group, `@channel`/`@here` for a directive), markdown markers, links
 * and line breaks dropped. The web's port of the push body's `plainTextOf` (`push-content.ts`).
 */
export const plainTextOf = (content: string, names: Readonly<Record<string, string>>): string =>
	content
		.replace(/@\[([A-Za-z]+):([^\]]+)\]/g, (_, kind: string, value: string) =>
			kind === "userId"
				? `@${names[value] ?? "unknown"}`
				: kind === "directive"
					? `@${value}`
					: `@${names[value] ?? kind}`,
		)
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/```[a-z0-9-]*/gi, "")
		.replace(/[`*~]|__|\|\|/g, "")
		.replace(/^\s*(>|#{1,6})\s?/gm, "")
		.replace(/\s+/g, " ")
		.trim()

/** `getMessagePreview`: at most `maxLength` code points, so an emoji is never cut in half. */
export const previewOf = (item: NotificationItem, maxLength = 80): string => {
	if (isSupportAlert(item)) {
		const { isWarning, clock } = supportAlertOf(item)
		return `A support issue is ${isWarning ? "close to" : "past"} its ${clock} deadline`
	}
	if (!item.messageContent) return "View notification"
	const plainText = plainTextOf(item.messageContent, item.mentionNames)
	if (plainText === "") return "View notification"
	const points = Array.from(plainText)
	return points.length <= maxLength ? plainText : `${points.slice(0, maxLength).join("").trimEnd()}…`
}
