import type { Category, NotificationItem } from "./model"

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

export type GroupLabel = "Today" | "Yesterday" | "This Week" | "Older"

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
					? "This Week"
					: "Older"
	const labels: ReadonlyArray<GroupLabel> = ["Today", "Yesterday", "This Week", "Older"]
	return labels
		.map((label) => ({
			label,
			notifications: notifications.filter((item) => labelOf(item.createdAtMs) === label),
		}))
		.filter((group) => group.notifications.length > 0)
}

/** `filterNotificationsByCategory`. */
export const filterByCategory = (
	notifications: ReadonlyArray<NotificationItem>,
	category: Category,
): ReadonlyArray<NotificationItem> => {
	const types: Record<Exclude<Category, "all">, ReadonlyArray<string>> = {
		general: ["public", "private"],
		threads: ["thread"],
		dms: ["direct", "single"],
	}
	return category === "all"
		? notifications
		: notifications.filter((item) => item.channel !== null && types[category].includes(item.channel.type))
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

/** `getMessagePreview`. */
export const previewOf = (item: NotificationItem, maxLength = 80): string => {
	if (isSupportAlert(item)) {
		const { isWarning, clock } = supportAlertOf(item)
		return `A support issue is ${isWarning ? "close to" : "past"} its ${clock} deadline`
	}
	if (!item.messageContent) return "View notification"
	const plainText = item.messageContent.replace(/[*_`~#]/g, "").trim()
	return plainText.length <= maxLength ? plainText : `${plainText.slice(0, maxLength)}...`
}
