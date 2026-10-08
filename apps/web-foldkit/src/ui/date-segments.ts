import { Effect, Schema } from "effect"
import { Command, type Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { announce, clearAssertive } from "./aria/announcer"

/**
 * The editing state behind DateField/TimeField: React Aria's IncompleteDate, useDateFieldState and
 * useDateSegment typing rules. Segment layout and text come from Intl, as in React Aria.
 */

// MODEL

export const Kind = Schema.Literals(["date", "time"])
export type Kind = typeof Kind.Type

export type SegmentType = "year" | "month" | "day" | "hour" | "minute" | "dayPeriod"

const Values = Schema.Struct({
	year: Schema.NullOr(Schema.Number),
	month: Schema.NullOr(Schema.Number),
	day: Schema.NullOr(Schema.Number),
	hour: Schema.NullOr(Schema.Number),
	minute: Schema.NullOr(Schema.Number),
	dayPeriod: Schema.NullOr(Schema.Number),
})
type Values = typeof Values.Type

const Placeholder = Schema.Struct({
	year: Schema.Number,
	month: Schema.Number,
	day: Schema.Number,
	hour: Schema.Number,
})

export const Model = Schema.Struct({
	id: Schema.String,
	kind: Kind,
	isDisabled: Schema.Boolean,
	isInvalid: Schema.Boolean,
	values: Values,
	/** The last complete value (`YYYY-MM-DD` or `HH:MM:SS`); clearing a segment keeps it. */
	committed: Schema.NullOr(Schema.String),
	placeholder: Placeholder,
	/** Digits typed so far, and the segment they belong to (React Aria resets them on focus). */
	enteredKeys: Schema.String,
	enteredSegment: Schema.NullOr(Schema.String),
	/** The segment keystrokes apply to, and how many commanded focus moves have not run yet. */
	activeSegment: Schema.NullOr(Schema.String),
	pendingFocusMoves: Schema.Number,
})
export type Model = typeof Model.Type

const pad = (value: number, length = 2) => String(value).padStart(length, "0")

/** `value` is `YYYY-MM-DD` for a date and `HH:MM` for a time; the date placeholder is today. */
export const init = (options: {
	readonly id: string
	readonly kind: Kind
	readonly value?: string
	readonly isDisabled?: boolean
	readonly isInvalid?: boolean
}): Model => {
	const now = new Date()
	const parts = options.value?.split(/[-:]/).map(Number) ?? []
	const [first, second, third] = parts
	const isTime = options.kind === "time"
	const hour24 = isTime && first !== undefined ? first : null
	const values: Values = {
		year: !isTime && first !== undefined ? first : null,
		month: !isTime && second !== undefined ? second : null,
		day: !isTime && third !== undefined ? third : null,
		hour: hour24 === null ? null : hour24 % 12 === 0 ? 12 : hour24 % 12,
		minute: isTime && second !== undefined ? second : null,
		dayPeriod: hour24 === null ? null : hour24 >= 12 ? 1 : 0,
	}
	const model: Model = {
		id: options.id,
		kind: options.kind,
		isDisabled: options.isDisabled ?? false,
		isInvalid: options.isInvalid ?? false,
		values,
		committed: null,
		placeholder: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate(), hour: 0 },
		enteredKeys: "",
		enteredSegment: null,
		activeSegment: null,
		pendingFocusMoves: 0,
	}
	return modifyFields(model, { committed: () => completeValue(model) })
}

// FORMATTING

const locale = () => (typeof navigator === "undefined" ? "en-US" : navigator.language)

const formatter = (kind: Kind) =>
	new Intl.DateTimeFormat(locale(), {
		...(kind === "date"
			? { year: "numeric", month: "numeric", day: "numeric" }
			: { hour: "numeric", minute: "2-digit" }),
		timeZone: "UTC",
	})

/** IncompleteDate.toValue: fill missing segments from the placeholder, then constrain the day. */
export const dateValueOf = (model: Model): Date => {
	const { values, placeholder } = model
	const year = values.year ?? placeholder.year
	const month = values.month ?? placeholder.month
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
	const day = Math.min(values.day ?? placeholder.day, daysInMonth)
	const hour =
		values.hour !== null
			? (values.hour % 12) + (values.dayPeriod === 1 ? 12 : 0)
			: values.dayPeriod === 1
				? 12
				: placeholder.hour
	const date = new Date(Date.UTC(2000, 0, 1, hour, values.minute ?? 0))
	date.setUTCFullYear(year, month - 1, day)
	return date
}

export const segmentOrder = (kind: Kind): ReadonlyArray<SegmentType> =>
	formatter(kind)
		.formatToParts(new Date(Date.UTC(2000, 0, 1)))
		.map((part) => part.type)
		.filter((type): type is SegmentType =>
			["year", "month", "day", "hour", "minute", "dayPeriod"].includes(type),
		)

/** useDateFieldState's getSegmentLimits: the day ends at the displayed month's length. */
export const segmentLimits = (model: Model, type: SegmentType) =>
	({
		year: { min: 1, max: 9999 },
		month: { min: 1, max: 12 },
		day: { min: 1, max: daysInDisplayedMonth(model) },
		hour: { min: 1, max: 12 },
		minute: { min: 0, max: 59 },
		dayPeriod: { min: 0, max: 1 },
	})[type]

const daysInDisplayedMonth = (model: Model) => {
	const year = model.values.year ?? model.placeholder.year
	const month = model.values.month ?? model.placeholder.month
	return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

const completeValue = (model: Model): string | null => {
	const isComplete = segmentOrder(model.kind).every((type) => model.values[type] !== null)
	if (!isComplete) return model.committed
	const date = dateValueOf(model)
	return model.kind === "date"
		? `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
		: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`
}

/** A rendered segment, editable or literal (React Aria's DateSegment). */
export interface Segment {
	readonly type: SegmentType | "literal"
	readonly text: string
	readonly isPlaceholder: boolean
	readonly value: number | null
	readonly valueText: string
}

/** React Aria's placeholders table, English entry (the app's locale). */
const datePlaceholders = { year: "yyyy", month: "mm", day: "dd" } as const

const literal = (text: string): Segment => ({
	type: "literal",
	text,
	isPlaceholder: false,
	value: null,
	valueText: "",
})

/**
 * useDateFieldState's processSegments: Intl parts, numbers formatted from the raw values, and the
 * time segments wrapped in left-to-right isolate characters.
 */
export const segmentsOf = (model: Model): ReadonlyArray<Segment> => {
	const date = dateValueOf(model)
	const monthName = new Intl.DateTimeFormat(locale(), { month: "long", timeZone: "UTC" }).format(date)
	const hourText = new Intl.DateTimeFormat(locale(), { hour: "numeric", timeZone: "UTC" }).format(date)
	return formatter(model.kind)
		.formatToParts(date)
		.flatMap((part): ReadonlyArray<Segment> => {
			if (part.type === "literal") return [literal(part.value)]
			if (!["year", "month", "day", "hour", "minute", "dayPeriod"].includes(part.type)) return []
			const type = part.type as SegmentType
			const value = model.values[type]
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
				? [literal("\u2066"), segment]
				: type === "minute"
					? [segment, literal("\u2069")]
					: [segment]
		})
}

// MESSAGE

export const Message = defineMessageUnion({
	PressedSegmentKey: { segment: Schema.String, key: Schema.String },
	CompletedFocusSegment: {},
	CompletedAnnounceValue: {},
})
export type Message = typeof Message.Type

// COMMAND

export const segmentId = (model: Model, type: SegmentType) => `${model.id}-${type}`

/**
 * React Aria moves focus inside the key handler; here the move runs after update, so a fast keystroke
 * can still reach the old segment. `update` routes it to `activeSegment` until the move completes.
 */
export const FocusSegment = Command.define("FocusSegment", {
	args: { elementId: Schema.String },
	messages: [Message.CompletedFocusSegment],
	execute: ({ elementId }) =>
		Effect.sync(() => {
			document.getElementById(elementId)?.focus()
			return Message.CompletedFocusSegment()
		}),
})

/** useSpinButton: a focused segment clears the assertive log and announces its new value text. */
export const AnnounceValue = Command.define("AnnounceSegmentValue", {
	args: { valueText: Schema.String },
	messages: [Message.CompletedAnnounceValue],
	execute: ({ valueText }) =>
		Effect.sync(() => {
			clearAssertive()
			announce(valueText)
			return Message.CompletedAnnounceValue()
		}),
})

// UPDATE

const PAGE_STEP: Record<SegmentType, number> = {
	year: 5,
	month: 2,
	day: 7,
	hour: 2,
	minute: 15,
	dayPeriod: 1,
}

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

const withValues = (model: Model, values: Partial<Values>): Model => {
	const next = modifyFields(model, { values: (current) => ({ ...current, ...values }) })
	return modifyFields(next, { committed: () => completeValue(next) })
}

/** IncompleteDate.set: setting the hour fills the day period from the placeholder. */
const setSegment = (model: Model, type: SegmentType, value: number): Model =>
	withValues(model, {
		[type]: value,
		...(type === "hour" && model.values.dayPeriod === null
			? { dayPeriod: model.placeholder.hour >= 12 ? 1 : 0 }
			: {}),
	})

const cycle = (model: Model, type: SegmentType, amount: number): Model => {
	const current = model.values[type]
	const { min, max } = segmentLimits(model, type)
	if (current === null && type !== "dayPeriod") {
		const placeholder = dateValueOf({
			...model,
			values: { ...model.values, hour: null, dayPeriod: null },
		})
		return type === "hour"
			? setSegment(
					model,
					"hour",
					placeholder.getUTCHours() % 12 === 0 ? 12 : placeholder.getUTCHours() % 12,
				)
			: type === "minute"
				? withValues(model, { minute: 0 })
				: withValues(model, { [type]: model.placeholder[type as "year" | "month" | "day"] })
	}
	const base = current ?? 0
	const next =
		type === "minute" ? cycleValue(base, amount, min, max, true) : cycleValue(base, amount, min, max)
	return type === "hour" ? setSegment(model, type, next) : withValues(model, { [type]: next })
}

const neighbour = (model: Model, type: SegmentType, offset: number) => {
	const order = segmentOrder(model.kind)
	return order[order.indexOf(type) + offset]
}

const focusNeighbour = (model: Model, type: SegmentType, offset: number): Update.Return<Model, Message> => {
	const target = neighbour(model, type, offset)
	return target === undefined
		? { model }
		: { model, commands: [FocusSegment({ elementId: segmentId(model, target) })] }
}

/** useDateSegment's onInput for numeric segments and the day period. */
const typed = (model: Model, type: SegmentType, key: string): Update.Return<Model, Message> => {
	if (type === "dayPeriod") {
		const lower = key.toLowerCase()
		const period = lower === "a" ? 0 : lower === "p" ? 1 : null
		return period === null ? { model } : focusNeighbour(withValues(model, { dayPeriod: period }), type, 1)
	}
	const entered = (model.enteredSegment === type ? model.enteredKeys : "") + key
	if (!/^\d+$/.test(entered)) return { model }
	const { max } = segmentLimits(model, type)
	const numberValue = Number(entered)
	const segmentValue = numberValue > max ? Number(key) : numberValue
	const next = setSegment(model, type, segmentValue)
	const isDone = Number(`${numberValue}0`) > max || entered.length >= String(max).length
	return isDone
		? focusNeighbour(modifyFields(next, { enteredKeys: () => "", enteredSegment: () => null }), type, 1)
		: { model: modifyFields(next, { enteredKeys: () => entered, enteredSegment: () => type }) }
}

/** useDateSegment's backspace: drop the last digit, or clear. */
const backspace = (model: Model, type: SegmentType): Update.Return<Model, Message> => {
	const segment = segmentsOf(model).find((candidate) => candidate.type === type)
	const text = segment?.text ?? ""
	const isPlaceholder = segment?.isPlaceholder ?? true
	const moved = isPlaceholder ? focusNeighbour(model, type, -1) : { model }
	if (/^\d+$/.test(text) && !isPlaceholder) {
		const shorter = text.slice(0, -1)
		const parsed = Number(shorter)
		const cleared = shorter.length === 0 || parsed === 0
		const next = cleared ? withValues(model, { [type]: null }) : setSegment(model, type, parsed)
		return {
			...moved,
			model: modifyFields(next, {
				enteredKeys: () => (cleared ? "" : shorter),
				enteredSegment: () => type,
			}),
		}
	}
	return type === "dayPeriod" ? { ...moved, model: withValues(model, { dayPeriod: null }) } : moved
}

const keyActions: Record<string, (model: Model, type: SegmentType) => Update.Return<Model, Message>> = {
	ArrowUp: (model, type) => ({ model: cycle(model, type, 1) }),
	ArrowDown: (model, type) => ({ model: cycle(model, type, -1) }),
	PageUp: (model, type) => ({ model: cycle(model, type, PAGE_STEP[type]) }),
	PageDown: (model, type) => ({ model: cycle(model, type, -PAGE_STEP[type]) }),
	Home: (model, type) => ({ model: setSegment(model, type, segmentLimits(model, type).min) }),
	End: (model, type) => ({ model: setSegment(model, type, segmentLimits(model, type).max) }),
	ArrowLeft: (model, type) => focusNeighbour(model, type, -1),
	ArrowRight: (model, type) => focusNeighbour(model, type, 1),
	Backspace: (model, type) => backspace(model, type),
	Delete: (model, type) => backspace(model, type),
}

/** Keys a segment handles (and prevents): spin and navigation keys, plus printable characters. */
export const isSegmentKey = (key: string) => key in keyActions || key.length === 1

const valueTextOf = (model: Model, type: SegmentType) =>
	segmentsOf(model).find((segment) => segment.type === type)?.valueText

const focusMovesOf = (result: Update.Return<Model, Message>) =>
	(result.commands ?? []).filter((command) => command.name === FocusSegment.name)

/** The segment holding focus after an update: a FocusSegment target, else the pressed one. */
const focusedAfter = (model: Model, pressed: SegmentType, result: Update.Return<Model, Message>) => {
	const target = focusMovesOf(result).at(-1)?.args?.elementId
	return segmentOrder(model.kind).find((type) => segmentId(model, type) === target) ?? pressed
}

/**
 * A keystroke names the segment that had DOM focus. While a commanded focus move is pending that is
 * the segment focus is leaving, so the keystroke goes to `activeSegment` instead.
 */
const keySegment = (model: Model, pressed: string): SegmentType | undefined => {
	const name = model.pendingFocusMoves > 0 && model.activeSegment !== null ? model.activeSegment : pressed
	return segmentOrder(model.kind).find((type) => type === name)
}

export const update = (model: Model, message: Message): Update.Return<Model, Message> => {
	if (message._tag === "CompletedFocusSegment")
		return { model: modifyFields(model, { pendingFocusMoves: (count) => Math.max(0, count - 1) }) }
	if (message._tag !== "PressedSegmentKey") return updateSegments(model, message)
	const pressed = keySegment(model, message.segment)
	if (pressed === undefined) return { model }
	const result = updateSegments(model, Message.PressedSegmentKey({ segment: pressed, key: message.key }))
	const focused = focusedAfter(model, pressed, result)
	const moves = focusMovesOf(result).length
	const next = modifyFields(result.model, {
		activeSegment: () => focused,
		pendingFocusMoves: (count) => count + moves,
	})
	const valueText = valueTextOf(next, focused)
	return valueText === undefined || valueText === valueTextOf(model, focused)
		? { ...result, model: next }
		: { ...result, model: next, commands: [...(result.commands ?? []), AnnounceValue({ valueText })] }
}

const updateSegments = (model: Model, message: Message): Update.Return<Model, Message> =>
	Message.match<Update.Return<Model, Message>>(message, {
		PressedSegmentKey: ({ segment, key }) => {
			const type = segment as SegmentType
			const action = keyActions[key]
			// Spinning and moving reset the typed digits (useSpinButton callbacks, segment focus).
			return action === undefined
				? typed(model, type, key)
				: action(
						key === "Backspace" || key === "Delete"
							? model
							: modifyFields(model, { enteredKeys: () => "" }),
						type,
					)
		},
		CompletedFocusSegment: () => ({ model }),
		CompletedAnnounceValue: () => ({ model }),
	})
