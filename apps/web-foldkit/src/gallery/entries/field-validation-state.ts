import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { fieldValidationState, type ValidationState } from "../../ui/field-validation-state"
import { input } from "../../ui/input"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

const Model = Schema.Struct({})
type Model = typeof Model.Type

const Message = defineMessageUnion({ IgnoredGalleryEvent: {} })
type Message = typeof Message.Type

const states: ReadonlyArray<ValidationState> = ["idle", "validating", "valid", "invalid"]

const view = (_model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Field validation state", [
		gallerySection(
			h,
			"States",
			states.map((state) =>
				h.div(
					[h.Class("relative w-56")],
					[
						input(h, { defaultValue: state, attributes: [h.AriaLabel(`Validation ${state}`)] }),
						fieldValidationState(h, { state }),
					],
				),
			),
		),
	])

export const gallery = defineGallery<Model, Message>("Field validation state", {
	Model,
	init: () => ({ model: {} }),
	update: (model) => ({ model }),
	view,
})
