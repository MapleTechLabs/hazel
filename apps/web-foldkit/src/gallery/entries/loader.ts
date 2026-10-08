import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { loader } from "../../ui/loader"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGallery: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Loader", [
		gallerySection(h, "Ring", [
			loader(h, { variant: "ring", ariaLabel: "Loading ring" }),
			loader(h, { variant: "ring", ariaLabel: "Loading large ring", className: "size-6 text-primary" }),
		]),
		gallerySection(h, "Spin", [
			loader(h, { ariaLabel: "Spinning" }),
			loader(h, { ariaLabel: "Spinning large", className: "size-8 text-muted-fg" }),
		]),
	])

export const gallery = defineGallery<Model, Message>("Loader", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
