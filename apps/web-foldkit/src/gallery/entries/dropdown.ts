import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconCopy, IconEdit, IconTrash } from "../../icons"
import * as ListBox from "../../ui/list-box"
import {
	dropdownKeyboard,
	listBoxDescription,
	listBoxLabel,
	view as listBoxView,
	withFocusScope,
} from "../../ui/list-box-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

/** `DropdownSection`, `DropdownItem` and friends inside a ListBox, as `dropdown.tsx` is used. */

// MODEL

const Model = Schema.Struct({ actions: ListBox.Model })
type Model = typeof Model.Type

const dropdownItem = (key: string, textValue: string, options: Parameters<typeof ListBox.item>[2] = {}) =>
	ListBox.item(key, textValue, { ...options, flavor: "Dropdown" })

const init = (): Model => ({
	actions: ListBox.init({
		id: "actions",
		entries: [
			ListBox.section("Message", [dropdownItem("edit", "Edit"), dropdownItem("copy", "Copy text")], {
				isListBoxSection: false,
			}),
			ListBox.separator,
			ListBox.section(
				"Danger zone",
				[
					dropdownItem("delete", "Delete", { intent: "danger", hasDescription: true }),
					dropdownItem("archive", "Archive", { intent: "warning", isDisabled: true }),
				],
				{ isListBoxSection: false },
			),
		],
		selectionMode: "single",
		selectedKeys: ["edit"],
	}),
})

// MESSAGE

const Message = defineMessageUnion({
	GotActionsMessage: { message: ListBox.Message },
})
type Message = typeof Message.Type

const toActionsMessage = (message: ListBox.Message) => Message.GotActionsMessage({ message })

// UPDATE

const foldActions = Update.foldChild({
	update: ListBox.update,
	read: (model: Model) => Option.some(model.actions),
	write: (_model: Model, actions: ListBox.Model): Model => ({ actions }),
	toParentMessage: toActionsMessage,
	foldOutMessage: () => (model: Model) => ({ model }),
})

const subscriptions = Subscription.aggregate<Model, Message>()({
	actionsRelease: Subscription.lift(ListBox.subscriptions)<Model, Message>({
		read: (model) => Option.some(model.actions),
		toParentMessage: toActionsMessage,
	}).pointerRelease,
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const icon = { attributes: { "data-slot": "icon" } }
	const label = (key: string, text: string) => listBoxLabel(h, "actions", key, text)
	const content: Record<string, () => ReadonlyArray<Html>> = {
		edit: () => [IconEdit(h, icon), label("edit", "Edit"), dropdownKeyboard(h, "E")],
		copy: () => [IconCopy(h, icon), label("copy", "Copy text"), dropdownKeyboard(h, "⌘C")],
		delete: () => [
			IconTrash(h, icon),
			label("delete", "Delete"),
			listBoxDescription(h, "actions", "delete", "Removes it for everyone"),
		],
		archive: () => [label("archive", "Archive")],
	}
	return galleryFrame(h, "Dropdown", [
		gallerySection(
			h,
			"Items and sections",
			withFocusScope(
				h,
				h.submodel({
					slotId: "actions",
					model: model.actions,
					view: listBoxView,
					viewInputs: {
						ariaLabel: "Message actions",
						className: "w-72",
						content: (key) => content[key]?.() ?? [],
					},
					toParentMessage: toActionsMessage,
				}),
			),
		),
	])
}

export const gallery = defineGallery<Model, Message>("Dropdown", {
	Model,
	init: () => ({ model: init() }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotActionsMessage: ({ message }) => foldActions(model, message),
		}),
	subscriptions,
	view,
})
