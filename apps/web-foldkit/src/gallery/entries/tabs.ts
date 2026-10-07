import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconGear, IconUsers } from "../../icons"
import * as Tabs from "../../ui/tabs"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({
	horizontal: Tabs.Model,
	vertical: Tabs.Model,
	icons: Tabs.Model,
	long: Tabs.Model,
})
type Model = typeof Model.Type
type Slot = keyof Model

// MESSAGE

const Message = defineMessageUnion({
	GotTabsMessage: {
		slot: Schema.Literals(["horizontal", "vertical", "icons", "long"]),
		message: Tabs.Message,
	},
})
type Message = typeof Message.Type

// UPDATE

const foldTabs = (slot: Slot) =>
	Update.foldChild({
		update: Tabs.update,
		read: (model: Model) => Option.some(model[slot]),
		write: (model, nextTabs) => ({ ...model, [slot]: nextTabs }),
		toParentMessage: (message) => Message.GotTabsMessage({ slot, message }),
	})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotTabsMessage: ({ slot, message }) => foldTabs(slot)(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const tabs = (slot: Slot, viewInputs: Tabs.ViewInputs) =>
		h.submodel({
			slotId: slot,
			model: model[slot],
			view: Tabs.view,
			viewInputs,
			toParentMessage: (message) => Message.GotTabsMessage({ slot, message }),
		})
	const simple = (labels: ReadonlyArray<readonly [string, string]>, disabledKey?: string) => ({
		tabs: labels.map(([key, label]) => ({ key, content: [label], isDisabled: key === disabledKey })),
		panels: labels.map(([key, label]) => ({ key, content: [`${label} panel`] })),
	})
	const iconAttributes = { attributes: { "data-slot": "icon" } }

	return galleryFrame(h, "Tabs", [
		gallerySection(h, "Horizontal", [
			tabs("horizontal", {
				listLabel: "Workspace sections",
				...simple(
					[
						["overview", "Overview"],
						["members", "Members"],
						["billing", "Billing"],
						["integrations", "Integrations"],
					],
					"billing",
				),
			}),
		]),
		gallerySection(h, "Vertical", [
			tabs("vertical", {
				listLabel: "Account sections",
				...simple(
					[
						["profile", "Profile"],
						["security", "Security"],
						["sessions", "Sessions"],
						["notifications", "Notifications"],
					],
					"sessions",
				),
			}),
		]),
		gallerySection(h, "Icons, preselected", [
			tabs("icons", {
				listLabel: "Team sections",
				tabs: [
					{ key: "people", content: [IconUsers(h, iconAttributes), "People"] },
					{ key: "settings", content: [IconGear(h, iconAttributes), "Preferences"] },
				],
				panels: [
					{ key: "people", content: ["People panel"] },
					{ key: "settings", content: ["Preferences panel"] },
				],
			}),
		]),
		gallerySection(h, "Long labels", [
			tabs("long", {
				listLabel: "Long sections",
				tabs: [
					{ key: "first", content: ["Notification delivery preferences and schedules"] },
					{ key: "second", content: ["Connected third-party integrations"] },
				],
				panels: [
					{ key: "first", content: ["First long panel"] },
					{ key: "second", content: ["Second long panel"] },
				],
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Tabs", {
	Model,
	init: () => ({
		model: {
			horizontal: Tabs.init({ id: "tabs-horizontal", selectedKey: "overview" }),
			vertical: Tabs.init({ id: "tabs-vertical", selectedKey: "profile", orientation: "vertical" }),
			icons: Tabs.init({ id: "tabs-icons", selectedKey: "settings" }),
			long: Tabs.init({ id: "tabs-long", selectedKey: "first" }),
		},
	}),
	update,
	view,
})
