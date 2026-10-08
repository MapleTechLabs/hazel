import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { formErrorSummary } from "../../ui/form-error-summary"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGalleryEvent: {} })
type Message = typeof Message.Type

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Form error summary", [
		gallerySection(h, "Default title", [
			h.div(
				[h.Class("w-96")],
				[
					formErrorSummary(h, {
						errors: [
							{ field: "Name", message: "Name is required." },
							{ field: "Email", message: "Enter a valid email address." },
						],
					}),
				],
			),
		]),
		gallerySection(h, "Custom title", [
			h.div(
				[h.Class("w-96")],
				[
					formErrorSummary(h, {
						title: "Could not save the channel",
						errors: [{ field: "Slug", message: "This slug is taken." }],
					}),
				],
			),
		]),
		gallerySection(h, "No errors", [formErrorSummary(h, { errors: [] })]),
	])

export const gallery = defineGallery<Model, Message>("Form error summary", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
