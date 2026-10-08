import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconHashtag, IconLock } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import { button } from "../../ui/button"
import * as CommandMenu from "../../ui/command-menu"
import {
	commandMenuFormBody,
	commandMenuFormContainer,
	commandMenuFormField,
	commandMenuFormFooter,
	commandMenuFormHeader,
	commandMenuInput,
	commandMenuToggle,
} from "../../ui/command-menu-form"
import { view as commandMenuView } from "../../ui/command-menu-view"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	palette: CommandMenu.Model,
	name: Schema.String,
	visibility: Schema.String,
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ClickedCreateChannel: {},
	ClickedBack: {},
	ChangedName: { value: Schema.String },
	ChangedVisibility: { value: Schema.String },
	GotPaletteMessage: { message: CommandMenu.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

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
const closePalette = Update.foldChildStep({ update: CommandMenu.close, ...paletteFields })

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Command menu form", [
		gallerySection(h, "Command menu form", [
			button(
				h,
				{
					intent: "outline",
					attributes: [h.OnClick(Message.ClickedCreateChannel())],
					interaction: { wiring: interaction.wiring(model), target: "create-channel" },
				},
				["Create channel"],
			),
			h.submodel({
				slotId: "palette",
				model: model.palette,
				view: commandMenuView,
				viewInputs: {
					content: () => [],
					toFormPage: (closeAttributes) => [
						commandMenuFormContainer(h, [
							commandMenuFormHeader(h, {
								title: "Create channel",
								subtitle: "Channels are where your team talks",
								backAttributes: [h.OnClick(Message.ClickedBack())],
								closeAttributes,
							}),
							commandMenuFormBody(
								h,
								[
									commandMenuFormField(h, { label: "Name" }, [
										commandMenuInput(h, {
											icon: IconHashtag(h, { className: "size-4" }),
											attributes: [
												h.Attribute("aria-label", "Name"),
												h.Attribute("placeholder", "e.g. design-reviews"),
												h.Value(model.name),
												h.OnInput((value) => Message.ChangedName({ value })),
											],
										}),
									]),
									commandMenuFormField(
										h,
										{
											label: "Visibility",
											error: "Private channels need at least one member.",
										},
										[
											commandMenuToggle(h, {
												name: "visibility",
												value: model.visibility,
												options: [
													{
														value: "public",
														label: "Public",
														icon: IconHashtag(h, { className: "size-4" }),
													},
													{
														value: "private",
														label: "Private",
														icon: IconLock(h, { className: "size-4" }),
													},
												],
												onChange: (value) => Message.ChangedVisibility({ value }),
											}),
										],
									),
								],
								"space-y-3",
							),
							commandMenuFormFooter(h, [
								h.span([], [h.kbd([], ["↵"]), " to create"]),
								button(h, { size: "xs" }, ["Create"]),
							]),
						]),
					],
				},
				toParentMessage: (message) => Message.GotPaletteMessage({ message }),
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Command menu form", {
	Model,
	init: () => ({
		model: {
			palette: CommandMenu.init({ id: "create", sections: [] }),
			name: "",
			visibility: "public",
			interaction: Interaction.init(),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			ClickedCreateChannel: () => openPalette(model),
			ClickedBack: () => closePalette(model),
			ChangedName: ({ value }) => ({ model: modifyFields(model, { name: () => value }) }),
			ChangedVisibility: ({ value }) => ({ model: modifyFields(model, { visibility: () => value }) }),
			GotPaletteMessage: ({ message }) => foldPalette(model, message),
			GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		}),
	subscriptions: interaction.subscriptions,
	view,
})
