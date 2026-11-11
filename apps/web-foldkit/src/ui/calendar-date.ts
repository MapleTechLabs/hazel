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
const monthYear = formatter({ month: "long", year: "numeric" })
const shortMonth = formatter({ month: "short" })
const year = formatter({ year: "numeric" })
const day = formatter({ day: "numeric" })
export const formatMonthYear = (date: CalendarDate) => monthYear.format(toDate(date))
export const formatShortMonth = (date: CalendarDate) => shortMonth.format(toDate(date))
export const formatYear = (date: CalendarDate) => year.format(toDate(date))
export const formatDay = (date: CalendarDate) => day.format(toDate(date))

const narrowWeekday = formatter({ weekday: "narrow" })
const weekdays: ReadonlyArray<string> = Array.from({ length: 7 }, (_, index) =>
	narrowWeekday.format(new Date(Date.UTC(2026, 2, 1 + index))),
)

/** useCalendarGrid's narrow weekday names, Sunday first. */
export const weekdayNames = (): ReadonlyArray<string> => weekdays
