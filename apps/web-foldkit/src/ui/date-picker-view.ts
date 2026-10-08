import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { dateInputControlStyles, dateInputStyles } from "~/components/ui/date-field.styles"
import {
	datePickerGroupClassName,
	datePickerOverlayClassName,
	datePickerTriggerClassName,
} from "~/components/ui/date-picker.styles"
import { fieldStyles } from "~/components/ui/field.styles"
import { popoverContentBase, popoverInnerClassName } from "~/components/ui/popover.styles"
import * as Interaction from "./aria/interaction"
import { dismissButton } from "./aria/overlay"
import * as Calendar from "./calendar"
import { view as calendarView } from "./calendar-view"
import { dateSegments, hiddenInputStyle, selectedDescription } from "./date-field"
import {
	descriptionId,
	groupId,
	labelId,
	Message,
	type Model,
	PortalPicker,
	popoverId,
	triggerId,
} from "./date-picker"
import * as Field from "./field"
import { inputGroup } from "./input"

/** DatePicker + DatePickerTrigger markup, React Aria's DOM included. */

const calendarDaysPath =
	"M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z"

/** Heroicons 24/outline CalendarDaysIcon. */
const calendarDaysIcon = (h: HtmlBuilder<Message>): Html =>
	h.svg(
		[
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
			h.Attribute("fill", "none"),
			h.Attribute("viewBox", "0 0 24 24"),
			h.Attribute("stroke-width", "1.5"),
			h.Attribute("stroke", "currentColor"),
			h.Attribute("aria-hidden", "true"),
			h.Attribute("data-slot", "icon"),
		],
		[
			h.path([
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
				h.Attribute("d", calendarDaysPath),
			]),
		],
	)

export type ViewInputs = Readonly<{
	/** A visible `Label`, or an `aria-label` on the picker. */
	label?: string
	ariaLabel?: string
	className?: string
}>

const overlay = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Attribute("style", "display: contents;"), h.OnMount(PortalPicker({ id: model.id }))],
		[
			h.span([
				h.Attribute("data-focus-scope-start", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
			h.div([
				h.Attribute("inert", ""),
				h.Attribute("data-testid", "underlay"),
				h.Attribute("style", "position: fixed; inset: 0px;"),
			]),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							h.Class(twMerge(twMerge(...popoverContentBase), datePickerOverlayClassName(1))),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-trigger", "DatePicker"),
							h.Attribute("dir", "ltr"),
							h.Id(popoverId(model.id)),
							h.Role("dialog"),
							h.Attribute("tabindex", "-1"),
							h.OnKeyDownPreventDefault((key) =>
								key === "Escape" ? Option.some(Message.PressedEscape()) : Option.none(),
							),
						],
						[
							dismissButton(h, Message.ClickedDismiss()),
							h.div(
								[h.Attribute("data-slot", "popover-inner"), h.Class(popoverInnerClassName)],
								[
									h.submodel({
										slotId: "calendar",
										model: model.calendar,
										view: calendarView,
										viewInputs: {},
										toParentMessage: (message: Calendar.Message) =>
											Message.GotCalendarMessage({ message }),
									}),
								],
							),
							dismissButton(h, Message.ClickedDismiss()),
						],
					),
				],
			),
			h.span([
				h.Attribute("data-focus-scope-end", "true"),
				h.Attribute("hidden", ""),
				h.Attribute("inert", ""),
			]),
		],
	)

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, viewInputs, h) => {
	const wiring: Interaction.Wiring<Message> = {
		model: model.calendar.interaction,
		toParentMessage: (message) =>
			Message.GotCalendarMessage({ message: Calendar.Message.GotInteractionMessage({ message }) }),
	}
	const segments = model.segments
	const selected = selectedDescription(segments)
	const describedBy = selected === null ? undefined : descriptionId(model.id)
	// Without a visible Label, React Aria names the group (and the trigger) by the group itself.
	const isLabelled = viewInputs.ariaLabel === undefined && viewInputs.label !== undefined
	const nameRef = isLabelled ? labelId(model.id) : groupId(model.id)
	const nameAttributes = [
		...(viewInputs.ariaLabel === undefined ? [] : [h.AriaLabel(viewInputs.ariaLabel)]),
		h.AriaLabelledBy(nameRef),
	]
	const rootTarget = `${model.id}-root`
	const triggerTarget = triggerId(model.id)
	const trigger = h.button(
		[
			...(describedBy === undefined ? [] : [h.AriaDescribedBy(describedBy)]),
			h.Attribute("aria-expanded", model.isOpen ? "true" : "false"),
			h.Attribute("aria-haspopup", "dialog"),
			h.AriaLabel("Calendar"),
			h.AriaLabelledBy(`${triggerId(model.id)} ${nameRef}`),
			h.Class(datePickerTriggerClassName),
			h.DataAttribute("rac", ""),
			h.DataAttribute("react-aria-pressable", "true"),
			h.DataAttribute("slot", "date-picker-trigger"),
			h.Id(triggerId(model.id)),
			h.Tabindex(0),
			h.Type("button"),
			...Interaction.handlers(h, wiring, triggerTarget),
			...Interaction.stateAttributes(h, {
				...Interaction.stateOf(wiring.model, triggerTarget),
				isPressed: model.isOpen || Interaction.stateOf(wiring.model, triggerTarget).isPressed,
			}),
			...Interaction.pressStyleAttributes(h, wiring.model, triggerTarget),
			h.OnClick(Message.ClickedTrigger()),
		],
		[calendarDaysIcon(h)],
	)
	const group = inputGroup(
		h,
		{
			className: datePickerGroupClassName,
			interaction: { wiring, target: groupId(model.id) },
			attributes: [
				...(describedBy === undefined ? [] : [h.AriaDescribedBy(describedBy)]),
				...nameAttributes,
				h.DataAttribute("react-aria-pressable", "true"),
				h.Id(groupId(model.id)),
			],
		},
		[
			h.span(
				[h.DataAttribute("slot", "control"), h.Class(dateInputControlStyles)],
				[
					h.div(
						[
							h.Class(twMerge(twMerge(...dateInputStyles), undefined)),
							h.DataAttribute("rac", ""),
							h.DataAttribute("react-aria-pressable", "true"),
							h.Id(`${model.id}-input`),
							h.Role("presentation"),
							h.Attribute("style", "unicode-bidi: isolate;"),
						],
						dateSegments(h, {
							model: segments,
							toParentMessage: (message) => Message.GotSegmentsMessage({ message }),
							interaction: wiring,
							labelledBy: isLabelled ? labelId(model.id) : undefined,
							describedBy,
							ariaLabel: viewInputs.ariaLabel,
						}),
					),
					h.input([
						h.Attribute("class", ""),
						h.DataAttribute("rac", ""),
						h.Hidden(true),
						h.Attribute("style", ""),
						h.Type("text"),
						h.Value(segments.committed ?? ""),
						h.Attribute("title", ""),
					]),
				],
			),
			trigger,
		],
	)
	const rootState = Interaction.stateOf(wiring.model, rootTarget)
	return h.div(
		[
			h.Class(twMerge(twMerge(fieldStyles()), viewInputs.className)),
			...(model.isOpen ? [h.DataAttribute("open", "true")] : []),
			...(rootState.isFocusWithin ? [h.DataAttribute("focus-within", "true")] : []),
			h.DataAttribute("rac", ""),
			h.DataAttribute("slot", "control"),
			...Interaction.handlers(h, wiring, rootTarget, {
				isWithin: true,
				isHoverDisabled: true,
				isPressDisabled: true,
			}),
		],
		[
			...(viewInputs.label === undefined
				? []
				: [Field.label(h, { id: labelId(model.id), elementType: "span" }, [viewInputs.label])]),
			group,
			model.isOpen ? overlay(h, model) : h.empty,
		],
	)
})

/** React Aria's hidden siblings of a DatePicker (native date input, value description); the host renders them after it. */
export const datePickerHidden = <M>(h: HtmlBuilder<M>, model: Model): ReadonlyArray<Html> => {
	const selected = selectedDescription(model.segments)
	return [
		h.div(
			[
				h.AriaHidden(true),
				h.DataAttribute("a11y-ignore", "aria-hidden-focus"),
				h.DataAttribute("react-aria-prevent-focus", "true"),
				h.DataAttribute("testid", "hidden-dateinput-container"),
				h.Attribute("style", hiddenInputStyle),
			],
			[
				h.input([
					h.Attribute("form", ""),
					h.Step("60"),
					h.Attribute("style", ""),
					h.Tabindex(-1),
					h.Type("date"),
					h.Value(model.segments.committed ?? ""),
				]),
			],
		),
		...(selected === null
			? []
			: [h.div([h.Id(descriptionId(model.id)), h.Attribute("style", "display: none;")], [selected])]),
	]
}
