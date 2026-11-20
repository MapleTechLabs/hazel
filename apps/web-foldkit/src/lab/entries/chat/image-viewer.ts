import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { imageViewerView, type ImageViewerImage } from "../../../chat/image-viewer"
import { button } from "../../../ui/button"
import { defineLab } from "../../define"
import { labPage } from "../../frame"

/**
 * The image viewer over two pictures: its toolbar (Download, Copy image, Copy image URL, Open in
 * browser, Close), paging and zoom. A click beside the picture closes it; "Open viewer" reopens.
 */

const IMAGES: ReadonlyArray<ImageViewerImage> = [
	{ id: "ocean", fileName: "squirrel-ocean.webp", fileSize: 120_000, url: "/images/squirrle_ocean.webp" },
	{ id: "window", fileName: "squirrel-window.webp", fileSize: 98_000, url: "/images/squirrle_window.webp" },
]

const Model = Schema.Struct({ isOpen: Schema.Boolean, index: Schema.Finite, lastAction: Schema.String })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	ClickedOpen: {},
	ClosedViewer: {},
	SelectedImage: { index: Schema.Finite },
	ClickedAction: { action: Schema.String },
})
type Message = typeof Message.Type

export const lab = defineLab("Image viewer", {
	Model,
	init: () => ({ model: { isOpen: true, index: 0, lastAction: "none" } }),
	update: (model: Model, message: Message) =>
		Message.match(message, {
			ClickedOpen: () => ({ model: { ...model, isOpen: true } }),
			ClosedViewer: () => ({ model: { ...model, isOpen: false } }),
			SelectedImage: ({ index }) => ({ model: { ...model, index } }),
			ClickedAction: ({ action }) => ({ model: { ...model, lastAction: action } }),
		}),
	view: (model, h) =>
		labPage(h, { title: "Image viewer", switches: [] }, [
			h.div(
				[h.Class("flex items-center gap-3 p-6")],
				[
					button(h, { intent: "outline", onPress: Message.ClickedOpen() }, ["Open viewer"]),
					h.span([h.Class("text-muted-fg text-sm")], [`Last toolbar action: ${model.lastAction}`]),
				],
			),
			model.isOpen
				? imageViewerView(h, {
						images: IMAGES,
						index: model.index,
						author: { name: "Ada Lovelace", avatarUrl: null, seed: "ada" },
						createdAtMs: Date.UTC(2026, 10, 19, 9, 30),
						toClose: () => Message.ClosedViewer(),
						toSelect: (index) => Message.SelectedImage({ index }),
						toAction: (action) => Message.ClickedAction({ action }),
					})
				: h.empty,
		]),
})
