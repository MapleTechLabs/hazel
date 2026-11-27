/**
 * The calendar's layout, pure (today's `customers/charts/calendar-heatmap.ts`): one column per week,
 * Monday on top, a month's name over the first full week it starts in, and the keys that step a day.
 */
import type { HeatmapDay } from "../../../../vocabulary/content.ts"

export interface HeatCell {
	readonly index: number
	readonly day: HeatmapDay
	readonly week: number
	/** 0 is Monday. */
	readonly weekday: number
}

export interface CalendarLayout {
	readonly cells: ReadonlyArray<HeatCell>
	readonly weeks: number
	readonly months: ReadonlyArray<{ readonly week: number; readonly label: string }>
}

const DAY_MS = 86_400_000

/** Milliseconds of a UTC calendar day `YYYY-MM-DD` (days name UTC days, as today's `Day`). */
export const dayToMs = (date: string): number => Date.parse(`${date}T00:00:00Z`)

const monthShort = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
const dayLong = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
	timeZone: "UTC",
})

/** `Nov`, a month label. */
export const formatMonthShort = (date: string): string => monthShort.format(dayToMs(date))

/** `Fri, Nov 20`, the tooltip's day. */
export const formatDayLong = (date: string): string => dayLong.format(dayToMs(date))

/** Monday 0 to Sunday 6. */
const weekdayOf = (date: string) => (new Date(dayToMs(date)).getUTCDay() + 6) % 7

/** A month label needs this many weeks of room before the next. */
const MONTH_GAP_WEEKS = 3

/** Lays out the days, oldest first; a missing day leaves its square empty. */
export const calendarLayout = (days: ReadonlyArray<HeatmapDay>): CalendarLayout => {
	const sorted = days
		.filter((day) => Number.isFinite(dayToMs(day.date)))
		.toSorted((a, b) => dayToMs(a.date) - dayToMs(b.date))
	const first = sorted[0]
	if (first === undefined) return { cells: [], weeks: 0, months: [] }
	const start = dayToMs(first.date)
	const offset = weekdayOf(first.date)
	const cells = sorted.map((day, index): HeatCell => {
		const position = Math.round((dayToMs(day.date) - start) / DAY_MS) + offset
		return { index, day, week: Math.floor(position / 7), weekday: position % 7 }
	})
	const lastWeek = cells.at(-1)?.week ?? 0
	const months: Array<{ week: number; label: string }> = []
	for (const cell of cells) {
		if (!cell.day.date.endsWith("-01") && cell.index !== 0) continue
		// A month starting mid-week is labelled over the next full week, as GitHub does; the last
		// week has no next one, so its month is labelled over itself.
		const week = Math.min(cell.weekday === 0 || cell.index === 0 ? cell.week : cell.week + 1, lastWeek)
		const previous = months.at(-1)
		if (previous !== undefined && week - previous.week < MONTH_GAP_WEEKS) {
			// The first, partial month gives way to the first full one.
			if (previous.week === 0) months.pop()
			else continue
		}
		months.push({ week, label: formatMonthShort(cell.day.date) })
	}
	return { cells, weeks: lastWeek + 1, months }
}

/**
 * The day a key moves to from `index` (none: the last day): up and down a day, left and right a
 * week, Home and End the ends; `null` for Escape (off the calendar), `undefined` for other keys.
 */
export const stepDay = (key: string, index: number | null, count: number): number | null | undefined => {
	const last = count - 1
	const from = index ?? last
	const to = (target: number) => Math.min(last, Math.max(0, target))
	const steps = {
		ArrowUp: () => to(from - 1),
		ArrowDown: () => to(from + 1),
		ArrowLeft: () => to(from - 7),
		ArrowRight: () => to(from + 7),
		Home: () => to(0),
		End: () => to(last),
		Escape: () => null,
	}
	const isStep = (name: string): name is keyof typeof steps => Object.hasOwn(steps, name)
	return count === 0 || !isStep(key) ? undefined : steps[key]()
}
