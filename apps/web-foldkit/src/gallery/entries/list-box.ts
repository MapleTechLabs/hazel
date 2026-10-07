import { Option, Schema } from "effect"
import { Subscription, Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as ListBox from "../../ui/list-box"
import { listBoxDescription, listBoxLabel, view as listBoxView, withFocusScope } from "../../ui/list-box-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Slot = Schema.Literals(["theme", "notify", "jump"])
type Slot = typeof Slot.Type

const Model = Schema.Struct({ theme: ListBox.Model, notify: ListBox.Model, jump: ListBox.Model })
type Model = typeof Model.Type

const notifyItems: ReadonlyArray<readonly [string, string, string]> = [
	["mentions", "Mentions", "When someone @mentions you"],
	["replies", "Replies", "Replies to your threads"],
	["reactions", "Reactions", "Emoji on your messages"],
	["all", "All messages", "Every new message in the channel"],
]

const init = (): Model => ({
	theme: ListBox.init({
		id: "theme",
		entries: [
			ListBox.entry(ListBox.item("light", "Light")),
			ListBox.entry(ListBox.item("dark", "Dark")),
			ListBox.entry(ListBox.item("system", "System")),
		],
		selectionMode: "single",
		selectedKeys: ["system"],
	}),
	notify: ListBox.init({
		id: "notify",
		entries: notifyItems.map(([key, label]) =>
			ListBox.entry(ListBox.item(key, label, { hasDescription: true, isDisabled: key === "all" })),
		),
		selectionMode: "multiple",
		selectedKeys: ["mentions", "replies"],
	}),
	jump: ListBox.init({
		id: "jump",
		entries: [
			ListBox.section("Channels", [
				ListBox.item("general", "general"),
				ListBox.item("design", "design"),
			]),
			ListBox.section("Direct messages", [
				ListBox.item("grace", "Grace Hopper"),
				ListBox.item("alan", "Alan Turing"),
			]),
		],
		selectionMode: "single",
	}),
})

// MESSAGE

const Message = defineMessageUnion({
	GotListBoxMessage: { slot: Slot, message: ListBox.Message },
})
type Message = typeof Message.Type

// UPDATE

const fold = (slot: Slot) =>
	Update.foldChild({
		update: ListBox.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model: Model, next: ListBox.Model): Model => ({ ...model, [slot]: next }),
		toParentMessage: (message: ListBox.Message) => Message.GotListBoxMessage({ slot, message }),
		foldOutMessage: () => (model: Model) => ({ model }),
	})

const lift = (slot: Slot) =>
	Subscription.lift(ListBox.subscriptions)<Model, Message>({
		read: (model) => Option.some(model[slot]),
		toParentMessage: (message) => Message.GotListBoxMessage({ slot, message }),
	}).pointerRelease

const subscriptions = Subscription.aggregate<Model, Message>()(
	{ themeRelease: lift("theme") },
	{ notifyRelease: lift("notify") },
	{ jumpRelease: lift("jump") },
)

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const listBox = (slot: Slot, viewInputs: Parameters<typeof listBoxView>[1]) =>
		withFocusScope(
			h,
			h.submodel({
				slotId: slot,
				model: model[slot],
				view: listBoxView,
				viewInputs,
				toParentMessage: (message) => Message.GotListBoxMessage({ slot, message }),
			}),
		)
	const notifyContent = (key: string): ReadonlyArray<Html> => {
		const [, label, description] = notifyItems.find(([candidate]) => candidate === key) ?? [key, key, ""]
		return [listBoxLabel(h, "notify", key, label), listBoxDescription(h, "notify", key, description)]
	}
	return galleryFrame(h, "ListBox", [
		gallerySection(h, "Single selection", listBox("theme", { ariaLabel: "Theme", className: "w-64" })),
		gallerySection(
			h,
			"Multiple selection with descriptions",
			listBox("notify", { ariaLabel: "Notify me about", className: "w-72", content: notifyContent }),
		),
		gallerySection(h, "Sections", listBox("jump", { ariaLabel: "Jump to", className: "w-64" })),
	])
}

export const gallery = defineGallery<Model, Message>("ListBox", {
	Model,
	init: () => ({ model: init() }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotListBoxMessage: ({ slot, message }) => fold(slot)(model, message),
		}),
	subscriptions,
	view,
})
