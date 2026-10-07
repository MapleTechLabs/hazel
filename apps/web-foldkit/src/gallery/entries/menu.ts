import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconDots, IconFolder, IconFolderPlus, IconLeave, IconStar, IconVolumeMute } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import { button } from "../../ui/button"
import * as Menu from "../../ui/menu"
import {
	menuDescription,
	menuLabel,
	menuShortcut,
	menuTriggerClassName,
	view as menuView,
} from "../../ui/menu-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	actions: Menu.Model,
	density: Menu.Model,
	more: Menu.Model,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

const actions = Menu.init({
	id: "actions",
	entries: [
		Menu.section("Channel", [
			Menu.item("mute", { hasDescription: true }),
			Menu.item("favorite"),
			Menu.item("move", { submenu: [Menu.leaf("channels"), Menu.leaf("projects")] }),
		]),
		Menu.separator,
		Menu.item("archive", { isDisabled: true }),
		Menu.separator,
		Menu.item("leave", { intent: "Danger", textValue: "Leave" }),
	],
})

const density = Menu.init({
	id: "density",
	entries: [Menu.item("compact"), Menu.item("comfortable", { hasDescription: true })],
	selectionMode: "Single",
	selectedKeys: ["comfortable"],
})

const more = Menu.init({
	id: "more",
	entries: [Menu.item("copy"), Menu.item("edit")],
	placement: "right top",
})

// MESSAGE

const Message = defineMessageUnion({
	GotActionsMessage: { message: Menu.Message },
	GotDensityMessage: { message: Menu.Message },
	GotMoreMessage: { message: Menu.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const foldMenuOutMessage = Menu.OutMessage.match<Update.Step<Model, Message>>({
	SelectedItem: () => (model) => ({ model }),
})

const foldActions = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.actions),
	write: (model, nextActions) => modifyFields(model, { actions: () => nextActions }),
	toParentMessage: (message) => Message.GotActionsMessage({ message }),
	foldOutMessage: foldMenuOutMessage,
})

const foldDensity = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.density),
	write: (model, nextDensity) => modifyFields(model, { density: () => nextDensity }),
	toParentMessage: (message) => Message.GotDensityMessage({ message }),
	foldOutMessage: foldMenuOutMessage,
})

const foldMore = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.more),
	write: (model, nextMore) => modifyFields(model, { more: () => nextMore }),
	toParentMessage: (message) => Message.GotMoreMessage({ message }),
	foldOutMessage: foldMenuOutMessage,
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	const actionsLabel = (key: string, text: string) => menuLabel(h, "actions", key, text)
	const contentByKey: Record<string, () => ReadonlyArray<Html>> = {
		mute: () => [
			IconVolumeMute(h, { className: "size-4" }),
			actionsLabel("mute", "Mute"),
			menuShortcut(h, "actions", "mute", "⌘M"),
		],
		favorite: () => [
			IconStar(h, { className: "size-4 text-muted-fg" }),
			actionsLabel("favorite", "Favorite"),
		],
		move: () => [IconFolderPlus(h, { className: "size-4" }), actionsLabel("move", "Move to section")],
		channels: () => [actionsLabel("channels", "Channels (Default)")],
		projects: () => [actionsLabel("projects", "Projects")],
		archive: () => [IconFolder(h, { className: "size-4" }), actionsLabel("archive", "Archive")],
		leave: () => [IconLeave(h, { className: "size-4" }), actionsLabel("leave", "Leave")],
	}

	return galleryFrame(h, "Menu", [
		gallerySection(h, "Actions", [
			h.submodel({
				slotId: "actions",
				model: model.actions,
				view: menuView,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(
							h,
							{ intent: "outline", attributes, interaction: { wiring, target: "actions" } },
							["Actions", overlay],
						),
					content: (key) => contentByKey[key]?.() ?? [],
					className: "w-56",
				},
				toParentMessage: (message) => Message.GotActionsMessage({ message }),
			}),
		]),
		gallerySection(h, "Selection", [
			h.submodel({
				slotId: "density",
				model: model.density,
				view: menuView,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(
							h,
							{ intent: "outline", attributes, interaction: { wiring, target: "density" } },
							["Density", overlay],
						),
					content: (key) =>
						key === "compact"
							? [menuLabel(h, "density", key, "Compact")]
							: [
									menuLabel(h, "density", key, "Comfortable"),
									menuDescription(h, "density", key, "Roomier rows"),
								],
				},
				toParentMessage: (message) => Message.GotDensityMessage({ message }),
			}),
		]),
		gallerySection(h, "Trigger", [
			h.submodel({
				slotId: "more",
				model: model.more,
				view: menuView,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						h.button(
							[
								...attributes,
								...Interaction.targetAttributes(h, wiring, "more"),
								h.Attribute("aria-label", "More"),
								h.Class(menuTriggerClassName()),
								h.Attribute("data-react-aria-pressable", "true"),
								h.Attribute("data-slot", "menu-trigger"),
								h.Attribute("tabindex", "0"),
								h.Attribute("type", "button"),
							],
							[IconDots(h, { className: "size-4" }), overlay],
						),
					content: (key) => [menuLabel(h, "more", key, key === "copy" ? "Copy link" : "Edit")],
				},
				toParentMessage: (message) => Message.GotMoreMessage({ message }),
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Menu", {
	Model,
	init: () => ({ model: { actions, density, more, interaction: Interaction.init() } }),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotActionsMessage: ({ message }) => foldActions(model, message),
			GotDensityMessage: ({ message }) => foldDensity(model, message),
			GotMoreMessage: ({ message }) => foldMore(model, message),
			GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		}),
	subscriptions: interaction.subscriptions,
	view,
})
