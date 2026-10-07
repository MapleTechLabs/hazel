import { Option, Schema } from "effect"
import { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as Interaction from "../../ui/aria/interaction"
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
import * as Sheet from "../../ui/sheet"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({ details: Modal.Model, navigation: Modal.Model, interaction: Interaction.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotDetailsMessage: { message: Modal.Message },
	GotNavigationMessage: { message: Modal.Message },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const foldDetails = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(model.details),
	write: (model, nextDetails) => modifyFields(model, { details: () => nextDetails }),
	toParentMessage: (message) => Message.GotDetailsMessage({ message }),
})

const foldNavigation = Update.foldChild({
	update: Modal.update,
	read: (model: Model) => Option.some(model.navigation),
	write: (model, nextNavigation) => modifyFields(model, { navigation: () => nextNavigation }),
	toParentMessage: (message) => Message.GotNavigationMessage({ message }),
})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(h, "Sheet", [
		gallerySection(h, "Sheet", [
			h.submodel({
				slotId: "details",
				model: model.details,
				view: Sheet.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(
							h,
							{
								intent: "outline",
								attributes,
								interaction: { wiring: interaction.wiring(model), target: "open-sheet" },
							},
							["Open sheet", overlay],
						),
					toContent: (closeAttributes) => [
						dialogHeader(h, {}, [
							dialogTitle(h, { id: Modal.titleId("details") }, "Channel details"),
							dialogDescription(h, "Members, files and settings for this channel."),
						]),
						dialogBody(h, [
							h.p([h.Class("text-sm/6")], ["Twelve members have access to this channel."]),
						]),
						dialogFooter(h, [dialogClose(h, closeAttributes, ["Close"])]),
					],
				},
				toParentMessage: (message) => Message.GotDetailsMessage({ message }),
			}),
			h.submodel({
				slotId: "navigation",
				model: model.navigation,
				view: Sheet.view,
				viewInputs: {
					toTrigger: (attributes, overlay) =>
						button(
							h,
							{
								intent: "outline",
								attributes,
								interaction: { wiring: interaction.wiring(model), target: "open-left-sheet" },
							},
							["Open left sheet", overlay],
						),
					toContent: () => [
						dialogHeader(h, {
							title: { id: Modal.titleId("navigation"), text: "Navigation" },
							description: "Jump to a channel.",
						}),
					],
					side: "left",
					isFloat: false,
				},
				toParentMessage: (message) => Message.GotNavigationMessage({ message }),
			}),
		]),
	])

export const gallery = defineGallery<Model, Message>("Sheet", {
	Model,
	init: () => ({
		model: {
			interaction: Interaction.init(),
			details: Modal.init("details"),
			navigation: Modal.init("navigation"),
		},
	}),
	update: (model, message) =>
		Message.match<Update.Return<Model, Message>>(message, {
			GotInteractionMessage: ({ message }) => interaction.fold(model, message),
			GotDetailsMessage: ({ message }) => foldDetails(model, message),
			GotNavigationMessage: ({ message }) => foldNavigation(model, message),
		}),
	subscriptions: interaction.subscriptions,
	view,
})
