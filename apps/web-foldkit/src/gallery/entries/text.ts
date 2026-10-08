import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { code, keyboard, strong, text } from "../../ui/text"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Text", [
		gallerySection(h, "Text", [
			text(h, { className: "max-w-md" }, [
				"Messages are kept for ",
				strong(h, {}, ["90 days"]),
				" on the free plan. Run ",
				code(h, {}, ["hazel export"]),
				" ",
				"to download a copy before they expire.",
			]),
		]),
		gallerySection(h, "Keyboard", [
			keyboard(h, {}, ["⌘K"]),
			keyboard(h, { className: "text-fg" }, ["Ctrl Shift P"]),
		]),
	])

export const gallery = defineGallery<Model, Message>("Text", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
