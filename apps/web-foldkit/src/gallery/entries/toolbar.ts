import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { button } from "../../ui/button"
import { separator } from "../../ui/separator"
import * as Toolbar from "../../ui/toolbar"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ formatting: Toolbar.Model, tools: Toolbar.Model })
type Model = typeof Model.Type
type Slot = keyof Model

// MESSAGE

const Message = defineMessageUnion({
	GotToolbarMessage: { slot: Schema.Literals(["formatting", "tools"]), message: Toolbar.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldToolbar = (slot: Slot) =>
	Update.foldChild({
		update: Toolbar.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model, nextToolbar) => ({ ...model, [slot]: nextToolbar }),
		toParentMessage: (message) => Message.GotToolbarMessage({ slot, message }),
	})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotToolbarMessage: ({ slot, message }) => foldToolbar(slot)(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const toolbar = (slot: Slot, viewInputs: Toolbar.ViewInputs) =>
		h.submodel({
			slotId: slot,
			model: model[slot],
			view: Toolbar.view,
			viewInputs,
			toParentMessage: (message) => Message.GotToolbarMessage({ slot, message }),
		})
	return galleryFrame(h, "Toolbar", [
		gallerySection(h, "Horizontal", [
			toolbar("formatting", {
				content: [
					button(h, { intent: "plain", size: "sm" }, ["Bold"]),
					button(h, { intent: "plain", size: "sm" }, ["Italic"]),
					separator(h, { orientation: "vertical", className: "mx-1 h-5" }),
					button(h, { intent: "plain", size: "sm" }, ["Link"]),
				],
			}),
		]),
		gallerySection(h, "Vertical", [
			toolbar("tools", {
				content: [
					button(h, { intent: "outline", size: "sm" }, ["Select"]),
					button(h, { intent: "outline", size: "sm" }, ["Draw"]),
				],
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Toolbar", {
	Model,
	init: () => ({
		model: {
			formatting: Toolbar.init({ label: "Text formatting" }),
			tools: Toolbar.init({ label: "Tools", orientation: "vertical" }),
		},
	}),
	update,
	view,
})
