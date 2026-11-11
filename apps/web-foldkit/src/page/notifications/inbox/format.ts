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

/** `getNotificationContext` (`components/notifications/notification-item.tsx`). */
export const contextOf = (item: NotificationItem): string =>
	item.resourceType === "message" && item.channel !== null
		? `New message in #${item.channel.name}`
		: item.channel !== null
			? `Activity in #${item.channel.name}`
			: "New notification"

/** `getMessagePreview`. */
export const previewOf = (item: NotificationItem, maxLength = 80): string => {
	if (!item.messageContent) return "View notification"
	const plainText = item.messageContent.replace(/[*_`~#]/g, "").trim()
	return plainText.length <= maxLength ? plainText : `${plainText.slice(0, maxLength)}...`
}
