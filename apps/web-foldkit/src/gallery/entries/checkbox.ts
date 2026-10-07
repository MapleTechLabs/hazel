import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import { checkbox, checkboxGroup, type CheckboxOptions } from "../../ui/checkbox"
import { description, label } from "../../ui/field"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	selected: Schema.Record(Schema.String, Schema.Boolean),
	notify: Schema.Array(Schema.String),
	terms: Schema.Array(Schema.String),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ToggledCheckbox: { id: Schema.String, isSelected: Schema.Boolean },
	UpdatedNotify: { value: Schema.Array(Schema.String) },
	UpdatedTerms: { value: Schema.Array(Schema.String) },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		ToggledCheckbox: ({ id, isSelected }) => ({
			model: modifyFields(model, { selected: (selected) => ({ ...selected, [id]: isSelected }) }),
		}),
		UpdatedNotify: ({ value }) => ({ model: modifyFields(model, { notify: () => value }) }),
		UpdatedTerms: ({ value }) => ({ model: modifyFields(model, { terms: () => value }) }),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const initialSelected: Record<string, boolean> = {
	unchecked: false,
	checked: true,
	indeterminate: false,
	disabled: false,
	"disabled-checked": true,
	invalid: false,
	"invalid-checked": true,
	email: false,
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	const item = (id: string, options: Omit<CheckboxOptions<Message>, "id" | "isSelected"> = {}) => ({
		id,
		isSelected: model.selected[id] ?? false,
		onChange: (isSelected: boolean) => Message.ToggledCheckbox({ id, isSelected }),
		interaction: wiring,
		...options,
	})
	return galleryFrame(h, "Checkbox", [
		gallerySection(h, "States", [
			checkbox(h, item("unchecked"), "Unchecked"),
			checkbox(h, item("checked"), "Checked"),
			checkbox(h, item("indeterminate", { isIndeterminate: true }), "Indeterminate"),
			checkbox(h, item("disabled", { isDisabled: true }), "Disabled"),
			checkbox(h, item("disabled-checked", { isDisabled: true }), "Disabled checked"),
			checkbox(h, item("invalid", { isInvalid: true }), "Invalid"),
			checkbox(h, item("invalid-checked", { isInvalid: true }), "Invalid checked"),
		]),
		gallerySection(h, "With description", [
			h.div(
				[h.Class("w-80")],
				[
					checkbox(h, item("email"), [
						label(h, {}, ["Email notifications"]),
						description(h, {}, ["Get a digest of unread messages."]),
					]),
				],
			),
		]),
		gallerySection(h, "Group", [
			h.div(
				[h.Class("w-80")],
				[
					checkboxGroup(
						h,
						{
							id: "notify",
							value: model.notify,
							onChange: (value) => Message.UpdatedNotify({ value }),
							interaction: wiring,
						},
						(group) => [
							group.label(["Notify me about"]),
							group.checkbox("mentions", "Mentions"),
							group.checkbox("replies", "Replies"),
							group.checkbox("reactions", "Reactions"),
						],
					),
				],
			),
			h.div(
				[h.Class("w-80")],
				[
					checkboxGroup(
						h,
						{
							id: "terms",
							value: model.terms,
							isInvalid: true,
							onChange: (value) => Message.UpdatedTerms({ value }),
							interaction: wiring,
						},
						(group) => [
							group.label(["Accept the terms"]),
							group.checkbox("terms", "I agree to the terms"),
							group.fieldError(["You must accept the terms."]),
						],
					),
				],
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Checkbox", {
	Model,
	init: () => ({
		model: {
			selected: initialSelected,
			notify: ["mentions"],
			terms: [],
			interaction: Interaction.init(),
		},
	}),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
