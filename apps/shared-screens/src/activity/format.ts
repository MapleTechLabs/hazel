/**
 * The inbox's text rules, ported from `web-foldkit/src/page/notifications/inbox/format.ts` and
 * `~/lib/format-distance` (date-fns 4 wording, en-US), so both platforms word a row the same way.
 * Pure functions of a row and the Model's clock (`nowMs`).
 */

export type Tab = "mentions" | "all"

export interface Item {
	readonly id: string
	readonly isUnread: boolean
	readonly createdAtMs: number
	readonly resourceType: string | null
	readonly reason: string | null
	readonly targetedResourceId: string | null
	readonly targetedResourceType: string | null
	readonly messageContent: string | null
	readonly mentionNames: Readonly<Record<string, string>>
	readonly channel: { readonly name: string; readonly type: string } | null
	readonly author: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl: string | null
	} | null
}

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

export const groupLabels = ["Today", "Yesterday", "This week", "Older"] as const
export type GroupLabel = (typeof groupLabels)[number]

export interface Group<A extends Item> {
	readonly label: GroupLabel
	readonly items: ReadonlyArray<A>
}

/** `groupNotificationsByTime`: Today, Yesterday, This week, Older; empty groups dropped. */
export const groupByTime = <A extends Item>(
	items: ReadonlyArray<A>,
	nowMs: number,
): ReadonlyArray<Group<A>> => {
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
	return groupLabels
		.map((label) => ({ label, items: items.filter((item) => labelOf(item.createdAtMs) === label) }))
		.filter((group) => group.items.length > 0)
}

/** The reasons that name the user (Mentions); rows from before reasons count too. */
const MENTION_REASONS: ReadonlyArray<string> = ["mention", "reply", "everyone", "direct"]

export const isMention = (item: Item): boolean =>
	item.reason === null || MENTION_REASONS.includes(item.reason)

export const itemsOfTab = <A extends Item>(items: ReadonlyArray<A>, tab: Tab): ReadonlyArray<A> =>
	tab === "all" ? items : items.filter(isMention)

/** A support SLA alert (`user.createCustomerNotification`): about an issue, not a message. */
export const isSupportAlert = (item: Item): boolean => item.resourceType === "customer_issue"

export const supportAlertOf = (item: Item) => ({
	isWarning: item.reason?.endsWith("_warning") ?? false,
	clock: item.reason?.includes("resolution") === true ? ("resolution" as const) : ("reply" as const),
})

const supportAlertLabel = (item: Item): string => {
	const { isWarning, clock } = supportAlertOf(item)
	const what = clock === "reply" ? "Reply" : "Resolution"
	return isWarning ? `${what} due soon` : `${what} overdue`
}

export const isDirect = (type: string | undefined) => type === "direct" || type === "single"

/** `getNotificationContext`: where the notification comes from. */
export const contextOf = (item: Item): string => {
	if (isSupportAlert(item))
		return item.channel === null || item.channel.name === ""
			? supportAlertLabel(item)
			: `${supportAlertLabel(item)} in #${item.channel.name}`
	if (item.channel === null) return "New notification"
	const isMessage = item.resourceType === "message"
	if (isDirect(item.channel.type) || item.channel.name === "")
		return isMessage ? "New direct message" : "Activity in a direct message"
	return isMessage ? `New message in #${item.channel.name}` : `Activity in #${item.channel.name}`
}

/** The ids of the users a message mentions (`@[userId:<id>]`). */
export const mentionedUserIds = (content: string): ReadonlyArray<string> => [
	...new Set(Array.from(content.matchAll(/@\[userId:([^\]]+)\]/g), (match) => match[1] ?? "")),
]

/** Message markup as one line of plain text (`plainTextOf`, the push body's rules). */
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
export const previewOf = (item: Item, maxLength = 80): string => {
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

// Relative time: date-fns 4's `formatDistanceToNow` wording and thresholds.

const MINUTES_IN_DAY = 1440
const MINUTES_IN_ALMOST_TWO_DAYS = 2520
const MINUTES_IN_MONTH = 43200
const MINUTES_IN_TWO_MONTHS = 86400

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? "" : "s"}`

const dstOffsetMinutes = (earlierMs: number, laterMs: number): number =>
	new Date(laterMs).getTimezoneOffset() - new Date(earlierMs).getTimezoneOffset()

const isLastDayOfMonth = (date: Date): boolean =>
	date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

const differenceInMonths = (earlierMs: number, laterMs: number): number => {
	const earlier = new Date(earlierMs)
	const later = new Date(laterMs)
	const months =
		(later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth())
	if (months < 1) return 0
	const shifted = new Date(laterMs)
	if (shifted.getMonth() === 1 && shifted.getDate() > 27) shifted.setDate(30)
	shifted.setMonth(shifted.getMonth() - months)
	const lastMonthComplete =
		shifted.getTime() >= earlierMs || (isLastDayOfMonth(later) && months === 1 && laterMs > earlierMs)
	return lastMonthComplete ? months : months - 1
}

const looseWords = (earlierMs: number, laterMs: number): string => {
	const seconds = Math.trunc((laterMs - earlierMs) / 1000)
	const minutes = Math.round(seconds / 60 - dstOffsetMinutes(earlierMs, laterMs))
	if (minutes < 2) return minutes === 0 ? "less than a minute" : plural(minutes, "minute")
	if (minutes < 45) return plural(minutes, "minute")
	if (minutes < 90) return "about 1 hour"
	if (minutes < MINUTES_IN_DAY) return `about ${plural(Math.round(minutes / 60), "hour")}`
	if (minutes < MINUTES_IN_ALMOST_TWO_DAYS) return "1 day"
	if (minutes < MINUTES_IN_MONTH) return plural(Math.round(minutes / MINUTES_IN_DAY), "day")
	if (minutes < MINUTES_IN_TWO_MONTHS)
		return `about ${plural(Math.round(minutes / MINUTES_IN_MONTH), "month")}`
	const months = differenceInMonths(earlierMs, laterMs)
	if (months < 12) return plural(Math.round(minutes / MINUTES_IN_MONTH), "month")
	const years = Math.trunc(months / 12)
	const monthsIntoYear = months % 12
	if (monthsIntoYear < 3) return `about ${plural(years, "year")}`
	if (monthsIntoYear < 9) return `over ${plural(years, "year")}`
	return `almost ${plural(years + 1, "year")}`
}

/** "3 days ago" or "in about 2 hours", against the Model's clock. */
export const formatDistanceToNow = (ms: number, nowMs: number): string => {
	const inFuture = ms > nowMs
	const words = inFuture ? looseWords(nowMs, ms) : looseWords(ms, nowMs)
	return inFuture ? `in ${words}` : `${words} ago`
}

export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase()
