/**
 * The editing state behind `hz:datePicker`'s segments (lane A2): today's `ui/date-segments.ts` (React
 * Aria's IncompleteDate, useDateFieldState and useDateSegment typing rules) without Foldkit, plus the
 * `dateTime` granularity. Pure: the renderer owns the DOM and focus. No `primitive` export.
 */

export type Granularity = "date" | "time" | "dateTime"
export type SegmentType = "year" | "month" | "day" | "hour" | "minute" | "dayPeriod"

export interface Values {
	readonly year: number | null
	readonly month: number | null
	readonly day: number | null
	readonly hour: number | null
	readonly minute: number | null
	readonly dayPeriod: number | null
}

/** A plain day (`today`), the placeholder empty segments spin from. */
export interface Day {
	readonly year: number
	readonly month: number
	readonly day: number
}

export interface State {
	readonly granularity: Granularity
	readonly values: Values
	readonly today: Day
	/** Digits typed so far into `enteredSegment` (React Aria resets them on focus). */
	readonly enteredKeys: string
	readonly enteredSegment: SegmentType | null
}

/** The locale segments are laid out and named in (the kit's placeholder table is English). */
export const LOCALE = "en-US"

const empty: Values = { year: null, month: null, day: null, hour: null, minute: null, dayPeriod: null }

const pad = (value: number, length = 2) => String(value).padStart(length, "0")

const DATE = /^(\d{4})-(\d{2})-(\d{2})/
const TIME = /(?:^|[T ])(\d{2}):(\d{2})/

/** Values from ISO text: `2026-11-30`, `09:30`, or `2026-11-30T09:30`; what does not parse is empty. */
export const parse = (granularity: Granularity, value: string | null): Values => {
	if (value === null) return empty
	const date = granularity === "time" ? null : DATE.exec(value)
	const time = granularity === "date" ? null : TIME.exec(value)
	const hour24 = time === null ? null : Number(time[1])
	return {
		year: date === null ? null : Number(date[1]),
		month: date === null ? null : Number(date[2]),
		day: date === null ? null : Number(date[3]),
		hour: hour24 === null ? null : hour24 % 12 === 0 ? 12 : hour24 % 12,
		minute: time === null ? null : Number(time[2]),
		dayPeriod: hour24 === null ? null : hour24 >= 12 ? 1 : 0,
	}
}

export const make = (granularity: Granularity, value: string | null, today: Day): State => ({
	granularity,
	values: parse(granularity, value),
	today,
	enteredKeys: "",
	enteredSegment: null,
})

// FORMATTING

const utc = { timeZone: "UTC" } as const
const numericDate = { year: "numeric", month: "numeric", day: "numeric" } as const
const numericTime = { hour: "numeric", minute: "2-digit" } as const
const formatters = {
	date: new Intl.DateTimeFormat(LOCALE, { ...numericDate, ...utc }),
	time: new Intl.DateTimeFormat(LOCALE, { ...numericTime, ...utc }),
	dateTime: new Intl.DateTimeFormat(LOCALE, { ...numericDate, ...numericTime, ...utc }),
	monthName: new Intl.DateTimeFormat(LOCALE, { month: "long", ...utc }),
	hour: new Intl.DateTimeFormat(LOCALE, { hour: "numeric", ...utc }),
	longDate: new Intl.DateTimeFormat(LOCALE, { dateStyle: "long", ...utc }),
	longDateTime: new Intl.DateTimeFormat(LOCALE, { dateStyle: "long", timeStyle: "short", ...utc }),
	fieldNames: new Intl.DisplayNames(LOCALE, { type: "dateTimeField" }),
}

const isSegmentType = (type: string): type is SegmentType =>
	type === "year" ||
	type === "month" ||
	type === "day" ||
	type === "hour" ||
	type === "minute" ||
	type === "dayPeriod"

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** IncompleteDate.toValue: missing segments from the placeholder (today, midnight), the day constrained. */
export const dateOf = (state: State): Date => {
	const { values, today } = state
	const year = values.year ?? today.year
	const month = values.month ?? today.month
	const day = Math.min(values.day ?? today.day, daysIn(year, month))
	const hour =
		values.hour !== null
			? (values.hour % 12) + (values.dayPeriod === 1 ? 12 : 0)
			: values.dayPeriod === 1
				? 12
				: 0
	const date = new Date(Date.UTC(2000, 0, 1, hour, values.minute ?? 0))
	date.setUTCFullYear(year, month - 1, day)
	return date
}

/** The editable segments in their Intl order. */
export const order = (granularity: Granularity): ReadonlyArray<SegmentType> =>
	formatters[granularity]
		.formatToParts(new Date(Date.UTC(2000, 0, 1)))
		.map((part) => part.type)
		.filter(isSegmentType)

/** useDateFieldState's getSegmentLimits: the day ends at the displayed month's length. */
export const limits = (state: State, type: SegmentType) =>
	({
		year: { min: 1, max: 9999 },
		month: { min: 1, max: 12 },
		day: {
			min: 1,
			max: daysIn(state.values.year ?? state.today.year, state.values.month ?? state.today.month),
		},
		hour: { min: 1, max: 12 },
		minute: { min: 0, max: 59 },
		dayPeriod: { min: 0, max: 1 },
	})[type]

/** The ISO text of a complete value (`2026-11-30`, `09:30`, `2026-11-30T09:30`), else null. */
export const complete = (state: State): string | null => {
	if (!order(state.granularity).every((type) => state.values[type] !== null)) return null
	const date = dateOf(state)
	const day = `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
	const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
	return state.granularity === "date" ? day : state.granularity === "time" ? time : `${day}T${time}`
}

export const isEmpty = (state: State) => order(state.granularity).every((type) => state.values[type] === null)

/** useDatePickerGroup's description of a complete value: "Selected Date: November 30, 2026". */
export const selectedDescription = (state: State): string | null => {
	if (complete(state) === null) return null
	const date = dateOf(state)
	return state.granularity === "date"
		? `Selected Date: ${formatters.longDate.format(date)}`
		: state.granularity === "time"
			? `Selected Time: ${formatters.time.format(date)}`
			: `Selected Date: ${formatters.longDateTime.format(date)}`
}

export const fieldName = (type: SegmentType) => formatters.fieldNames.of(type) ?? type

/** A drawn segment, editable or literal (React Aria's DateSegment). */
export interface Segment {
	readonly type: SegmentType | "literal"
	readonly text: string
	readonly isPlaceholder: boolean
	readonly value: number | null
	readonly valueText: string
}

const datePlaceholders = { year: "yyyy", month: "mm", day: "dd" } as const

const literal = (text: string): Segment => ({
	type: "literal",
	text,
	isPlaceholder: false,
	value: null,
	valueText: "",
})

/** useDateFieldState's processSegments: Intl parts, the time wrapped in left-to-right isolates. */
export const segments = (state: State): ReadonlyArray<Segment> => {
	const date = dateOf(state)
	const monthName = formatters.monthName.format(date)
	const hourText = formatters.hour.format(date)
	return formatters[state.granularity].formatToParts(date).flatMap((part): ReadonlyArray<Segment> => {
		if (part.type === "literal") return [literal(part.value)]
		const type = part.type
		if (!isSegmentType(type)) return []
		const value = state.values[type]
		const isPlaceholder = value === null
		const formatted = type === "minute" || type === "dayPeriod" ? part.value : String(value ?? 0)
		const placeholder =
			type === "dayPeriod"
				? part.value
				: type === "hour" || type === "minute"
					? "––"
					: datePlaceholders[type]
		const text = isPlaceholder ? placeholder : formatted
		const valueText = isPlaceholder
			? "Empty"
			: type === "month"
				? text === monthName
					? monthName
					: `${text} – ${monthName}`
				: type === "hour"
					? hourText
					: text
		const segment: Segment = { type, text, isPlaceholder, value, valueText }
		return type === "hour"
			? [literal("⁦"), segment]
			: type === "minute"
				? [segment, literal("⁩")]
				: [segment]
	})
}

// EDITING

/** What a keystroke did: the next state, and a focus move to the previous (-1) or next (1) segment. */
export interface Result {
	readonly state: State
	readonly move: -1 | 0 | 1
}

const PAGE_STEP = {
	year: 5,
	month: 2,
	day: 7,
	hour: 2,
	minute: 15,
	dayPeriod: 1,
} as const satisfies Record<SegmentType, number>

/** IncompleteDate's cycleValue. */
const cycleValue = (value: number, amount: number, min: number, max: number, round = false) => {
	if (round) {
		let next = value + Math.sign(amount)
		if (next < min) next = max
		const div = Math.abs(amount)
		next = amount > 0 ? Math.ceil(next / div) * div : Math.floor(next / div) * div
		return next > max ? min : next
	}
	const next = value + amount
	if (next < min) return max - (min - next - 1)
	if (next > max) return min + (next - max - 1)
	return next
}

const withValues = (state: State, values: Partial<Values>): State => ({
	...state,
	values: { ...state.values, ...values },
})

/** IncompleteDate.set: setting the hour fills the day period (AM, the placeholder's midnight). */
const setSegment = (state: State, type: SegmentType, value: number): State => {
	const next = withValues(state, { [type]: value })
	return type === "hour" && state.values.dayPeriod === null ? withValues(next, { dayPeriod: 0 }) : next
}

/** Every segment's values at once (a day picked in the calendar keeps the time). */
export const setDay = (state: State, day: Day): State =>
	withValues({ ...state, enteredKeys: "", enteredSegment: null }, day)

const cycle = (state: State, type: SegmentType, amount: number): State => {
	const current = state.values[type]
	const { min, max } = limits(state, type)
	if (current === null && type !== "dayPeriod") {
		if (type === "hour") return setSegment(state, "hour", 12)
		if (type === "minute") return withValues(state, { minute: 0 })
		return withValues(state, { [type]: state.today[type] })
	}
	const base = current ?? 0
	const next =
		type === "minute" ? cycleValue(base, amount, min, max, true) : cycleValue(base, amount, min, max)
	return type === "hour" ? setSegment(state, type, next) : withValues(state, { [type]: next })
}

const stay = (state: State): Result => ({ state, move: 0 })

/** useDateSegment's onInput for numeric segments and the day period. */
const typed = (state: State, type: SegmentType, key: string): Result => {
	if (type === "dayPeriod") {
		const lower = key.toLowerCase()
		const period = lower === "a" ? 0 : lower === "p" ? 1 : null
		return period === null ? stay(state) : { state: withValues(state, { dayPeriod: period }), move: 1 }
	}
	const entered = (state.enteredSegment === type ? state.enteredKeys : "") + key
	if (!/^\d+$/.test(entered)) return stay(state)
	const { max } = limits(state, type)
	const numberValue = Number(entered)
	const next = setSegment(state, type, numberValue > max ? Number(key) : numberValue)
	const isDone = Number(`${numberValue}0`) > max || entered.length >= String(max).length
	return isDone
		? { state: { ...next, enteredKeys: "", enteredSegment: null }, move: 1 }
		: stay({ ...next, enteredKeys: entered, enteredSegment: type })
}

/** useDateSegment's backspace: drop the last digit, or clear; an empty segment moves back. */
const backspace = (state: State, type: SegmentType): Result => {
	const segment = segments(state).find((candidate) => candidate.type === type)
	const text = segment?.text ?? ""
	const isPlaceholder = segment?.isPlaceholder ?? true
	const move = isPlaceholder ? -1 : 0
	if (/^\d+$/.test(text) && !isPlaceholder) {
		const shorter = text.slice(0, -1)
		const cleared = shorter.length === 0 || Number(shorter) === 0
		const next = cleared ? withValues(state, { [type]: null }) : setSegment(state, type, Number(shorter))
		return { state: { ...next, enteredKeys: cleared ? "" : shorter, enteredSegment: type }, move }
	}
	return { state: type === "dayPeriod" ? withValues(state, { dayPeriod: null }) : state, move }
}

type Action = (state: State, type: SegmentType) => Result

const keyActions = new Map<string, Action>([
	["ArrowUp", (state, type) => stay(cycle(state, type, 1))],
	["ArrowDown", (state, type) => stay(cycle(state, type, -1))],
	["PageUp", (state, type) => stay(cycle(state, type, PAGE_STEP[type]))],
	["PageDown", (state, type) => stay(cycle(state, type, -PAGE_STEP[type]))],
	["Home", (state, type) => stay(setSegment(state, type, limits(state, type).min))],
	["End", (state, type) => stay(setSegment(state, type, limits(state, type).max))],
	["ArrowLeft", (state) => ({ state, move: -1 })],
	["ArrowRight", (state) => ({ state, move: 1 })],
	["Backspace", backspace],
	["Delete", backspace],
])

/** Keys a segment handles (and prevents): spin and navigation keys, plus printable characters. */
export const isSegmentKey = (key: string) => keyActions.has(key) || key.length === 1

/** One keystroke on a focused segment. Spinning and moving reset the typed digits. */
export const press = (state: State, type: SegmentType, key: string): Result => {
	const action = keyActions.get(key)
	if (action === undefined) return typed(state, type, key)
	return action(key === "Backspace" || key === "Delete" ? state : { ...state, enteredKeys: "" }, type)
}

/** A segment gaining focus starts a fresh entry. */
export const focused = (state: State): State => ({ ...state, enteredKeys: "", enteredSegment: null })
