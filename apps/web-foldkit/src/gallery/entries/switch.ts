import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
import { description, label } from "../../ui/field"
import { switchControl, type SwitchOptions } from "../../ui/switch"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	selected: Schema.Record(Schema.String, Schema.Boolean),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ToggledSwitch: { id: Schema.String, isSelected: Schema.Boolean },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		ToggledSwitch: ({ id, isSelected }) => ({
			model: modifyFields(model, { selected: (selected) => ({ ...selected, [id]: isSelected }) }),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const initialSelected: Record<string, boolean> = {
	off: false,
	on: true,
	disabled: false,
	"disabled-on": true,
	desktop: false,
}

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const item = (id: string, options: Omit<SwitchOptions<Message>, "id" | "isSelected"> = {}) => ({
		id,
		isSelected: model.selected[id] ?? false,
		onChange: (isSelected: boolean) => Message.ToggledSwitch({ id, isSelected }),
		interaction: interaction.wiring(model),
		...options,
	})
	const box = (width: string, child: ReturnType<typeof switchControl>) => h.div([h.Class(width)], [child])
	return galleryFrame(h, "Switch", [
		gallerySection(h, "States", [
			box("w-64", switchControl(h, item("off"), "Off")),
			box("w-64", switchControl(h, item("on"), "On")),
			box("w-64", switchControl(h, item("disabled", { isDisabled: true }), "Disabled")),
			box("w-64", switchControl(h, item("disabled-on", { isDisabled: true }), "Disabled on")),
		]),
		gallerySection(h, "With description", [
			box(
				"w-80",
				switchControl(h, item("desktop"), [
					label(h, { elementType: "span" }, ["Desktop notifications"]),
					description(h, {}, ["Show a banner for new messages."]),
				]),
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Switch", {
	Model,
	init: () => ({ model: { selected: initialSelected, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
