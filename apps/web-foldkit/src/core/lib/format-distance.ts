/**
 * Relative times in en-US words ("about 3 hours ago", "in 2 days"), the wording and thresholds of
 * date-fns 4's `formatDistance` and `formatDistanceStrict`, which these replace.
 */

const MINUTES_IN_DAY = 1440
const MINUTES_IN_ALMOST_TWO_DAYS = 2520
const MINUTES_IN_MONTH = 43200
const MINUTES_IN_TWO_MONTHS = 86400
const MINUTES_IN_YEAR = 525600

const toMs = (date: Date | number): number => (typeof date === "number" ? date : date.getTime())

const plural = (count: number, unit: string): string => `${count} ${unit}${count === 1 ? "" : "s"}`

const withSuffix = (words: string, inFuture: boolean): string => (inFuture ? `in ${words}` : `${words} ago`)

/** The minutes a daylight-saving change between the two adds to their wall-clock distance. */
const dstOffsetMinutes = (earlierMs: number, laterMs: number): number =>
	new Date(laterMs).getTimezoneOffset() - new Date(earlierMs).getTimezoneOffset()

const isLastDayOfMonth = (date: Date): boolean =>
	date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

/**
 * Whole calendar months from `earlierMs` to `laterMs` (not before it), date-fns 4's
 * `differenceInMonths`: it shifts the later date back, so a late-February date (Feb 28 2025) still
 * completes a month that started on a later day (Feb 29 2024).
 */
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

const strictWords = (earlierMs: number, laterMs: number): string => {
	const ms = laterMs - earlierMs
	const minutes = ms / 60_000
	const normalizedMinutes = minutes - dstOffsetMinutes(earlierMs, laterMs)
	if (minutes < 1) return plural(Math.round(ms / 1000), "second")
	if (minutes < 60) return plural(Math.round(minutes), "minute")
	if (minutes < MINUTES_IN_DAY) return plural(Math.round(minutes / 60), "hour")
	if (normalizedMinutes < MINUTES_IN_MONTH)
		return plural(Math.round(normalizedMinutes / MINUTES_IN_DAY), "day")
	if (normalizedMinutes < MINUTES_IN_YEAR) {
		const months = Math.round(normalizedMinutes / MINUTES_IN_MONTH)
		return months === 12 ? "1 year" : plural(months, "month")
	}
	return plural(Math.round(normalizedMinutes / MINUTES_IN_YEAR), "year")
}

const relative = (
	words: (earlierMs: number, laterMs: number) => string,
	date: Date | number,
	nowMs: number,
): string => {
	const ms = toMs(date)
	const inFuture = ms > nowMs
	return withSuffix(inFuture ? words(nowMs, ms) : words(ms, nowMs), inFuture)
}

/**
 * "3 days ago" or "in about 2 hours", measured against the Model's clock (`nowMs`) so the text only
 * changes when a view is redrawn with a new time.
 */
export const formatDistanceToNow = (date: Date | number, nowMs: number): string =>
	relative(looseWords, date, nowMs)

/** "3 hours ago" or "in 2 days": exact units, no "about"/"less than". */
export const formatDistanceStrict = (date: Date | number, nowMs: number): string =>
	relative(strictWords, date, nowMs)
