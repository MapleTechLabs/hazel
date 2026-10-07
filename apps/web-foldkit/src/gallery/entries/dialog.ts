import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { button } from "../../ui/button"
import {
	dialogBody,
	dialogClose,
	dialogDescription,
	dialogFooter,
	dialogHeader,
	dialogTitle,
} from "../../ui/dialog"
import * as Modal from "../../ui/modal"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ rename: Modal.Model, remove: Modal.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotRenameMessage: { message: Modal.Message },
	GotRemoveMessage: { message: Modal.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldRename = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(model.rename),
	write: (model, nextRename) => modifyFields(model, { rename: () => nextRename }),
	toParentMessage: (message) => Message.GotRenameMessage({ message }),
})

const foldRemove = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(model.remove),
	write: (model, nextRemove) => modifyFields(model, { remove: () => nextRemove }),
	toParentMessage: (message) => Message.GotRemoveMessage({ message }),
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Dialog", [
		gallerySection(h, "Dialog", [
			h.submodel({
				slotId: "rename",
				model: model.rename,
				view: Modal.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(h, { intent: "outline", attributes }, ["Open dialog", overlay]),
					toContent: (closeAttributes) => [
						dialogHeader(h, {}, [
							dialogTitle(h, { id: Modal.titleId("rename") }, "Rename thread"),
							dialogDescription(h, "Give this thread a name everyone will recognise."),
						]),
						dialogBody(h, [
							h.p(
								[h.Class("text-sm/6")],
								[
									"Thread names show up in the sidebar and in search results. You can change the name again at any time.",
								],
							),
						]),
						dialogFooter(h, [
							dialogClose(h, closeAttributes, ["Cancel"]),
							button(h, {}, ["Save"]),
						]),
					],
				},
				toParentMessage: (message) => Message.GotRenameMessage({ message }),
			}),
		]),
		gallerySection(h, "Alert dialog", [
			h.submodel({
				slotId: "remove",
				model: model.remove,
				view: Modal.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(h, { intent: "danger", attributes }, ["Delete channel", overlay]),
					toContent: (closeAttributes) => [
						dialogHeader(h, {
							title: { id: Modal.titleId("remove"), text: "Delete channel?" },
							description: "Messages in this channel will be removed for everyone.",
						}),
						dialogFooter(h, [
							dialogClose(h, closeAttributes, ["Cancel"]),
							button(h, { intent: "danger" }, ["Delete"]),
						]),
					],
					role: "alertdialog",
					size: "md",
				},
				toParentMessage: (message) => Message.GotRemoveMessage({ message }),
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Dialog", {
	Model,
	init: () => ({ model: { rename: Modal.init("rename"), remove: Modal.init("remove") } }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotRenameMessage: ({ message }) => foldRename(model, message),
			GotRemoveMessage: ({ message }) => foldRemove(model, message),
		}),
	view,
})
