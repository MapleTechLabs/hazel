import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { button } from "../../ui/button"
import { dialogBody, dialogClose, dialogDescription, dialogHeader, dialogTitle } from "../../ui/dialog"
import * as Popover from "../../ui/popover"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ details: Popover.Model, pinned: Popover.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotDetailsMessage: { message: Popover.Message },
	GotPinnedMessage: { message: Popover.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldDetails = Update.foldChild({
	update: Popover.update,
	read: (model: Model) => Option.some(model.details),
	write: (model, nextDetails) => modifyFields(model, { details: () => nextDetails }),
	toParentMessage: (message) => Message.GotDetailsMessage({ message }),
})

const foldPinned = Update.foldChild({
	update: Popover.update,
	read: (model: Model) => Option.some(model.pinned),
	write: (model, nextPinned) => modifyFields(model, { pinned: () => nextPinned }),
	toParentMessage: (message) => Message.GotPinnedMessage({ message }),
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Popover", [
		gallerySection(h, "Popover", [
			h.submodel({
				slotId: "details",
				model: model.details,
				view: Popover.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(h, { intent: "outline", attributes }, ["Details", overlay]),
					toContent: (closeAttributes) => [
						dialogHeader(h, {}, [
							dialogTitle(h, {}, "Notifications"),
							dialogDescription(h, "Choose when this channel notifies you."),
						]),
						dialogBody(h, [
							h.p([h.Class("text-sm/6")], ["Mentions and replies always notify you."]),
						]),
						Popover.popoverFooter(h, [dialogClose(h, closeAttributes, ["Close"])]),
					],
				},
				toParentMessage: (message) => Message.GotDetailsMessage({ message }),
			}),
			h.submodel({
				slotId: "pinned",
				model: model.pinned,
				view: Popover.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(h, { intent: "outline", attributes }, ["With arrow", overlay]),
					toContent: () => [
						dialogHeader(h, {}, [
							dialogTitle(h, {}, "Pinned"),
							dialogDescription(h, "Two messages are pinned here."),
						]),
					],
					arrow: true,
					placement: "right",
				},
				toParentMessage: (message) => Message.GotPinnedMessage({ message }),
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Popover", {
	Model,
	init: () => ({ model: { details: Popover.init("details"), pinned: Popover.init("pinned") } }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotDetailsMessage: ({ message }) => foldDetails(model, message),
			GotPinnedMessage: ({ message }) => foldPinned(model, message),
		}),
	view,
})
