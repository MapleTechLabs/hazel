import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import { textField, type TextFieldOptions, type TextFieldParts } from "../../ui/text-field"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	values: Schema.Record(Schema.String, Schema.String),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	UpdatedFieldValue: { field: Schema.String, value: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		UpdatedFieldValue: ({ field, value }) => ({
			model: modifyFields(model, { values: (values) => ({ ...values, [field]: value }) }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const initialValues: Record<string, string> = {
	message: "",
	notes: "Line one\nLine two\nLine three",
	invalid: "Too short",
	disabled: "Disabled text",
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const field = (
		id: string,
		options: Omit<TextFieldOptions<Message>, "id" | "value">,
		render: (parts: TextFieldParts<Message>) => Array<Html>,
	) =>
		h.div(
			[h.Class("w-80")],
			[
				textField(
					h,
					{
						id,
						value: model.values[id] ?? "",
						onInput: (value) => Message.UpdatedFieldValue({ field: id, value }),
						interaction: interaction.wiring(model),
						...options,
					},
					render,
				),
			],
		)
	return galleryFrame(h, "Textarea", [
		gallerySection(h, "Textareas", [
			field("message", {}, (f) => [
				f.label(["Message"]),
				f.textarea({ placeholder: "Write something" }),
			]),
			field("notes", {}, (f) => [
				f.label(["Notes"]),
				f.textarea(),
				f.description(["Grows with its content."]),
			]),
		]),
		gallerySection(h, "States", [
			field("invalid", { isInvalid: true }, (f) => [
				f.label(["Invalid"]),
				f.textarea(),
				f.fieldError(["Write at least 20 characters."]),
			]),
			field("disabled", { isDisabled: true }, (f) => [f.label(["Disabled"]), f.textarea()]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Textarea", {
	Model,
	init: () => ({ model: { values: initialValues, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
