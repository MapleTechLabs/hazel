import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import { dateField } from "../../ui/date-field"
import * as D from "../../ui/calendar-date"
import * as Segments from "../../ui/date-segments"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const FieldKey = Schema.Literals(["start", "due", "disabled", "invalid"])
type FieldKey = typeof FieldKey.Type

const Model = Schema.Struct({
	start: Segments.Model,
	due: Segments.Model,
	disabled: Segments.Model,
	invalid: Segments.Model,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotDateFieldMessage: { fieldId: FieldKey, message: Segments.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

const toFieldMessage =
	(field: FieldKey) =>
	(message: Segments.Message): Message =>
		Message.GotDateFieldMessage({ fieldId: field, message })

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotDateFieldMessage: ({ fieldId: field, message }) =>
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
	return galleryFrame(h, "Date field", [
		gallerySection(h, "Fields", [
			...dateField(h, common("start"), (f) => [f.label(["Start date"]), f.dateInput()]),
			...dateField(h, common("due"), (f) => [
				f.label(["Due date"]),
				f.dateInput(),
				f.description(["When the task is due."]),
			]),
		]),
		gallerySection(h, "States", [
			...dateField(h, common("disabled"), (f) => [f.label(["Disabled"]), f.dateInput()]),
			...dateField(h, common("invalid"), (f) => [
				f.label(["Invalid"]),
				f.dateInput(),
				f.fieldError(["Pick a weekday."]),
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Date field", {
	Model,
	init: () => {
		const today = D.today()
		return {
			model: {
				start: Segments.init({ id: "start", kind: "date", today }),
				due: Segments.init({ id: "due", kind: "date", today, value: "2026-10-07" }),
				disabled: Segments.init({
					id: "disabled",
					kind: "date",
					today,
					value: "2026-01-15",
					isDisabled: true,
				}),
				invalid: Segments.init({
					id: "invalid",
					kind: "date",
					today,
					value: "2026-02-28",
					isInvalid: true,
				}),
				interaction: Interaction.init(),
			},
		}
	},
	update,
	view,
	subscriptions: interaction.subscriptions,
})
