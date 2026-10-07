import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { button } from "../../ui/button"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ lastClicked: Schema.NullOr(Schema.String) })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ClickedButton: { label: Schema.String },
})
type Message = typeof Message.Type

// VIEW

const intents = ["primary", "secondary", "warning", "danger", "outline", "plain"] as const
const sizes = ["xs", "sm", "md", "lg"] as const

const view = (_model: Model, h: HtmlBuilder<Message>) => {
	const labelled = (label: string) => [h.OnClick(Message.ClickedButton({ label }))]
	return galleryFrame(h, "Button", [
		gallerySection(
			h,
			"Intents",
			intents.map((intent) => button(h, { intent, attributes: labelled(intent) }, [intent])),
		),
		gallerySection(
			h,
			"Sizes",
			sizes.map((size) => button(h, { size, attributes: labelled(size) }, [`Size ${size}`])),
		),
		gallerySection(h, "Circle", [
			button(h, { isCircle: true, attributes: labelled("circle") }, ["Circle"]),
			button(h, { isCircle: true, intent: "outline", attributes: labelled("circle outline") }, [
				"Circle outline",
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Button", {
	Model,
	init: () => ({ model: { lastClicked: null } }),
	update: (model, message) =>
		Message.match<{ model: Model }>(message, {
			ClickedButton: ({ label }) => ({ model: { ...model, lastClicked: label } }),
		}),
	view,
})
