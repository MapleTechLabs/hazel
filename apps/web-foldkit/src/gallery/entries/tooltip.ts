import { Array, Option, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconEdit } from "../../icons"
import type { Placement } from "../../ui/aria/position"
import { button } from "../../ui/button"
import * as Tooltip from "../../ui/tooltip"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ tooltips: Schema.Array(Tooltip.Model) })
type Model = typeof Model.Type

const ids = ["top", "bottom", "right", "rename", "inverse", "no-arrow"] as const

// MESSAGE

const Message = defineMessageUnion({
	GotTooltipMessage: { id: Schema.String, message: Tooltip.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldTooltip = (id: string) =>
	Update.foldChild({
		update: Tooltip.update,
		read: (model: Model) => Array.findFirst(model.tooltips, (tooltip) => tooltip.id === id),
		write: (model, nextTooltip) =>
			modifyFields(model, {
				tooltips: Array.map((tooltip) => (tooltip.id === id ? nextTooltip : tooltip)),
			}),
		toParentMessage: (message) => Message.GotTooltipMessage({ id, message }),
	})

// VIEW

type Example = Readonly<{
	id: (typeof ids)[number]
	trigger: (
		h: HtmlBuilder<Message>,
		attributes: Parameters<Tooltip.ViewInputs["toTrigger"]>[0],
		overlay: Html,
	) => Html
	content: string
	placement?: Placement
	inverse?: boolean
	arrow?: boolean
}>

const outlineTrigger =
	(label: string): Example["trigger"] =>
	(h, attributes, overlay) =>
		button(h, { intent: "outline", attributes }, [label, overlay])

const placementExamples: ReadonlyArray<Example> = [
	{ id: "top", trigger: outlineTrigger("Top"), content: "Add reaction" },
	{ id: "bottom", trigger: outlineTrigger("Bottom"), content: "Shown below", placement: "bottom" },
	{ id: "right", trigger: outlineTrigger("Right"), content: "Shown to the right", placement: "right" },
]

const variantExamples: ReadonlyArray<Example> = [
	{
		id: "rename",
		trigger: (h, attributes, overlay) =>
			button(
				h,
				{
					intent: "plain",
					size: "sq-sm",
					attributes: [...attributes, h.Attribute("aria-label", "Rename thread")],
				},
				[IconEdit(h, { className: "size-4", attributes: { "data-slot": "icon" } }), overlay],
			),
		content: "Rename",
	},
	{ id: "inverse", trigger: outlineTrigger("Inverse"), content: "Inverse tooltip", inverse: true },
	{ id: "no-arrow", trigger: outlineTrigger("No arrow"), content: "Without an arrow", arrow: false },
]

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const example = (spec: Example) =>
		Option.match(
			Array.findFirst(model.tooltips, (tooltip) => tooltip.id === spec.id),
			{
				onNone: () => h.empty,
				onSome: (tooltip) =>
					h.submodel({
						slotId: spec.id,
						model: tooltip,
						view: Tooltip.view,
						viewInputs: {
							toTrigger: (attributes, overlay) => spec.trigger(h, attributes, overlay),
							content: [spec.content],
							placement: spec.placement,
							inverse: spec.inverse,
							arrow: spec.arrow,
						},
						toParentMessage: (message) => Message.GotTooltipMessage({ id: spec.id, message }),
					}),
			},
		)
	return galleryFrame(h, "Tooltip", [
		gallerySection(h, "Placement", Array.map(placementExamples, example)),
		gallerySection(h, "Variants", Array.map(variantExamples, example)),
	])
}

export const gallery = defineGallery<Model, Message>("Tooltip", {
	Model,
	init: () => ({ model: { tooltips: Array.map(ids, Tooltip.init) } }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotTooltipMessage: ({ id, message }) => foldTooltip(id)(model, message),
		}),
	view,
})
