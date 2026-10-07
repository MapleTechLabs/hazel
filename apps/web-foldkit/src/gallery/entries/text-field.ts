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
	name: "",
	email: "ada@hazel.sh",
	username: "",
	invalid: "not-an-email",
	disabled: "Read only value",
	required: "",
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const field = (
		id: string,
		options: Omit<TextFieldOptions<Message>, "id" | "value">,
		render: (parts: TextFieldParts<Message>) => Array<Html>,
	) =>
		h.div(
			[h.Class("w-72")],
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
	return galleryFrame(h, "Text field", [
		gallerySection(h, "Fields", [
			field("name", {}, (f) => [f.label(["Name"]), f.input({ placeholder: "Ada Lovelace" })]),
			field("email", {}, (f) => [
				f.label(["Email"]),
				f.input(),
				f.description(["We never share your email."]),
			]),
			field("username", {}, (f) => [
				f.label(["Username"]),
				f.description(["Lowercase letters and numbers."]),
				f.input({ placeholder: "ada" }),
			]),
		]),
		gallerySection(h, "States", [
			field("invalid", { isInvalid: true }, (f) => [
				f.label(["Invalid"]),
				f.input(),
				f.fieldError(["Enter a valid email address."]),
			]),
			field("disabled", { isDisabled: true }, (f) => [
				f.label(["Disabled"]),
				f.input(),
				f.description(["This field is disabled."]),
			]),
			field("required", { isRequired: true }, (f) => [
				f.label(["Required"]),
				f.input({ placeholder: "Required" }),
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Text field", {
	Model,
	init: () => ({ model: { values: initialValues, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
