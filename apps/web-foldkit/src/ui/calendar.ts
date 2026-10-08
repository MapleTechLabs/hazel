import { Array, Effect, Option, Schema } from "effect"
import { Command, Mount, Subscription, type Update } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { announce } from "./aria/announcer"
import * as Interaction from "./aria/interaction"
import * as D from "./calendar-date"
import * as Select from "./select"

/**
 * Port of `components/ui/calendar.tsx` and `range-calendar.tsx` (React Aria Calendar and
 * RangeCalendar, one month): selection, keyboard navigation, the month and year Selects and the
 * page buttons. Hover, press and focus-visible come from an embedded interaction Submodel.
 * The views live in `calendar-view.ts`.
 */

// MODEL

const Range = Schema.Struct({ start: Schema.String, end: Schema.String })

export const Model = Schema.Struct({
	id: Schema.String,
	mode: Schema.Literals(["Single", "Range"]),
	today: Schema.String,
	focusedDate: Schema.String,
	value: Schema.Option(Schema.String),
	range: Schema.Option(Range),
	/** The first click of a range selection, until the second one completes it. */
	anchor: Schema.Option(Schema.String),
	minValue: Schema.Option(Schema.String),
	month: Select.Model,
	year: Select.Model,
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

const YEAR_SPAN = 20

const monthSelect = (id: string, focusedDate: D.CalendarDate) =>
	Select.init({
		id: `${id}-month`,
		items: Array.makeBy(12, (index) =>
			Select.item(
				String(index + 1),
				D.formatShortMonth(D.withMonth(focusedDate, D.parts(focusedDate).year, index + 1)),
			),
		),
		selectedKey: String(D.parts(focusedDate).month),
	})

const yearSelect = (id: string, focusedDate: D.CalendarDate) =>
	Select.init({
		id: `${id}-year`,
		items: Array.makeBy(YEAR_SPAN * 2 + 1, (index) =>
			Select.item(String(index), D.formatYear(D.addYears(focusedDate, index - YEAR_SPAN))),
		),
		selectedKey: String(YEAR_SPAN),
	})

export const init = (config: {
	readonly id: string
	readonly today: D.CalendarDate
	readonly mode?: "Single" | "Range"
	readonly value?: D.CalendarDate
	readonly range?: { readonly start: D.CalendarDate; readonly end: D.CalendarDate }
	readonly minValue?: D.CalendarDate
}): Model => {
	const focusedDate = config.value ?? config.range?.start ?? config.today
	return {
		id: config.id,
		mode: config.mode ?? "Single",
		today: config.today,
		focusedDate,
		value: Option.fromNullishOr(config.value),
		range: Option.fromNullishOr(config.range),
		anchor: Option.none(),
		minValue: Option.fromNullishOr(config.minValue),
		month: monthSelect(config.id, focusedDate),
		year: yearSelect(config.id, focusedDate),
		interaction: Interaction.init(),
	}
}

// QUERIES

export const isBeforeMin = (model: Model, date: D.CalendarDate) =>
	Option.exists(model.minValue, (min) => D.compare(date, min) < 0)

export const isOutsideMonth = (model: Model, date: D.CalendarDate) => !D.isSameMonth(date, model.focusedDate)

export const isCellDisabled = (model: Model, date: D.CalendarDate) =>
	isOutsideMonth(model, date) || isBeforeMin(model, date)

/** The highlighted range: the committed one, or the anchor up to the hovered or focused day. */
export const highlightedRange = (model: Model): Option.Option<{ start: string; end: string }> =>
	Option.match(model.anchor, {
		onNone: () => model.range,
		onSome: (anchor) => {
			const other = Option.getOrElse(hoveredDate(model), () => model.focusedDate)
			return Option.some(
				D.compare(anchor, other) <= 0 ? { start: anchor, end: other } : { start: other, end: anchor },
			)
		},
	})

export const cellTarget = (date: D.CalendarDate) => `cell-${date}`

const hoveredDate = (model: Model): Option.Option<string> =>
	Option.map(
		Array.findFirst(model.interaction.hovered, (target) => target.startsWith("cell-")),
		(target) => target.slice("cell-".length),
	)

export const isPreviousDisabled = (model: Model) =>
	isBeforeMin(model, D.addDays(D.startOfMonth(model.focusedDate), -1))

/** useSelectedDateDescription: the committed date or range, "" while a range is being picked. */
export const selectedDateDescription = (model: Model): string =>
	model.mode === "Single"
		? Option.match(model.value, {
				onNone: () => "",
				onSome: (date) => `Selected Date: ${D.formatFull(date)}`,
			})
		: Option.isSome(model.anchor)
			? ""
			: Option.match(model.range, {
					onNone: () => "",
					onSome: ({ start, end }) =>
						start === end
							? `Selected Date: ${D.formatFull(start)}`
							: `Selected Range: ${D.formatRange(start, end)}`,
				})

// IDS

export const gridId = (id: string) => `${id}-grid`

// MESSAGE

export const Message = defineMessageUnion({
	ClickedCell: { date: Schema.String },
	PressedGridKey: { key: Schema.String },
	ClickedPrevious: {},
	ClickedNext: {},
	GotMonthMessage: { message: Select.Message },
	GotYearMessage: { message: Select.Message },
	GotInteractionMessage: { message: Interaction.Message },
	CompletedFocusCell: {},
	CompletedAnnounce: {},
	CompletedFocusCellOnPress: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
	ChangedValue: { date: Schema.String },
	ChangedRange: { start: Schema.String, end: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// COMMAND

/** React Aria's live announcer, from useCalendarBase. */
export const Announce = Command.define("AnnounceCalendar", {
	args: {
		message: Schema.String,
		timeout: Schema.Number,
		assertiveness: Schema.Literals(["assertive", "polite"]),
	},
	messages: [Message.CompletedAnnounce],
	execute: ({ message, timeout, assertiveness }) =>
		Effect.sync(() => announce(message, timeout, assertiveness)).pipe(
			Effect.as(Message.CompletedAnnounce()),
		),
})

const MINIMUM_DATE_SUFFIX = ", First available date"

/** Focuses a day cell after the next render, which may show a different month. */
export const FocusCell = Command.define("FocusCalendarCell", {
	args: { gridId: Schema.String, label: Schema.String },
	messages: [Message.CompletedFocusCell],
	execute: ({ gridId: grid, label }) =>
		Effect.promise(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))).pipe(
			// A cell's name ends with its full date, then " selected", then the minimum date suffix.
			Effect.andThen(
				Dom.focus(
					[label, `${label} selected`]
						.flatMap((name) => [name, `${name}${MINIMUM_DATE_SUFFIX}`])
						.map((suffix) => `#${CSS.escape(grid)} [role=button][aria-label$="${suffix}"]`)
						.join(", "),
					{ preventScroll: true },
				),
			),
			Effect.ignore,
			Effect.as(Message.CompletedFocusCell()),
		),
})

// MOUNT

/**
 * A RangeCalendar day is focused by script when pressed (useCalendarCell's onPressStart, or
 * preventFocus then onPressUp), never by the mouse, so Chrome gives it `:focus-visible`.
 */
export const FocusCellOnPress = Mount.define("FocusCalendarCellOnPress", {
	messages: [Message.CompletedFocusCellOnPress],
	execute: ({ element }) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const onPointerDown = (event: Event) => {
					if (
						!(event instanceof PointerEvent) ||
						event.button !== 0 ||
						event.pointerType === "touch"
					)
						return
					const cell =
						event.target instanceof Element
							? event.target.closest("[role=button][tabindex]")
							: null
					if (cell instanceof HTMLElement && element.contains(cell))
						cell.focus({ preventScroll: true })
				}
				element.addEventListener("pointerdown", onPointerDown)
				return () => element.removeEventListener("pointerdown", onPointerDown)
			}),
			(release) => Effect.sync(release),
		).pipe(Effect.as(Message.CompletedFocusCellOnPress())),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

/** Moves the focused date, rebuilding the header Selects around it as React Aria re-renders them. */
const withFocusedDate = (model: Model, focusedDate: D.CalendarDate): Model =>
	modifyFields(model, {
		focusedDate: () => focusedDate,
		month: (month) => ({
			...monthSelect(model.id, focusedDate),
			popup: month.popup,
			isTriggerFocused: month.isTriggerFocused,
		}),
		year: (year) => ({
			...yearSelect(model.id, focusedDate),
			popup: year.popup,
			isTriggerFocused: year.isTriggerFocused,
		}),
	})

/** A picker reopening its calendar: the value, focused (or today when empty). */
export const showValue = (model: Model, value: Option.Option<D.CalendarDate>): Model =>
	modifyFields(
		withFocusedDate(
			model,
			Option.getOrElse(value, () => model.today),
		),
		{
			value: () => value,
		},
	)

const focusDate = (model: Model, date: D.CalendarDate): UpdateReturn => {
	const clamped = Option.match(model.minValue, {
		onNone: () => date,
		onSome: (min) => (D.compare(date, min) < 0 ? min : date),
	})
	return {
		model: withFocusedDate(model, clamped),
		commands: [FocusCell({ gridId: gridId(model.id), label: D.formatFull(clamped) })],
	}
}

const selectDate = (model: Model, date: D.CalendarDate): UpdateReturn => {
	if (isBeforeMin(model, date)) return { model }
	if (model.mode === "Single")
		return {
			model: modifyFields(withFocusedDate(model, date), { value: () => Option.some(date) }),
			outMessage: OutMessage.ChangedValue({ date }),
		}
	return Option.match(model.anchor, {
		onNone: () => ({
			model: modifyFields(withFocusedDate(model, date), { anchor: () => Option.some(date) }),
		}),
		onSome: (anchor) => {
			const range =
				D.compare(anchor, date) <= 0 ? { start: anchor, end: date } : { start: date, end: anchor }
			return {
				model: modifyFields(withFocusedDate(model, date), {
					anchor: () => Option.none(),
					range: () => Option.some(range),
				}),
				outMessage: OutMessage.ChangedRange(range),
			}
		},
	})
}

const keyOffsets: Readonly<Record<string, (date: D.CalendarDate) => D.CalendarDate>> = {
	ArrowRight: (date) => D.addDays(date, 1),
	ArrowLeft: (date) => D.addDays(date, -1),
	ArrowDown: (date) => D.addDays(date, 7),
	ArrowUp: (date) => D.addDays(date, -7),
	PageDown: (date) => D.addMonths(date, 1),
	PageUp: (date) => D.addMonths(date, -1),
	Home: (date) => D.addDays(date, -D.toDate(date).getUTCDay()),
	End: (date) => D.addDays(date, 6 - D.toDate(date).getUTCDay()),
}

const foldSelect = (model: Model, slot: "month" | "year", message: Select.Message): UpdateReturn => {
	const result = Select.update(model[slot], message)
	const toMessage = (child: Select.Message) =>
		slot === "month"
			? Message.GotMonthMessage({ message: child })
			: Message.GotYearMessage({ message: child })
	const next = modifyFields(model, { [slot]: () => result.model } as { month: () => Select.Model })
	const commands = Command.mapMessages(result.commands, toMessage)
	if (result.outMessage === undefined) return { model: next, commands }
	const key = Number(result.outMessage.key)
	const { year } = D.parts(model.focusedDate)
	const focusedDate =
		slot === "month"
			? D.withMonth(model.focusedDate, year, key)
			: D.addYears(model.focusedDate, key - YEAR_SPAN)
	return { model: withFocusedDate(next, focusedDate), commands }
}

/** The announcement timeouts useCalendarBase passes: the visible month 7 s, the selection 4 s. */
const VISIBLE_RANGE_TIMEOUT = 7000
const SELECTION_TIMEOUT = 4000

/**
 * useCalendarBase's announcements: a new visible month while the grid is not focused (the page
 * buttons and month/year pickers, not arrow keys), and every new selection description.
 */
const announcementsFor = (previous: Model, next: Model, message: Message) => {
	const month = D.formatMonthYear(next.focusedDate)
	const isMonthAnnounced =
		message._tag !== "PressedGridKey" &&
		message._tag !== "ClickedCell" &&
		month !== D.formatMonthYear(previous.focusedDate)
	const selection = selectedDateDescription(next)
	const isSelectionAnnounced = selection !== "" && selection !== selectedDateDescription(previous)
	return [
		...(isMonthAnnounced
			? [Announce({ message: month, timeout: VISIBLE_RANGE_TIMEOUT, assertiveness: "assertive" })]
			: []),
		...(isSelectionAnnounced
			? [Announce({ message: selection, timeout: SELECTION_TIMEOUT, assertiveness: "polite" })]
			: []),
	]
}

export const update = (model: Model, message: Message): UpdateReturn => {
	const result = updateCalendar(model, message)
	const announcements = announcementsFor(model, result.model, message)
	return announcements.length === 0
		? result
		: { ...result, commands: [...(result.commands ?? []), ...announcements] }
}

const updateCalendar = (model: Model, message: Message): UpdateReturn =>
	Message.match<UpdateReturn>(message, {
		ClickedCell: ({ date }) => (isCellDisabled(model, date) ? { model } : selectDate(model, date)),
		PressedGridKey: ({ key }) => {
			if (key === "Enter" || key === " ") return selectDate(model, model.focusedDate)
			const offset = keyOffsets[key]
			return offset === undefined ? { model } : focusDate(model, offset(model.focusedDate))
		},
		ClickedPrevious: () => ({ model: withFocusedDate(model, D.addMonths(model.focusedDate, -1)) }),
		ClickedNext: () => ({ model: withFocusedDate(model, D.addMonths(model.focusedDate, 1)) }),
		GotMonthMessage: ({ message }) => foldSelect(model, "month", message),
		GotYearMessage: ({ message }) => foldSelect(model, "year", message),
		GotInteractionMessage: ({ message }) => ({
			model: modifyFields(model, {
				interaction: () => Interaction.update(model.interaction, message).model,
			}),
		}),
		CompletedFocusCell: () => ({ model }),
		CompletedAnnounce: () => ({ model }),
		CompletedFocusCellOnPress: () => ({ model }),
	})

// SUBSCRIPTION

export const subscriptions = Subscription.lift(Interaction.subscriptions)<Model, Message>({
	read: (model) => Option.some(model.interaction),
	toParentMessage: (message) => Message.GotInteractionMessage({ message }),
})
