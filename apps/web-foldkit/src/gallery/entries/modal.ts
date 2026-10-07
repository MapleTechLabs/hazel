import { Array, Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import type { ModalSize } from "~/components/ui/modal.styles"
import { button } from "../../ui/button"
import { dialogBody, dialogClose, dialogFooter, dialogHeader } from "../../ui/dialog"
import * as Modal from "../../ui/modal"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ modals: Schema.Array(Modal.Model) })
type Model = typeof Model.Type

const sizes: ReadonlyArray<Readonly<{ id: string; label: string; size: ModalSize }>> = [
	{ id: "sm", label: "Small", size: "sm" },
	{ id: "xl", label: "Extra large", size: "xl" },
	{ id: "fullscreen", label: "Fullscreen", size: "fullscreen" },
]

// MESSAGE

const Message = defineMessageUnion({
	GotModalMessage: { id: Schema.String, message: Modal.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldModal = (id: string) =>
	Update.foldChild({
		update: Modal.update,
		read: (model: Model) => Array.findFirst(model.modals, (modal) => modal.id === id),
		write: (model, nextModal) =>
			modifyFields(model, { modals: Array.map((modal) => (modal.id === id ? nextModal : modal)) }),
		toParentMessage: (message) => Message.GotModalMessage({ id, message }),
	})

// VIEW

const modalOf = (model: Model, id: string) =>
	Option.getOrElse(
		Array.findFirst(model.modals, (modal) => modal.id === id),
		() => Modal.init(id),
	)

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Modal", [
		gallerySection(
			h,
			"Sizes",
			Array.map(sizes, (example) =>
				h.submodel({
					slotId: example.id,
					model: modalOf(model, example.id),
					view: Modal.view,
					viewInputs: {
						toTrigger: (attributes, overlay) =>
							button(h, { intent: "outline", attributes }, [example.label, overlay]),
						toContent: (closeAttributes) => [
							dialogHeader(h, {
								title: { id: Modal.titleId(example.id), text: `${example.label} modal` },
								description: "Modals keep focus until they close.",
							}),
							dialogBody(h, [
								h.p(
									[h.Class("text-sm/6")],
									["The panel width follows the size prop from sm upwards."],
								),
							]),
							dialogFooter(h, [dialogClose(h, closeAttributes, ["Close"])]),
						],
						size: example.size,
					},
					toParentMessage: (message) => Message.GotModalMessage({ id: example.id, message }),
				}),
			),
		),
		gallerySection(h, "Options", [
			h.submodel({
				slotId: "blurred",
				model: modalOf(model, "blurred"),
				view: Modal.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(h, { intent: "outline", attributes }, ["Blurred", overlay]),
					toContent: (closeAttributes) => [
						dialogHeader(h, {
							title: { id: Modal.titleId("blurred"), text: "Blurred backdrop" },
							description: "No close icon, blurred overlay.",
						}),
						dialogFooter(h, [dialogClose(h, closeAttributes, ["Done"])]),
					],
					isBlurred: true,
					closeButton: false,
				},
				toParentMessage: (message) => Message.GotModalMessage({ id: "blurred", message }),
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Modal", {
	Model,
	init: () => ({ model: { modals: Array.map(["sm", "xl", "fullscreen", "blurred"], Modal.init) } }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotModalMessage: ({ id, message }) => foldModal(id)(model, message),
		}),
	view,
})
