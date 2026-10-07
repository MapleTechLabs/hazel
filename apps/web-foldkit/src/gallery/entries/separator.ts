import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { separator } from "../../ui/separator"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Separator", [
		gallerySection(h, "Horizontal", [
			h.div(
				[h.Class("w-64")],
				[
					h.p([h.Class("text-sm")], ["Above"]),
					separator(h, { className: "my-2" }),
					h.p([h.Class("text-sm")], ["Below"]),
				],
			),
		]),
		gallerySection(h, "Vertical", [
			h.div(
				[h.Class("flex h-8 items-center gap-2 text-sm")],
				[h.span([], ["Left"]), separator(h, { orientation: "vertical" }), h.span([], ["Right"])],
			),
		]),
	])

export const gallery = defineGallery<Model, Message>("Separator", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
