/**
 * date-fns `formatDistanceToNow(date, { addSuffix: true })` with the en-US locale, ported because
 * the Foldkit app doesn't depend on date-fns. Same thresholds and rounding as date-fns 4.
 */

const MINUTES_IN_DAY = 1440
const MINUTES_IN_MONTH = 43200
const MINUTES_IN_TWO_MONTHS = 86400

const plural = (count: number, one: string, many: string) =>
	count === 1 ? one : many.replace("{{count}}", String(count))

/** date-fns `differenceInMonths`: whole calendar months, not counting a partial last month. */
const differenceInMonths = (later: Date, earlier: Date): number => {
	const months =
		(later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth())
	const shifted = new Date(earlier.getTime())
	shifted.setMonth(earlier.getMonth() + months)
	return later.getTime() < shifted.getTime() ? months - 1 : months
}

const distance = (later: Date, earlier: Date): string => {
	const seconds = Math.trunc((later.getTime() - earlier.getTime()) / 1000)
	const offsetSeconds = (later.getTimezoneOffset() - earlier.getTimezoneOffset()) * 60
	const minutes = Math.round((seconds - offsetSeconds) / 60)
	if (minutes < 2) return minutes === 0 ? "less than a minute" : plural(minutes, "1 minute", "{{count}} minutes")
	if (minutes < 45) return plural(minutes, "1 minute", "{{count}} minutes")
	if (minutes < 90) return "about 1 hour"
	if (minutes < MINUTES_IN_DAY) return plural(Math.round(minutes / 60), "about 1 hour", "about {{count}} hours")
	if (minutes < 2520) return "1 day"
	if (minutes < MINUTES_IN_MONTH) return plural(Math.round(minutes / MINUTES_IN_DAY), "1 day", "{{count}} days")
	if (minutes < MINUTES_IN_TWO_MONTHS) {
		return plural(Math.round(minutes / MINUTES_IN_MONTH), "about 1 month", "about {{count}} months")
	}
	const months = differenceInMonths(later, earlier)
	if (months < 12) return plural(Math.round(minutes / MINUTES_IN_MONTH), "1 month", "{{count}} months")
	const years = Math.trunc(months / 12)
	const remainder = months % 12
	if (remainder < 3) return plural(years, "about 1 year", "about {{count}} years")
	if (remainder < 9) return plural(years, "over 1 year", "over {{count}} years")
	return plural(years + 1, "almost 1 year", "almost {{count}} years")
}

export const formatDistanceToNow = (date: Date, nowMs: number = Date.now()): string => {
	const now = new Date(nowMs)
	return date.getTime() > now.getTime() ? `in ${distance(date, now)}` : `${distance(now, date)} ago`
}
