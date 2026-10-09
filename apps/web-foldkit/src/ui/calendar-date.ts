/**
 * Plain calendar dates (`YYYY-MM-DD`, Gregorian) for the Calendar port, standing in for
 * `@internationalized/date`. Formatting goes through Intl in UTC with en-US, as the legacy
 * `useDateFormatter` calls do.
 */

export type CalendarDate = string

const pad = (value: number, length = 2) => String(value).padStart(length, "0")

export const toDate = (date: CalendarDate): Date => new Date(`${date}T00:00:00.000Z`)

export const fromDate = (date: Date): CalendarDate =>
	`${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

/** `today(getLocalTimeZone())`. */
// The default mirrors React Aria's today(); only the gallery entries rely on it, when seeding their init.
// oxlint-disable-next-line foldkit/no-impure-call-at-decision-time
export const today = (now: Date = new Date()): CalendarDate =>
	`${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

export const parts = (date: CalendarDate) => {
	const value = toDate(date)
	return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

export const compare = (a: CalendarDate, b: CalendarDate) => (a < b ? -1 : a > b ? 1 : 0)

export const addDays = (date: CalendarDate, days: number): CalendarDate => {
	const value = toDate(date)
	value.setUTCDate(value.getUTCDate() + days)
	return fromDate(value)
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** `CalendarDate.set`/`add` for months and years: the day is clamped to the target month. */
export const withMonth = (date: CalendarDate, year: number, month: number): CalendarDate => {
	const normalized = new Date(Date.UTC(year, month - 1, 1))
	const targetYear = normalized.getUTCFullYear()
	const targetMonth = normalized.getUTCMonth() + 1
	const day = Math.min(parts(date).day, daysInMonth(targetYear, targetMonth))
	return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(day)}`
}

export const addMonths = (date: CalendarDate, months: number): CalendarDate => {
	const { year, month } = parts(date)
	return withMonth(date, year, month + months)
}

export const addYears = (date: CalendarDate, years: number): CalendarDate => {
	const { year, month } = parts(date)
	return withMonth(date, year + years, month)
}

export const startOfMonth = (date: CalendarDate): CalendarDate => {
	const { year, month } = parts(date)
	return `${pad(year, 4)}-${pad(month)}-01`
}

export const isSameMonth = (a: CalendarDate, b: CalendarDate) => a.slice(0, 7) === b.slice(0, 7)

/** Weeks of the month view, Sunday first (en-US): every date, including the adjacent months'. */
export const monthWeeks = (date: CalendarDate): ReadonlyArray<ReadonlyArray<CalendarDate>> => {
	const first = startOfMonth(date)
	const { year, month } = parts(date)
	const start = addDays(first, -toDate(first).getUTCDay())
	const leading = toDate(first).getUTCDay()
	const weekCount = Math.ceil((leading + daysInMonth(year, month)) / 7)
	return Array.from({ length: weekCount }, (_, week) =>
		Array.from({ length: 7 }, (_, weekday) => addDays(start, week * 7 + weekday)),
	)
}

const formatter = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })

const fullDate = formatter({ weekday: "long", month: "long", day: "numeric", year: "numeric" })

/** The cell's accessible date, "Thursday, March 12, 2026". */
export const formatFull = (date: CalendarDate) => fullDate.format(toDate(date))
export const formatMonthYear = (date: CalendarDate) =>
	formatter({ month: "long", year: "numeric" }).format(toDate(date))
export const formatShortMonth = (date: CalendarDate) => formatter({ month: "short" }).format(toDate(date))
export const formatYear = (date: CalendarDate) => formatter({ year: "numeric" }).format(toDate(date))
export const formatDay = (date: CalendarDate) => formatter({ day: "numeric" }).format(toDate(date))

/** useCalendarGrid's narrow weekday names, Sunday first. */
export const weekdayNames = (): ReadonlyArray<string> => {
	const narrow = formatter({ weekday: "narrow" })
	return Array.from({ length: 7 }, (_, index) => narrow.format(new Date(Date.UTC(2026, 2, 1 + index))))
}

/** React Aria's `formatRange`: Intl's range parts joined by "to" instead of the shared literal. */
export const formatRange = (start: CalendarDate, end: CalendarDate): string => {
	const rangeParts = fullDate.formatRangeToParts(toDate(start), toDate(end))
	let separator = -1
	for (const [index, part] of rangeParts.entries()) {
		if (part.source === "shared" && part.type === "literal") separator = index
		else if (part.source === "endRange") break
	}
	const startText = rangeParts
		.slice(0, Math.max(separator, 0))
		.map((part) => part.value)
		.join("")
	const endText = rangeParts
		.slice(separator + 1)
		.map((part) => part.value)
		.join("")
	return `${startText} to ${endText}`
}
