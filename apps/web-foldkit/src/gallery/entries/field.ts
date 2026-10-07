import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import { description, fieldErrors, fieldset, label, legend } from "../../ui/field"
import { textField } from "../../ui/text-field"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({ displayName: Schema.String, interaction: Interaction.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	UpdatedDisplayName: { value: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		UpdatedDisplayName: ({ value }) => ({ model: modifyFields(model, { displayName: () => value }) }),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Field", [
		gallerySection(h, "Parts", [
			h.div(
				[h.Class("flex w-72 flex-col")],
				[label(h, {}, ["Standalone label"]), description(h, {}, ["Standalone description text."])],
			),
			h.div(
				[h.Class("w-72")],
				[
					fieldErrors(h, {
						errors: [
							{ message: "Name is required." },
							{ message: "Must be at least 3 characters." },
						],
					}),
				],
			),
		]),
		gallerySection(h, "Fieldset", [
			h.div(
				[h.Class("w-96")],
				[
					fieldset(h, {}, [
						legend(h, {}, ["Profile"]),
						h.p(
							[h.DataAttribute("slot", "text"), h.Class("text-muted-fg text-sm")],
							["How others see you."],
						),
						textField(
							h,
							{
								id: "display-name",
								value: model.displayName,
								onInput: (value) => Message.UpdatedDisplayName({ value }),
								interaction: interaction.wiring(model),
							},
							(f) => [f.label(["Display name"]), f.input({ placeholder: "Ada" })],
						),
					]),
				],
			),
		]),
	])

export const gallery = defineGallery<Model, Message>("Field", {
	Model,
	init: () => ({ model: { displayName: "", interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
