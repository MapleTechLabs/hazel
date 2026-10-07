import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import { ariaButton, button } from "../../ui/button"
import { dateField } from "../../ui/date-field"
import type * as Segments from "../../ui/date-segments"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { label } from "../../ui/field"
import { inputGroup } from "../../ui/input"
import type * as Select from "../../ui/select"
import { view as selectView } from "../../ui/select-view"
import { switchControl } from "../../ui/switch"
import { textField } from "../../ui/text-field"
import type { ModalViewInputs } from "./contract"
import { frameView, modalDescription, modalTitle } from "./frame"
import {
	expirationOf,
	hasExistingStatus,
	ID,
	isSaveDisabled,
	Message,
	type Model,
	STATUS_PRESETS,
} from "./set-status-model"

/** The set-status modal's view (legacy `SetStatusModal` markup). */

/** `@heroicons/react/24/outline` CalendarDaysIcon, as legacy DatePickerTrigger renders it. */
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
				h.Attribute(
					"d",
					"M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z",
				),
			]),
		],
	)

/**
 * Legacy `<DatePicker><DatePickerTrigger /></DatePicker>`. The kit has no DatePicker, so this is a
 * DateField holding the trigger's InputGroup; the calendar popover is left out.
 */
const datePicker = (h: HtmlBuilder<Message>, model: Segments.Model): ReadonlyArray<Html> =>
	dateField(h, { model, toParentMessage: (message) => Message.GotCustomDateMessage({ message }) }, (field) => [
		inputGroup(h, { className: "*:data-[slot=control]:w-full" }, [
			field.dateInput(),
			ariaButton(
				h,
				{
					className: twJoin(
						"touch-target grid place-content-center outline-hidden",
						"pressed:text-fg text-muted-fg hover:text-fg focus-visible:text-fg",
						"px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6",
						"*:data-[slot=icon]:size-4.5 sm:*:data-[slot=icon]:size-4",
					),
					attributes: [
						h.DataAttribute("slot", "date-picker-trigger"),
						h.AriaLabel("Calendar"),
						h.Attribute("aria-haspopup", "dialog"),
						h.AriaExpanded(false),
					],
				},
				[calendarDaysIcon(h)],
			),
		]),
	])

const customDateTimeRow = (h: HtmlBuilder<Message>, model: Model): Html =>
	model.customDate === null || model.customTime === null
		? h.empty
		: h.div(
				[h.Class("flex gap-3")],
				[
					h.div(
						[h.Class("flex flex-1 flex-col gap-1")],
						[label(h, { className: "text-muted-fg text-xs" }, ["Date"]), ...datePicker(h, model.customDate)],
					),
					h.div(
						[h.Class("flex flex-col gap-1")],
						[
							label(h, { className: "text-muted-fg text-xs" }, ["Time"]),
							...dateField(
								h,
								{
									model: model.customTime,
									toParentMessage: (message) => Message.GotCustomTimeMessage({ message }),
								},
								(field) => [field.dateInput()],
							),
						],
					),
				],
			)

const presetButtons = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("flex flex-col gap-2")],
		[
			label(h, { className: "text-muted-fg text-xs" }, ["Quick presets"]),
			h.div(
				[h.Class("flex flex-wrap gap-2")],
				STATUS_PRESETS.map((preset) => {
					const isSelected = model.emoji === preset.emoji && model.message === preset.message
					return button(
						h,
						{
							intent: "outline",
							size: "sm",
							onPress: Message.ClickedPreset(preset),
							className: isSelected
								? "gap-1.5 border-primary/60 bg-primary/10 text-primary hover:bg-primary/15"
								: "gap-1.5",
							attributes: [h.AriaPressed(isSelected ? "true" : "false")],
						},
						[h.span([], [preset.emoji]), h.span([], [preset.message])],
					)
				}),
			),
		],
	)

const toExpirationMessage = (message: Select.Message): Message => Message.GotExpirationMessage({ message })

export const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) =>
	frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Set a status"),
				modalDescription(h, "Let others know what you're up to."),
			]),
			dialogBody(
				h,
				[
					textField(
						h,
						{ id: `${ID}-message`, value: model.message, onInput: (value) => Message.ChangedMessage({ value }) },
						(field) => [
							field.label(["Status"]),
							h.div(
								[h.Class("flex gap-2")],
								[
									// Legacy EmojiPickerDialog trigger; the picker popover is not ported.
									button(
										h,
										{
											intent: "outline",
											size: "md",
											className: "min-w-12 text-lg",
											attributes: [h.AriaLabel("Pick an emoji"), h.AriaExpanded(false)],
										},
										[model.emoji || "😊"],
									),
									field.input({
										className: "flex-1",
										placeholder: "What's your status?",
										attributes: [h.Maxlength(255)],
									}),
								],
							),
						],
					),
					textField(h, { id: `${ID}-expiration`, value: "" }, (field) => [
						field.label(["Clear after"]),
						h.submodel({
							slotId: `${ID}-expiration-select`,
							model: model.expiration,
							view: selectView,
							viewInputs: {},
							toParentMessage: toExpirationMessage,
						}),
					]),
					expirationOf(model) === "custom" ? customDateTimeRow(h, model) : h.empty,
					h.div(
						[h.Class("rounded-lg border border-border bg-secondary/30 p-3")],
						[
							switchControl(
								h,
								{
									id: `${ID}-pause`,
									isSelected: model.pauseNotifications,
									onChange: (isSelected) => Message.ToggledPauseNotifications({ isSelected }),
								},
								"Pause notifications",
							),
							h.p(
								[h.Class("mt-1 text-muted-fg text-xs")],
								["Don't receive notifications while this status is set"],
							),
						],
					),
					h.hr([h.Class("h-px w-full border-none bg-border")]),
					presetButtons(h, model),
				],
				"flex flex-col gap-5",
			),
			dialogFooter(
				h,
				[
					h.div(
						[],
						hasExistingStatus(model)
							? [
									button(
										h,
										{ intent: "danger", onPress: Message.ClickedClear(), isDisabled: model.isSubmitting },
										["Clear status"],
									),
								]
							: [],
					),
					h.div(
						[h.Class("flex gap-2")],
						[
							button(h, { intent: "outline", onPress: Message.ClickedCancel() }, ["Cancel"]),
							button(
								h,
								{ intent: "primary", onPress: Message.ClickedSave(), isDisabled: isSaveDisabled(model) },
								[model.isSubmitting ? "Saving..." : "Save"],
							),
						],
					),
				],
				"flex justify-between",
			),
		],
		(message) => Message.GotFrameMessage({ message }),
	),
)
