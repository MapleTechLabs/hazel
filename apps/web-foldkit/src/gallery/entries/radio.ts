import { Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import { radioGroup, type RadioGroupOptions, type RadioGroupParts } from "../../ui/radio"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	values: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	SelectedRadio: { group: Schema.String, value: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		SelectedRadio: ({ group, value }) => ({
			model: modifyFields(model, { values: (values) => ({ ...values, [group]: value }) }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const initialValues: Record<string, string | null> = {
	density: "comfortable",
	theme: null,
	disabled: "on",
	invalid: null,
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const group = (
		id: string,
		options: Omit<RadioGroupOptions<Message>, "id" | "value">,
		render: (parts: RadioGroupParts<Message>) => Array<Html>,
	) =>
		h.div(
			[h.Class("w-72")],
			[
				radioGroup(
					h,
					{
						id,
						value: model.values[id] ?? null,
						onChange: (value) => Message.SelectedRadio({ group: id, value }),
						interaction: interaction.wiring(model),
						...options,
					},
					render,
				),
			],
		)
	return galleryFrame(h, "Radio", [
		gallerySection(h, "Groups", [
			group("density", {}, (g) => [
				g.label(["Density"]),
				g.radio("compact", "Compact"),
				g.radio("comfortable", "Comfortable"),
				g.radio("spacious", "Spacious"),
			]),
			group("theme", {}, (g) => [
				g.label(["Theme"]),
				g.description(["Applies to every device."]),
				g.radio("light", "Light"),
				g.radio("dark", "Dark"),
			]),
		]),
		gallerySection(h, "States", [
			group("disabled", { isDisabled: true }, (g) => [
				g.label(["Disabled"]),
				g.radio("on", "Disabled selected"),
				g.radio("off", "Disabled"),
			]),
			group("invalid", { isInvalid: true }, (g) => [
				g.label(["Invalid"]),
				g.radio("yes", "Yes"),
				g.radio("no", "No"),
				g.fieldError(["Pick one."]),
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Radio", {
	Model,
	init: () => ({ model: { values: initialValues, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
