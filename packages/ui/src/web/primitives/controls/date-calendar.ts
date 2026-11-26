/**
 * `hz:datePicker`'s month calendar (lane A2): today's `ui/calendar.ts` and `calendar-view.ts` (React
 * Aria's Calendar) as DOM. A grid of day buttons with one tab stop, arrow, Page and Home/End keys,
 * month and year selects, page buttons, `min`/`max` disabling, and the live announcements. No `primitive` export.
 */
import { svg } from "../../icons.ts"
import { part } from "../define.ts"

/** A plain calendar day, `YYYY-MM-DD` (Gregorian, formatted in UTC as the kit does). */
export type CalendarDate = string

const pad = (value: number, length = 2) => String(value).padStart(length, "0")
const toDate = (date: CalendarDate) => new Date(`${date}T00:00:00.000Z`)
const fromDate = (date: Date): CalendarDate =>
	`${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`

export const partsOf = (date: CalendarDate) => {
	const value = toDate(date)
	return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
}

/** The viewer's local day. */
export const todayOf = (now: Date): CalendarDate =>
	`${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

const addDays = (date: CalendarDate, days: number): CalendarDate => {
	const value = toDate(date)
	value.setUTCDate(value.getUTCDate() + days)
	return fromDate(value)
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** `CalendarDate.set` for months and years: the day is clamped to the target month. */
const withMonth = (date: CalendarDate, year: number, month: number): CalendarDate => {
	const normalized = new Date(Date.UTC(year, month - 1, 1))
	const targetYear = normalized.getUTCFullYear()
	const targetMonth = normalized.getUTCMonth() + 1
	const day = Math.min(partsOf(date).day, daysInMonth(targetYear, targetMonth))
	return `${pad(targetYear, 4)}-${pad(targetMonth)}-${pad(day)}`
}

const addMonths = (date: CalendarDate, months: number) => {
	const { year, month } = partsOf(date)
	return withMonth(date, year, month + months)
}

const startOfMonth = (date: CalendarDate) => `${date.slice(0, 7)}-01`
const isSameMonth = (a: CalendarDate, b: CalendarDate) => a.slice(0, 7) === b.slice(0, 7)

/** Weeks of the month view, Sunday first (en-US), the adjacent months' days included. */
const monthWeeks = (date: CalendarDate): ReadonlyArray<ReadonlyArray<CalendarDate>> => {
	const first = startOfMonth(date)
	const { year, month } = partsOf(date)
	const leading = toDate(first).getUTCDay()
	const start = addDays(first, -leading)
	const weekCount = Math.ceil((leading + daysInMonth(year, month)) / 7)
	return Array.from({ length: weekCount }, (_, week) =>
		Array.from({ length: 7 }, (_, weekday) => addDays(start, week * 7 + weekday)),
	)
}

const formatter = (options: Intl.DateTimeFormatOptions) =>
	new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" })
const fullDate = formatter({ weekday: "long", month: "long", day: "numeric", year: "numeric" })
const monthYear = formatter({ month: "long", year: "numeric" })
const shortMonth = formatter({ month: "short" })
const dayNumber = formatter({ day: "numeric" })
const narrowWeekday = formatter({ weekday: "narrow" })
const weekdays = Array.from({ length: 7 }, (_, index) =>
	narrowWeekday.format(new Date(Date.UTC(2026, 2, 1 + index))),
)

/** The years either side of the focused one in the year select (the kit's `YEAR_SPAN`). */
const YEAR_SPAN = 20

/** useCalendarBase's announcement timeouts are the announcer's; here one live region per picker. */
export interface CalendarConfig {
	readonly document: Document
	/** Names the calendar together with its month (`<label>, November 2026`); undefined: the month alone. */
	readonly label: () => string | undefined
	readonly onPick: (date: CalendarDate) => void
	readonly announce: (message: string) => void
}

export interface Bounds {
	readonly today: CalendarDate
	readonly value: CalendarDate | null
	readonly min: CalendarDate | null
	readonly max: CalendarDate | null
}

/** Clamped between `min` and `max` (useCalendarState's constrainValue). */
const clamp = (bounds: Bounds, date: CalendarDate) =>
	bounds.min !== null && date < bounds.min
		? bounds.min
		: bounds.max !== null && date > bounds.max
			? bounds.max
			: date

const isOutOfRange = (bounds: Bounds, date: CalendarDate) =>
	(bounds.min !== null && date < bounds.min) || (bounds.max !== null && date > bounds.max)

/** A day's accessible name: today, the full date, selected, then the first or last available date. */
const cellLabel = (bounds: Bounds, date: CalendarDate, selected: boolean) => {
	const dated = fullDate.format(toDate(date))
	const named = `${date === bounds.today ? `Today, ${dated}` : dated}${selected ? " selected" : ""}`
	if (date === bounds.min) return `${named}, First available date`
	if (date === bounds.max) return `${named}, Last available date`
	return named
}

const keyOffsets = new Map<string, (date: CalendarDate) => CalendarDate>([
	["ArrowRight", (date) => addDays(date, 1)],
	["ArrowLeft", (date) => addDays(date, -1)],
	["ArrowDown", (date) => addDays(date, 7)],
	["ArrowUp", (date) => addDays(date, -7)],
	["PageDown", (date) => addMonths(date, 1)],
	["PageUp", (date) => addMonths(date, -1)],
	["Home", (date) => addDays(date, -toDate(date).getUTCDay())],
	["End", (date) => addDays(date, 6 - toDate(date).getUTCDay())],
])

const visuallyHidden = (node: HTMLElement) => {
	node.dataset.hzVisuallyHidden = ""
	return node
}

export const makeCalendar = (config: CalendarConfig) => {
	const { document } = config
	const root = part(document, "div", "calendar")
	root.setAttribute("role", "application")
	const heading = visuallyHidden(part(document, "h2", "heading"))
	const header = part(document, "div", "header")
	const pickers = part(document, "div", "pickers")
	const month = part(document, "select", "month") as HTMLSelectElement
	month.setAttribute("aria-label", "Month")
	const year = part(document, "select", "year") as HTMLSelectElement
	year.setAttribute("aria-label", "Year")
	pickers.append(month, year)
	const pages = part(document, "div", "pages")
	const pageButton = (name: "previous" | "next", label: string, icon: "chevron-left" | "chevron-right") => {
		const button = part(document, "button", name) as HTMLButtonElement
		button.type = "button"
		button.setAttribute("aria-label", label)
		button.innerHTML = svg(icon)
		return button
	}
	const previous = pageButton("previous", "Previous", "chevron-left")
	const next = pageButton("next", "Next", "chevron-right")
	pages.append(previous, next)
	header.append(pickers, pages)
	const grid = part(document, "div", "grid")
	grid.setAttribute("role", "grid")
	root.append(heading, header, grid)

	let bounds: Bounds = { today: todayOf(new Date()), value: null, min: null, max: null }
	let focusedDate: CalendarDate = bounds.today

	const nameOf = () => {
		const month = monthYear.format(toDate(focusedDate))
		const label = config.label()
		return label === undefined || label === "" ? month : `${label}, ${month}`
	}

	const drawPickers = () => {
		const { year: focusedYear, month: focusedMonth } = partsOf(focusedDate)
		month.replaceChildren(
			...Array.from({ length: 12 }, (_, index) => {
				const option = document.createElement("option")
				option.value = String(index + 1)
				option.textContent = shortMonth.format(new Date(Date.UTC(2000, index, 1)))
				return option
			}),
		)
		month.value = String(focusedMonth)
		year.replaceChildren(
			...Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, index) => {
				const option = document.createElement("option")
				option.value = String(focusedYear - YEAR_SPAN + index)
				option.textContent = option.value
				return option
			}),
		)
		year.value = String(focusedYear)
		previous.disabled = bounds.min !== null && addDays(startOfMonth(focusedDate), -1) < bounds.min
		const nextMonth = startOfMonth(addMonths(startOfMonth(focusedDate), 1))
		next.disabled = bounds.max !== null && nextMonth > bounds.max
	}

	const drawGrid = () => {
		const head = part(document, "div", "weekdays")
		head.setAttribute("role", "row")
		head.setAttribute("aria-hidden", "true")
		head.append(
			...weekdays.map((name) => {
				const cell = part(document, "div", "weekday")
				cell.setAttribute("role", "columnheader")
				cell.textContent = name
				return cell
			}),
		)
		const weeks = monthWeeks(focusedDate).map((dates) => {
			const row = part(document, "div", "week")
			row.setAttribute("role", "row")
			row.append(
				...dates.map((date) => {
					const outside = !isSameMonth(date, focusedDate)
					const disabled = outside || isOutOfRange(bounds, date)
					const selected = !outside && date === bounds.value
					const cell = part(document, "div", "cell")
					cell.setAttribute("role", "gridcell")
					const day = part(document, "div", "day")
					day.setAttribute("role", "button")
					day.dataset.date = date
					day.textContent = dayNumber.format(toDate(date))
					day.setAttribute("aria-label", cellLabel(bounds, date, selected))
					for (const [name, on] of [
						["disabled", disabled],
						["selected", selected],
						["today", date === bounds.today],
						["outside-month", outside],
					] as const) {
						if (on) day.setAttribute(`data-${name}`, "")
					}
					if (disabled) {
						cell.setAttribute("aria-disabled", "true")
						day.setAttribute("aria-disabled", "true")
					} else day.tabIndex = date === focusedDate ? 0 : -1
					if (selected) cell.setAttribute("aria-selected", "true")
					cell.append(day)
					return cell
				}),
			)
			return row
		})
		grid.replaceChildren(head, ...weeks)
	}

	const draw = () => {
		const name = nameOf()
		root.setAttribute("aria-label", name)
		grid.setAttribute("aria-label", name)
		heading.textContent = name
		drawPickers()
		drawGrid()
	}

	const dayButton = (date: CalendarDate) => grid.querySelector<HTMLElement>(`[data-date="${date}"]`)

	/** Moves the focused date; a new visible month is announced unless the grid itself moved. */
	const moveTo = (date: CalendarDate, options: { readonly focus: boolean }) => {
		const before = monthYear.format(toDate(focusedDate))
		focusedDate = clamp(bounds, date)
		draw()
		const after = monthYear.format(toDate(focusedDate))
		if (options.focus) dayButton(focusedDate)?.focus({ preventScroll: true })
		else if (after !== before) config.announce(after)
	}

	const pick = (date: CalendarDate) => {
		if (isOutOfRange(bounds, date) || !isSameMonth(date, focusedDate)) return
		focusedDate = date
		config.onPick(date)
	}

	grid.addEventListener("click", (event) => {
		const day = (event.target as Element | null)?.closest<HTMLElement>("[data-hz-part=day]")
		const date = day?.dataset.date
		if (date === undefined || day?.hasAttribute("data-disabled") === true) return
		pick(date)
	})
	grid.addEventListener("keydown", (event) => {
		if (event.key === "Tab" || event.altKey || event.ctrlKey || event.metaKey) return
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault()
			pick(focusedDate)
			return
		}
		const offset = keyOffsets.get(event.key)
		if (offset === undefined) return
		event.preventDefault()
		const shifted =
			event.shiftKey && (event.key === "PageDown" || event.key === "PageUp")
				? addMonths(focusedDate, event.key === "PageDown" ? 12 : -12)
				: offset(focusedDate)
		moveTo(shifted, { focus: true })
	})
	previous.addEventListener("click", () => moveTo(addMonths(focusedDate, -1), { focus: false }))
	next.addEventListener("click", () => moveTo(addMonths(focusedDate, 1), { focus: false }))
	month.addEventListener("change", () =>
		moveTo(withMonth(focusedDate, partsOf(focusedDate).year, Number(month.value)), { focus: false }),
	)
	year.addEventListener("change", () =>
		moveTo(withMonth(focusedDate, Number(year.value), partsOf(focusedDate).month), { focus: false }),
	)

	return {
		node: root,
		/** Shows the value's month (else today's), as a picker reopening its calendar does. */
		show: (next: Bounds) => {
			bounds = next
			focusedDate = clamp(next, next.value ?? next.today)
			draw()
		},
		/** The focused day's button: where focus goes when the popover opens. */
		focusTarget: () => dayButton(focusedDate),
	}
}
