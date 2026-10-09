import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import * as EmojiDialog from "../../emoji-picker/dialog"
import { button } from "../../ui/button"
import { dateField } from "../../ui/date-field"
import type * as DatePicker from "../../ui/date-picker"
import { datePickerHidden, view as datePickerView } from "../../ui/date-picker-view"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { label } from "../../ui/field"
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

const toCustomDateMessage = (message: DatePicker.Message): Message => Message.GotCustomDateMessage({ message })
const toEmojiPickerMessage = (message: EmojiDialog.Message): Message => Message.GotEmojiPickerMessage({ message })

/** Legacy `<DatePicker value onChange minValue><DatePickerTrigger /></DatePicker>`. */
const datePicker = (h: HtmlBuilder<Message>, model: DatePicker.Model): ReadonlyArray<Html> => [
	h.submodel({
		slotId: model.id,
		model,
		view: datePickerView,
		viewInputs: {},
		toParentMessage: toCustomDateMessage,
	}),
	...datePickerHidden(h, model),
]

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

export const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) => {
	const expirationSelect = h.submodel({
		slotId: `${ID}-expiration-select`,
		model: model.expiration,
		view: selectView,
		viewInputs: {},
		toParentMessage: toExpirationMessage,
	})
	return frameView(
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
									EmojiDialog.view(h, model.emojiPicker, {
										toMessage: toEmojiPickerMessage,
										customEmojis: model.customEmojis,
										toTrigger: (attributes, overlay) =>
											button(
												h,
												{
													intent: "outline",
													size: "md",
													className: "min-w-12 text-lg",
													attributes: [h.AriaLabel("Pick an emoji"), ...attributes],
												},
												[model.emoji || "😊", overlay],
											),
									}),
									field.input({
										className: "flex-1",
										placeholder: "What's your status?",
										attributes: [h.Maxlength(255)],
									}),
								],
							),
						],
					),
					// textField renders its children twice, so the Select is registered once outside it.
					// React Aria's collection `<template>` sits between the Label and the Select, so the
					// field's label + control margin does not apply.
					textField(h, { id: `${ID}-expiration`, value: "" }, (field) => [
						field.label(["Clear after"]),
						h.template([]),
						expirationSelect,
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
	)
})
