import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import { dateField } from "../../ui/date-field"
import * as Segments from "../../ui/date-segments"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const FieldKey = Schema.Literals(["start", "reminder", "disabled"])
type FieldKey = typeof FieldKey.Type

const Model = Schema.Struct({
	start: Segments.Model,
	reminder: Segments.Model,
	disabled: Segments.Model,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotTimeFieldMessage: { field: FieldKey, message: Segments.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

const toFieldMessage =
	(field: FieldKey) =>
	(message: Segments.Message): Message =>
		Message.GotTimeFieldMessage({ field, message })

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotTimeFieldMessage: ({ field, message }) =>
			Update.foldChild({
				update: Segments.update,
				read: (current: Model) => Option.some(current[field]),
				write: (current: Model, next: Segments.Model): Model => ({ ...current, [field]: next }),
				toParentMessage: toFieldMessage(field),
			})(model, message),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const common = (field: FieldKey) => ({
		model: model[field],
		toParentMessage: toFieldMessage(field),
		interaction: interaction.wiring(model),
	})
	return galleryFrame(h, "Time field", [
		gallerySection(h, "Fields", [
			...dateField(h, common("start"), (f) => [f.label(["Start time"]), f.dateInput()]),
			...dateField(h, common("reminder"), (f) => [f.label(["Reminder"]), f.dateInput()]),
			...dateField(h, common("disabled"), (f) => [f.label(["Disabled"]), f.dateInput()]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Time field", {
	Model,
	init: () => ({
		model: {
			start: Segments.init({ id: "start", kind: "time", value: "22:00" }),
			reminder: Segments.init({ id: "reminder", kind: "time" }),
			disabled: Segments.init({ id: "disabled", kind: "time", value: "08:30", isDisabled: true }),
			interaction: Interaction.init(),
		},
	}),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
