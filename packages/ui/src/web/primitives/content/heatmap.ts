// Owned by lane A1 (`docs/hazel-ui-phase4.md`, W2b). `hz:heatmap`: today's year calendar
// (`customers/charts/calendar-heatmap.ts`): a square per day shaded by level, month and weekday
// labels, the hovered or selected day's tooltip, one tab stop the arrow keys step, and a legend.
import type { HeatmapDay } from "../../../vocabulary/content.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, textOf } from "../list/runtime.ts"
import { registerScroller } from "../list/scroll.ts"
import { toneOf } from "./chart/styles.ts"
import { type CalendarLayout, calendarLayout, formatDayLong, stepDay } from "./heatmap/layout.ts"

const ROOT = '[data-hz="heatmap"]'
const level = (alpha: number) => `color-mix(in oklab, ${toneOf("series-1")} ${alpha}%, transparent)`

/**
 * What the recipe cannot say: positions in the calendar's own space (percent of its box), the level
 * fills (mixes of `chart-series-1`), the phone's scrolling year (`min-w-160` below `sm`, opened on the
 * latest weeks by `rtl`), the focus ring and the tooltip's placement.
 */
const css = `
${ROOT} { display: flex; flex-direction: column; gap: var(--hz-space-4); min-width: 0; }
${ROOT} > [data-hz-part="scroller"] { min-width: 0; }
${ROOT} [data-hz-part="grid"] { position: relative; outline: none; border-radius: var(--hz-radius-md); }
${ROOT} [data-hz-part="grid"]:focus-visible { box-shadow: 0 0 0 2px color-mix(in oklab, var(--hz-color-ring) 70%, transparent); }
@media (width < 40rem) {
	${ROOT} > [data-hz-part="scroller"] { overflow-x: auto; }
	${ROOT} [data-hz-part="grid"] { min-width: calc(var(--hz-space-16) * 10); }
}
${ROOT} :is([data-hz-part="days"], [data-hz-part="months"], [data-hz-part="weekdays"]) { position: absolute; inset: 0; }
${ROOT} :is([data-hz-part="months"], [data-hz-part="weekdays"]) { pointer-events: none; }
${ROOT} [data-hz-part="day"] { position: absolute; border-radius: 20%; background: var(--hz-color-secondary); }
${ROOT} [data-hz-part="day"][data-level="1"] { background: ${level(35)}; }
${ROOT} [data-hz-part="day"][data-level="2"] { background: ${level(60)}; }
${ROOT} [data-hz-part="day"][data-level="3"] { background: ${level(80)}; }
${ROOT} [data-hz-part="day"][data-level="4"] { background: ${level(100)}; }
${ROOT} [data-hz-part="day"][data-active] {
	box-shadow: 0 0 0 0.5px color-mix(in oklab, var(--hz-color-fg) 70%, transparent),
		inset 0 0 0 0.5px color-mix(in oklab, var(--hz-color-fg) 70%, transparent);
}
${ROOT} :is([data-hz-part="month"], [data-hz-part="weekday"]) { position: absolute; white-space: nowrap; }
${ROOT} [data-hz-part="weekday"] { left: 0; translate: 0 -50%; }
${ROOT} [data-hz-part="month"] { top: 0; }
${ROOT} [data-hz-part="tooltip"] { position: absolute; z-index: 10; pointer-events: none; white-space: nowrap; }
${ROOT} [data-hz-part="tooltip"][hidden] { display: none; }
${ROOT} [data-hz-part="legend"] { align-self: flex-end; }
${ROOT} [data-hz-part="legendLabel"]:first-child { margin-inline-end: var(--hz-space-1_5); }
${ROOT} [data-hz-part="legendLabel"]:last-child { margin-inline-start: var(--hz-space-1_5); }
${ROOT} [data-hz-part="swatch"][data-level="0"] { background: var(--hz-color-secondary); }
${ROOT} [data-hz-part="swatch"][data-level="1"] { background: ${level(35)}; }
${ROOT} [data-hz-part="swatch"][data-level="2"] { background: ${level(60)}; }
${ROOT} [data-hz-part="swatch"][data-level="3"] { background: ${level(80)}; }
${ROOT} [data-hz-part="swatch"][data-level="4"] { background: ${level(100)}; }
${ROOT} [data-hz-part="live"] {
	position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
`

/** Cell size and gap in the calendar's units (today's viewBox), and the room for the labels. */
const CELL = 10
const GAP = 3
const STEP = CELL + GAP
const LEFT = 32
const TOP = 20

const WEEKDAYS = [
	[0, "Mon"],
	[2, "Wed"],
	[4, "Fri"],
] as const

const isDay = (value: unknown): value is HeatmapDay =>
	typeof value === "object" &&
	value !== null &&
	"date" in value &&
	typeof value.date === "string" &&
	"level" in value &&
	typeof value.level === "number" &&
	"label" in value &&
	typeof value.label === "string"

export const primitive = definePrimitive("heatmap", ({ document, tag, outer }) => {
	ensureSheet(document, "heatmap", css)
	const node = outer("div")
	// Below `sm` the year scrolls; `rtl` opens it on the latest weeks.
	const scroller = part(document, "div", "scroller")
	scroller.dir = "rtl"
	const grid = part(document, "div", "grid")
	grid.dir = "ltr"
	grid.tabIndex = 0
	grid.setAttribute("role", "group")
	const live = part(document, "span", "live")
	live.setAttribute("aria-live", "polite")
	const days = part(document, "div", "days")
	days.setAttribute("aria-hidden", "true")
	const months = part(document, "div", "months")
	months.setAttribute("aria-hidden", "true")
	const weekdays = part(document, "div", "weekdays")
	weekdays.setAttribute("aria-hidden", "true")
	const tooltip = part(document, "div", "tooltip")
	tooltip.setAttribute("role", "presentation")
	tooltip.hidden = true
	const tooltipValue = part(document, "span", "tooltipValue")
	const tooltipDate = part(document, "span", "tooltipDate")
	tooltip.append(tooltipValue, tooltipDate)
	grid.append(live, days, months, weekdays, tooltip)
	scroller.append(grid)

	const legend = part(document, "div", "legend")
	legend.setAttribute("aria-hidden", "true")
	const legendLabel = (text: string) => {
		const label = part(document, "span", "legendLabel")
		label.textContent = text
		return label
	}
	legend.append(
		legendLabel("Less"),
		...[0, 1, 2, 3, 4].map((step) => {
			const swatch = part(document, "span", "swatch")
			swatch.dataset.level = String(step)
			return swatch
		}),
		legendLabel("More"),
	)
	node.append(scroller, legend)

	let label = ""
	let plan: CalendarLayout = calendarLayout([])
	let cells: ReadonlyArray<HTMLElement> = []
	let selected: string | undefined
	let hovered: number | null = null
	let cursor: number | null = null

	const width = () => LEFT + plan.weeks * STEP - GAP
	const height = TOP + 7 * STEP - GAP
	const selectedIndex = () => {
		const index = plan.cells.findIndex((cell) => cell.day.date === selected)
		return index < 0 ? null : index
	}
	const active = () => hovered ?? cursor ?? selectedIndex()

	const drawActive = () => {
		const index = active()
		for (const [at, cell] of cells.entries()) {
			if (at === index) cell.dataset.active = ""
			else delete cell.dataset.active
		}
		const cell = index === null ? undefined : plan.cells[index]
		if (cell === undefined) {
			tooltip.hidden = true
			live.textContent = ""
			return
		}
		tooltipValue.textContent = cell.day.label
		tooltipDate.textContent = ` · ${formatDayLong(cell.day.date)}`
		live.textContent = `${cell.day.label}, ${formatDayLong(cell.day.date)}`
		// Kept inside the calendar: anchored by its near edge at the ends, under the top rows rather
		// than over the month labels.
		const x = ((LEFT + cell.week * STEP + CELL / 2) / width()) * 100
		const below = cell.weekday < 3
		tooltip.style.left = `${x}%`
		tooltip.style.translate = `${x < 25 ? "calc(-1 * var(--hz-space-3))" : x > 75 ? "calc(-100% + var(--hz-space-3))" : "-50%"} ${below ? "0" : "-100%"}`
		tooltip.style.top = below
			? `calc(${((TOP + (cell.weekday + 1) * STEP) / height) * 100}% + var(--hz-space-1))`
			: `calc(${((TOP + cell.weekday * STEP) / height) * 100}% - var(--hz-space-1_5))`
		tooltip.hidden = false
	}

	const percent = (value: number, of: number) => `${(value / of) * 100}%`

	const draw = () => {
		const w = width()
		grid.style.aspectRatio = plan.weeks === 0 ? "" : `${w} / ${height}`
		grid.setAttribute(
			"aria-label",
			label === ""
				? "Use the arrow keys to read each day."
				: `${label}. Use the arrow keys to read each day.`,
		)
		cells = plan.cells.map((cell) => {
			const day = part(document, "span", "day")
			day.dataset.level = String(cell.day.level)
			// What `scrollTo({key})` finds (`list/scroll.ts`): the day's date.
			day.dataset.hzKey = cell.day.date
			day.style.left = percent(LEFT + cell.week * STEP, w)
			day.style.top = percent(TOP + cell.weekday * STEP, height)
			day.style.width = percent(CELL, w)
			day.style.height = percent(CELL, height)
			day.addEventListener("pointerenter", () => {
				hovered = cell.index
				drawActive()
			})
			return day
		})
		days.replaceChildren(...cells)
		months.replaceChildren(
			...plan.months.map((month) => {
				const text = part(document, "span", "month")
				text.style.left = percent(LEFT + month.week * STEP, w)
				text.textContent = month.label
				return text
			}),
		)
		weekdays.replaceChildren(
			...(plan.weeks === 0
				? []
				: WEEKDAYS.map(([weekday, name]) => {
						const text = part(document, "span", "weekday")
						text.style.top = percent(TOP + weekday * STEP + CELL / 2, height)
						text.textContent = name
						return text
					})),
		)
		if (hovered !== null && hovered >= plan.cells.length) hovered = null
		if (cursor !== null && cursor >= plan.cells.length) cursor = null
		drawActive()
	}

	const choose = (index: number) => {
		const cell = plan.cells[index]
		if (cell !== undefined) fire(primitive, "select", { date: cell.day.date })
	}

	grid.addEventListener("pointerleave", () => {
		hovered = null
		drawActive()
	})
	days.addEventListener("click", (event) => {
		const index = cells.findIndex((cell) => cell === event.target)
		if (index < 0) return
		cursor = index
		drawActive()
		choose(index)
	})
	grid.addEventListener("focus", () => {
		cursor = selectedIndex() ?? (plan.cells.length === 0 ? null : plan.cells.length - 1)
		drawActive()
	})
	grid.addEventListener("blur", () => {
		cursor = null
		drawActive()
	})
	grid.addEventListener("keydown", (event) => {
		const next = stepDay(event.key, cursor ?? selectedIndex(), plan.cells.length)
		if (next === undefined) return
		event.preventDefault()
		cursor = next
		hovered = null
		drawActive()
		if (next !== null) {
			cells[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" })
			choose(next)
		}
	})

	registerScroller(node, {
		toEdge: (edge) => {
			const end = scroller.scrollWidth - scroller.clientWidth
			// `rtl`: the latest weeks are at scroll 0 in Chrome and Safari, the oldest at minus the width.
			scroller.scrollTo({ left: edge === "end" ? 0 : -end })
		},
		rows: () => cells,
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "label") label = textOf(value)
			else if (name === "days") plan = calendarLayout(Array.isArray(value) ? value.filter(isDay) : [])
			else if (name === "selected") {
				selected = typeof value === "string" && value !== "" ? value : undefined
				drawActive()
				return
			} else return
			draw()
		},
		events: undefined,
	}
	draw()
	return primitive
})
