import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconGear, IconHashtag, IconMoon, IconPlus } from "../../icons"
import { button } from "../../ui/button"
import * as CommandMenu from "../../ui/command-menu"
import {
	commandMenuDescription,
	commandMenuShortcut,
	view as commandMenuView,
} from "../../ui/command-menu-view"
import { menuLabel } from "../../ui/menu-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Struct({ palette: CommandMenu.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ClickedOpenCommandMenu: {},
	GotPaletteMessage: { message: CommandMenu.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldPaletteOutMessage = CommandMenu.OutMessage.match<Update.Step<Model, Message>>({
	SelectedItem: () => (model) => ({ model }),
	Closed: () => (model) => ({ model }),
})

const paletteFields = {
	read: (model: Model) => Option.some(model.palette),
	write: (model: Model, nextPalette: CommandMenu.Model) =>
		modifyFields(model, { palette: () => nextPalette }),
	toParentMessage: (message: CommandMenu.Message) => Message.GotPaletteMessage({ message }),
}

const foldPalette = Update.foldChild({
	update: CommandMenu.update,
	...paletteFields,
	foldOutMessage: foldPaletteOutMessage,
})
const openPalette = Update.foldChildStep({ update: CommandMenu.open, ...paletteFields })

// VIEW

const ID = "palette"

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const label = (key: string, text: string) => menuLabel(h, ID, key, text)
	const contentByKey: Record<string, () => ReadonlyArray<Html>> = {
		general: () => [IconHashtag(h), label("general", "general")],
		design: () => [
			IconHashtag(h),
			label("design", "design"),
			commandMenuDescription(h, ID, "design", "12 members"),
		],
		create: () => [
			IconPlus(h),
			label("create", "Create channel"),
			commandMenuShortcut(h, ID, "create", "⌘N"),
		],
		appearance: () => [IconMoon(h), label("appearance", "Change appearance")],
		settings: () => [IconGear(h), label("settings", "Settings")],
	}
	return galleryFrame(h, "Command menu", [
		gallerySection(h, "Command menu", [
			button(h, { intent: "outline", attributes: [h.OnClick(Message.ClickedOpenCommandMenu())] }, [
				"Open command menu",
			]),
			h.submodel({
				slotId: "palette",
				model: model.palette,
				view: commandMenuView,
				viewInputs: {
					content: (key) => contentByKey[key]?.() ?? [],
					placeholder: "Where would you like to go?",
				},
				toParentMessage: (message) => Message.GotPaletteMessage({ message }),
			}),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Command menu", {
	Model,
	init: () => ({
		model: {
			palette: CommandMenu.init({
				id: ID,
				sections: [
					CommandMenu.section("Recent", [
						CommandMenu.item("general", "general"),
						CommandMenu.item("design", "design", true),
					]),
					CommandMenu.section("Quick Actions", [
						CommandMenu.item("create", "create channel", true),
						CommandMenu.item("appearance", "appearance theme"),
						CommandMenu.item("settings", "settings"),
					]),
				],
			}),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			ClickedOpenCommandMenu: () => openPalette(model),
			GotPaletteMessage: ({ message }) => foldPalette(model, message),
		}),
	view,
})
