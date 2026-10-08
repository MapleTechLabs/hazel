import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { contextMenuTriggerBase } from "~/components/ui/context-menu.styles"
import { IconCopy, IconReply, IconTrash } from "../../icons"
import * as Menu from "../../ui/menu"
import { contextMenuView, menuLabel } from "../../ui/menu-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ message: Menu.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotMessageMenuMessage: { message: Menu.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldMenuOutMessage = Menu.OutMessage.match<Update.Step<Model, Message>>({
	SelectedItem: () => (model) => ({ model }),
	ActivatedLink: () => (model) => ({ model }),
})

const foldMessageMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.message),
	write: (model, nextMenu) => modifyFields(model, { message: () => nextMenu }),
	toParentMessage: (message) => Message.GotMessageMenuMessage({ message }),
	foldOutMessage: foldMenuOutMessage,
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const label = (key: string, text: string) => menuLabel(h, "message", key, text)
	const contentByKey: Record<string, () => ReadonlyArray<Html>> = {
		reply: () => [IconReply(h, { className: "size-4" }), label("reply", "Reply")],
		copy: () => [IconCopy(h, { className: "size-4" }), label("copy", "Copy text")],
		delete: () => [IconTrash(h, { className: "size-4" }), label("delete", "Delete message")],
	}
	return galleryFrame(h, "Context menu", [
		gallerySection(h, "Context menu", [
			h.submodel({
				slotId: "message",
				model: model.message,
				view: contextMenuView,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						h.div(
							[
								...attributes,
								h.Class(
									twMerge(
										contextMenuTriggerBase,
										"flex h-32 w-80 items-center justify-center rounded-lg border border-dashed text-muted-fg text-sm",
									),
								),
							],
							["Right-click this message", overlay],
						),
					content: (key) => contentByKey[key]?.() ?? [],
					className: "min-w-56",
				},
				toParentMessage: (message) => Message.GotMessageMenuMessage({ message }),
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Context menu", {
	Model,
	init: () => ({
		model: {
			message: Menu.init({
				id: "message",
				anchor: "Pointer",
				entries: [
					Menu.item("reply"),
					Menu.item("copy"),
					Menu.separator,
					Menu.item("delete", { intent: "Danger" }),
				],
			}),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotMessageMenuMessage: ({ message }) => foldMessageMenu(model, message),
		}),
	view,
})
