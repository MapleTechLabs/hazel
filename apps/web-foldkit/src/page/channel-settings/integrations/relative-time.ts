/**
 * date-fns `formatDistanceToNow(date, { addSuffix: true })` with the en-US locale, which the legacy
 * integration cards render. The app has no date-fns dependency, so the algorithm is ported here.
 */

const MINUTES_IN_DAY = 1440
const MINUTES_IN_ALMOST_TWO_DAYS = 2520
const MINUTES_IN_MONTH = 43200
const MINUTES_IN_TWO_MONTHS = 86400

const plural = (count: number, one: string, many: string) =>
	count === 1 ? one : many.replace("{{count}}", `${count}`)

/** `differenceInMonths`: whole calendar months between the dates, adjusted for the day of month. */
const differenceInMonths = (later: Date, earlier: Date) => {
	const months =
		(later.getFullYear() - earlier.getFullYear()) * 12 + (later.getMonth() - earlier.getMonth())
	const isLastMonthNotFull = later.getDate() < earlier.getDate()
	return Math.max(0, months - (isLastMonthNotFull ? 1 : 0))
}

const offsetMs = (date: Date) => date.getTimezoneOffset() * 60_000

export const formatDistanceToNow = (dateMs: number, nowMs: number): string => {
	const isFuture = dateMs > nowMs
	const later = new Date(Math.max(dateMs, nowMs))
	const earlier = new Date(Math.min(dateMs, nowMs))
	const seconds = Math.trunc((later.getTime() - earlier.getTime()) / 1000)
	const offsetInSeconds = (offsetMs(earlier) - offsetMs(later)) / 1000
	const minutes = Math.round((seconds - offsetInSeconds) / 60)

	const distance = (() => {
		if (minutes < 2)
			return minutes === 0 ? "less than a minute" : plural(minutes, "1 minute", "{{count}} minutes")
		if (minutes < 45) return plural(minutes, "1 minute", "{{count}} minutes")
		if (minutes < 90) return "about 1 hour"
		if (minutes < MINUTES_IN_DAY)
			return plural(Math.round(minutes / 60), "about 1 hour", "about {{count}} hours")
		if (minutes < MINUTES_IN_ALMOST_TWO_DAYS) return "1 day"
		if (minutes < MINUTES_IN_MONTH)
			return plural(Math.round(minutes / MINUTES_IN_DAY), "1 day", "{{count}} days")
		if (minutes < MINUTES_IN_TWO_MONTHS)
			return plural(Math.round(minutes / MINUTES_IN_MONTH), "about 1 month", "about {{count}} months")
		const months = differenceInMonths(later, earlier)
		if (months < 12) return plural(Math.round(minutes / MINUTES_IN_MONTH), "1 month", "{{count}} months")
		const years = Math.trunc(months / 12)
		const monthsSinceStartOfYear = months % 12
		if (monthsSinceStartOfYear < 3) return plural(years, "about 1 year", "about {{count}} years")
		if (monthsSinceStartOfYear < 9) return plural(years, "over 1 year", "over {{count}} years")
		return plural(years + 1, "almost 1 year", "almost {{count}} years")
	})()
	return isFuture ? `in ${distance}` : `${distance} ago`
}
