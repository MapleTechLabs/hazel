import { Array, Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
	calendarCellClassName,
	calendarHeaderCellClassName,
	calendarHeaderClassName,
	calendarMonthSelectTriggerClassName,
	calendarNavButtonClassName,
	calendarYearSelectTriggerClassName,
	rangeCalendarCellClassName,
	rangeCalendarCellInnerClassName,
	rangeCalendarGridClassName,
	rangeCalendarGridsClassName,
} from "~/components/ui/calendar.styles"
import * as Interaction from "./aria/interaction"
import { button } from "./button"
import {
	cellTarget,
	gridId,
	highlightedRange,
	isCellDisabled,
	isOutsideMonth,
	isPreviousDisabled,
	Message,
	type Model,
} from "./calendar"
import * as D from "./calendar-date"
import { view as selectView } from "./select-view"

/** Calendar and RangeCalendar markup, React Aria's DOM included. */

const visuallyHidden =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

/** Heroicons 24/solid chevrons, as the legacy header renders them. */
const chevron = (h: HtmlBuilder<Message>, d: string): Html =>
	h.svg(
		[
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("fill", "currentColor"),
			h.Attribute("aria-hidden", "true"),
			h.Attribute("data-slot", "icon"),
		],
		[
			h.path([
				h.Attribute("fill-rule", "evenodd"),
				h.Attribute("d", d),
				h.Attribute("clip-rule", "evenodd"),
			]),
		],
	)

const chevronLeft =
	"M7.72 12.53a.75.75 0 0 1 0-1.06l7.5-7.5a.75.75 0 1 1 1.06 1.06L9.31 12l6.97 6.97a.75.75 0 1 1-1.06 1.06l-7.5-7.5Z"
const chevronRight =
	"M16.28 11.47a.75.75 0 0 1 0 1.06l-7.5 7.5a.75.75 0 0 1-1.06-1.06L14.69 12 7.72 5.03a.75.75 0 0 1 1.06-1.06l7.5 7.5Z"

/** Without `ariaLabel` (inside a DatePicker) the calendar is named by its visible month alone. */
export type ViewInputs = Readonly<{ ariaLabel?: string }>

const header = (h: HtmlBuilder<Message>, model: Model, monthYear: string): Html => {
	const wiring: Interaction.Wiring<Message> = {
		model: model.interaction,
		toParentMessage: (message) => Message.GotInteractionMessage({ message }),
	}
	const pageButton = (label: "Previous" | "Next", isDisabled: boolean, onPress: Message, d: string) =>
		button(
			h,
			{
				size: "sq-sm",
				isCircle: true,
				intent: "plain",
				className: calendarNavButtonClassName,
				isDisabled,
				onPress,
				interaction: { wiring, target: label },
				attributes: [h.AriaLabel(label), h.Attribute("slot", label.toLowerCase())],
			},
			[chevron(h, d)],
		)
	return h.header(
		[h.Class(calendarHeaderClassName()), h.Attribute("data-slot", "calendar-header")],
		[
			h.div(
				[h.Class("flex items-center gap-1.5")],
				[
					h.submodel({
						slotId: "month",
						model: model.month,
						view: selectView,
						viewInputs: {
							ariaLabel: "Month",
							className: "[popover-width:8rem]",
							style: "flex: 1 1 0%; width: fit-content;",
							triggerClassName: calendarMonthSelectTriggerClassName,
							listBoxClassName: "min-w-0",
							isHiddenOptionTextless: true,
						},
						toParentMessage: (message) => Message.GotMonthMessage({ message }),
					}),
					h.submodel({
						slotId: "year",
						model: model.year,
						view: selectView,
						viewInputs: {
							ariaLabel: "Year",
							triggerClassName: calendarYearSelectTriggerClassName,
							isHiddenOptionTextless: true,
						},
						toParentMessage: (message) => Message.GotYearMessage({ message }),
					}),
				],
			),
			h.h2([h.AriaHidden(true), h.Class("sr-only")], [monthYear]),
			h.div(
				[h.Class("flex items-center gap-1")],
				[
					pageButton("Previous", isPreviousDisabled(model), Message.ClickedPrevious(), chevronLeft),
					pageButton("Next", false, Message.ClickedNext(), chevronRight),
				],
			),
		],
	)
}

const cellLabel = (model: Model, date: D.CalendarDate, isSelected: boolean, isEdge: boolean) => {
	const base = `${date === model.today ? "Today, " : ""}${D.formatFull(date)}`
	const range = model.mode === "Range" && Option.isNone(model.anchor) ? model.range : Option.none()
	const withRange = Option.match(range, {
		onNone: () => base,
		onSome: ({ start, end }) =>
			isSelected && isEdge ? `Selected Range: ${D.formatRange(start, end)}, ${base}` : base,
	})
	return isSelected ? `${withRange} selected` : withRange
}

const cell = (h: HtmlBuilder<Message>, model: Model, date: D.CalendarDate): Html => {
	const isDisabled = isCellDisabled(model, date)
	const isOutside = isOutsideMonth(model, date)
	const highlighted = model.mode === "Range" ? highlightedRange(model) : Option.none()
	const isSelected =
		!isOutside &&
		(model.mode === "Single"
			? Option.contains(model.value, date)
			: Option.exists(
					highlighted,
					({ start, end }) => D.compare(start, date) <= 0 && D.compare(date, end) <= 0,
				))
	const isStart = isSelected && Option.exists(highlighted, ({ start }) => start === date)
	const isEnd = isSelected && Option.exists(highlighted, ({ end }) => end === date)
	const isToday = date === model.today
	const target = cellTarget(date)
	const state = isDisabled ? Interaction.idleState : Interaction.stateOf(model.interaction, target)
	const wiring: Interaction.Wiring<Message> = {
		model: model.interaction,
		toParentMessage: (message) => Message.GotInteractionMessage({ message }),
	}
	const flag = (name: string, isOn: boolean) => (isOn ? [h.Attribute(name, "true")] : [])
	const className =
		model.mode === "Single"
			? calendarCellClassName({ isSelected, isDisabled, isToday }, undefined)
			: rangeCalendarCellClassName(isToday)
	return h.td(
		[...flag("aria-disabled", isDisabled), ...flag("aria-selected", isSelected), h.Role("gridcell")],
		[
			h.div(
				[
					...flag("aria-disabled", isDisabled),
					h.AriaLabel(cellLabel(model, date, isSelected, isStart || isEnd)),
					h.Class(className),
					...flag("data-disabled", isDisabled),
					...flag("data-outside-month", isOutside),
					...flag("data-outside-visible-range", isOutside),
					h.Attribute("data-rac", ""),
					h.Attribute("data-react-aria-pressable", "true"),
					...flag("data-selected", isSelected),
					...flag("data-selection-end", isEnd),
					...flag("data-selection-start", isStart),
					...flag("data-today", isToday),
					...Interaction.stateAttributes(h, state),
					h.Role("button"),
					...(isDisabled
						? []
						: [
								h.Attribute("tabindex", date === model.focusedDate ? "0" : "-1"),
								...Interaction.handlers(h, wiring, target),
								h.OnClick(Message.ClickedCell({ date })),
							]),
				],
				[
					model.mode === "Single"
						? D.formatDay(date)
						: h.span(
								[
									h.Class(
										rangeCalendarCellInnerClassName({
											isSelected,
											isSelectionEdge: isStart || isEnd,
											isDisabled,
										}),
									),
								],
								[D.formatDay(date)],
							),
				],
			),
		],
	)
}

const grid = (h: HtmlBuilder<Message>, model: Model, label: string): Html =>
	h.table(
		[
			h.AriaLabel(label),
			...(model.mode === "Range" ? [h.Attribute("aria-multiselectable", "true")] : []),
			h.Attribute("cellpadding", "0"),
			h.Class(model.mode === "Single" ? "react-aria-CalendarGrid" : rangeCalendarGridClassName),
			h.Id(gridId(model.id)),
			h.Role("grid"),
			h.OnKeyDownPreventDefault((key) =>
				key === "Tab" ? Option.none() : Option.some(Message.PressedGridKey({ key })),
			),
		],
		[
			h.thead(
				[h.AriaHidden(true), h.Class("react-aria-CalendarGridHeader")],
				[
					h.tr(
						[],
						Array.map(D.weekdayNames(), (name) =>
							h.th([h.Class(calendarHeaderCellClassName)], [name]),
						),
					),
				],
			),
			h.tbody(
				[h.Class(model.mode === "Single" ? "react-aria-CalendarGridBody" : "snap-start")],
				Array.map(D.monthWeeks(model.focusedDate), (week) =>
					h.tr(
						[],
						Array.map(week, (date) => cell(h, model, date)),
					),
				),
			),
		],
	)

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const monthYear = D.formatMonthYear(model.focusedDate)
	const label = viewInputs.ariaLabel === undefined ? monthYear : `${viewInputs.ariaLabel}, ${monthYear}`
	return h.div(
		[
			h.AriaLabel(label),
			h.Class(model.mode === "Single" ? "react-aria-Calendar" : "react-aria-RangeCalendar"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-slot", "calendar"),
			h.Id(model.id),
			h.Role("application"),
		],
		[
			h.div([h.Attribute("style", visuallyHidden)], [h.h2([], [label])]),
			header(h, model, monthYear),
			model.mode === "Single"
				? grid(h, model, label)
				: h.div([h.Class(rangeCalendarGridsClassName)], [grid(h, model, label)]),
			h.div(
				[h.Attribute("style", visuallyHidden)],
				[h.button([h.AriaLabel("Next"), h.Tabindex(-1), h.OnClick(Message.ClickedNext())], [])],
			),
		],
	)
})
