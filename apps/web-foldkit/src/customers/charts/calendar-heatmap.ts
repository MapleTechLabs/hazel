import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { dayToMs, formatDayLong, formatMonthShort } from "../format"

/**
 * A year of days as a GitHub-style calendar: one column per week (Monday on top), each day a square
 * shaded by its value relative to the busiest day. The chart owns no state: the page keeps the
 * hovered day and passes it back in, the way the axis charts do.
 */

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export type HeatCell = Readonly<{
	/** Index into the points passed in (what `onHover` reports). */
	index: number
	day: string
	value: number
	level: HeatLevel
	week: number
	/** 0 is Monday. */
	weekday: number
}>

export type CalendarLayout = Readonly<{
	cells: ReadonlyArray<HeatCell>
	weeks: number
	/** A month's name over the first week it starts in. */
	months: ReadonlyArray<Readonly<{ week: number; label: string }>>
	max: number
}>

/** None for zero, else a quarter of the busiest day's value per step: any activity shows. */
export const heatLevel = (value: number, max: number): HeatLevel =>
	value <= 0 || max <= 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((value / max) * 4))) as HeatLevel)

/** Monday 0 … Sunday 6, of a UTC `Day`. */
const weekdayOf = (day: string) => (new Date(dayToMs(day)).getUTCDay() + 6) % 7

/** A month label needs this many weeks of room before the next. */
const MONTH_GAP_WEEKS = 3

/** Lays out consecutive daily points, oldest first. */
export const calendarLayout = (
	points: ReadonlyArray<Readonly<{ day: string; value: number }>>,
): CalendarLayout => {
	const first = points[0]
	if (first === undefined) return { cells: [], weeks: 0, months: [], max: 0 }
	const offset = weekdayOf(first.day)
	const max = points.reduce((most, point) => Math.max(most, point.value), 0)
	const cells = points.map((point, index): HeatCell => ({
		index,
		day: point.day,
		value: point.value,
		level: heatLevel(point.value, max),
		week: Math.floor((index + offset) / 7),
		weekday: (index + offset) % 7,
	}))
	const months: Array<{ week: number; label: string }> = []
	for (const cell of cells) {
		const starts = cell.day.endsWith("-01") || cell.index === 0
		if (!starts) continue
		// A month starting mid-week is labelled over the next full week, as GitHub does.
		const week = cell.weekday === 0 || cell.index === 0 ? cell.week : cell.week + 1
		const previous = months.at(-1)
		if (previous !== undefined && week - previous.week < MONTH_GAP_WEEKS) {
			// The first, partial month gives way to the first full one.
			if (previous.week === 0) months.pop()
			else continue
		}
		months.push({ week, label: formatMonthShort(cell.day) })
	}
	return { cells, weeks: (cells.at(-1)?.week ?? 0) + 1, months, max }
}

const LEVEL_CLASS = {
	0: "fill-secondary",
	1: "fill-chart-series-1/25",
	2: "fill-chart-series-1/50",
	3: "fill-chart-series-1/75",
	4: "fill-chart-series-1",
} as const satisfies Record<HeatLevel, string>

const LEVEL_SWATCH = {
	0: "bg-secondary",
	1: "bg-chart-series-1/25",
	2: "bg-chart-series-1/50",
	3: "bg-chart-series-1/75",
	4: "bg-chart-series-1",
} as const satisfies Record<HeatLevel, string>

/** Cell size and gap, in viewBox units. */
const CELL = 10
const GAP = 3
const STEP = CELL + GAP
/** Room for the weekday labels on the left and the month labels on top. */
const LEFT = 26
const TOP = 16

const WEEKDAY_LABELS = [
	[0, "Mon"],
	[2, "Wed"],
	[4, "Fri"],
] as const

export const heatLegend = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.AriaHidden(true), h.Class("flex items-center gap-1 text-muted-fg text-xs")],
		[
			h.span([h.Class("mr-1")], ["Less"]),
			...([0, 1, 2, 3, 4] as const).map((level) =>
				h.span([h.Class(twMerge("size-2.5 rounded-xs", LEVEL_SWATCH[level]))]),
			),
			h.span([h.Class("ml-1")], ["More"]),
		],
	)

export const calendarHeatmap = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		points: ReadonlyArray<Readonly<{ day: string; value: number }>>
		ariaLabel: string
		/** The tooltip's line for a day's value: `3 active users`. */
		describe: (value: number) => string
		hoveredIndex: number | null
		onHover: (index: number | null) => M
		className?: string
	}>,
): Html => {
	const layout = calendarLayout(options.points)
	const width = LEFT + layout.weeks * STEP - GAP
	const height = TOP + 7 * STEP - GAP
	const hovered = options.hoveredIndex === null ? undefined : layout.cells[options.hoveredIndex]
	/** The hovered day's centre, percent of the chart's width. */
	const x = hovered === undefined ? 0 : ((LEFT + hovered.week * STEP + CELL / 2) / width) * 100
	// Below `sm` the year keeps a readable size and scrolls; `rtl` opens it on the latest weeks.
	return h.div(
		[h.Dir("rtl"), h.Class(twMerge("min-w-0 overflow-x-auto sm:overflow-visible", options.className))],
		[
			h.div(
				[
					h.Dir("ltr"),
					h.Class("relative min-w-160 sm:min-w-0"),
					h.OnMouseLeave(options.onHover(null)),
				],
				[
					h.svg(
						[
							h.Attribute("viewBox", `0 0 ${width} ${height}`),
							h.Role("img"),
							h.AriaLabel(options.ariaLabel),
							h.Class("block h-auto w-full overflow-visible"),
						],
						[
							...layout.months.map(({ week, label }) =>
								h.text(
									[
										h.Attribute("x", String(LEFT + week * STEP)),
										h.Attribute("y", "9"),
										h.Attribute("font-size", "9"),
										h.Class("fill-muted-fg"),
									],
									[label],
								),
							),
							...WEEKDAY_LABELS.map(([weekday, label]) =>
								h.text(
									[
										h.Attribute("x", "0"),
										h.Attribute("y", String(TOP + weekday * STEP + CELL - 1.5)),
										h.Attribute("font-size", "9"),
										h.Class("fill-muted-fg"),
									],
									[label],
								),
							),
							...layout.cells.map((cell) =>
								h.rect([
									h.Attribute("x", String(LEFT + cell.week * STEP)),
									h.Attribute("y", String(TOP + cell.weekday * STEP)),
									h.Attribute("width", String(CELL)),
									h.Attribute("height", String(CELL)),
									h.Attribute("rx", "2"),
									h.OnMouseEnter(options.onHover(cell.index)),
									h.Class(
										twMerge(
											LEVEL_CLASS[cell.level],
											cell.index === options.hoveredIndex && "stroke-fg/40",
										),
									),
								]),
							),
						],
					),
					...(hovered === undefined
						? []
						: [
								h.div(
									[
										h.Role("presentation"),
										h.Class(
											twMerge(
												"pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-fg/10 bg-overlay px-2.5 py-1.5 text-overlay-fg text-xs shadow-md",
												// Kept inside the chart: anchored by its near edge at the ends,
												// and under the top rows rather than over the month labels.
												x < 25
													? "-translate-x-3"
													: x > 75
														? "-translate-x-[calc(100%-12px)]"
														: "-translate-x-1/2",
												hovered.weekday < 3 ? "translate-y-0" : "-translate-y-full",
											),
										),
										h.Style({
											left: `${x}%`,
											top:
												hovered.weekday < 3
													? `calc(${((TOP + (hovered.weekday + 1) * STEP) / height) * 100}% + 4px)`
													: `calc(${((TOP + hovered.weekday * STEP) / height) * 100}% - 6px)`,
										}),
									],
									[
										h.span(
											[h.Class("font-medium text-fg")],
											[options.describe(hovered.value)],
										),
										h.span(
											[h.Class("text-muted-fg")],
											[` · ${formatDayLong(hovered.day)}`],
										),
									],
								),
							]),
				],
			),
		],
	)
}
