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

const tzOffsetMs = (ms: number): number => {
	const date = new Date(ms)
	const utc = Date.UTC(
		date.getFullYear(),
		date.getMonth(),
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
		date.getMilliseconds(),
	)
	return utc - ms
}

const plural = (count: number, one: string, many: string) =>
	count === 1 ? one : many.replace("{{count}}", String(count))

const monthsBetween = (laterMs: number, earlierMs: number): number => {
	const later = new Date(laterMs)
	const earlier = new Date(earlierMs)
	const months =
		(later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth())
	return later.getDate() < earlier.getDate() ? months - 1 : months
}

/** date-fns `formatDistanceToNow(date, { addSuffix: true })` with `now = nowMs`. */
export const formatDistanceToNow = (dateMs: number, nowMs: number): string => {
	const [earlier, later] = dateMs > nowMs ? [nowMs, dateMs] : [dateMs, nowMs]
	const seconds = Math.trunc((later - earlier) / 1000)
	const offsetSeconds = (tzOffsetMs(later) - tzOffsetMs(earlier)) / 1000
	const minutes = Math.round((seconds - offsetSeconds) / 60)
	const months = monthsBetween(later, earlier)
	const years = Math.floor(months / 12)
	const remainder = months % 12
	const distance =
		minutes < 1
			? "less than a minute"
			: minutes < 45
				? plural(minutes, "1 minute", "{{count}} minutes")
				: minutes < 90
					? "about 1 hour"
					: minutes < 1440
						? plural(Math.round(minutes / 60), "about 1 hour", "about {{count}} hours")
						: minutes < 2520
							? "1 day"
							: minutes < 43200
								? plural(Math.round(minutes / 1440), "1 day", "{{count}} days")
								: minutes < 86400
									? plural(
											Math.round(minutes / 43200),
											"about 1 month",
											"about {{count}} months",
										)
									: months < 12
										? plural(Math.round(minutes / 43200), "1 month", "{{count}} months")
										: remainder < 3
											? plural(years, "about 1 year", "about {{count}} years")
											: remainder < 9
												? plural(years, "over 1 year", "over {{count}} years")
												: plural(years + 1, "almost 1 year", "almost {{count}} years")
	return dateMs > nowMs ? `in ${distance}` : `${distance} ago`
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
