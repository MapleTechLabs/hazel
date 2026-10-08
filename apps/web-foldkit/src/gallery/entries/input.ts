import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconMagnifier3 } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import { button } from "../../ui/button"
import { input, inputGroup } from "../../ui/input"
import { loader } from "../../ui/loader"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({ interaction: Interaction.Model })
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	const at = (target: string) => ({ wiring, target })
	const labelled = (label: string) => [h.AriaLabel(label)]
	const box = (child: ReturnType<typeof input>) => h.div([h.Class("w-64")], [child])
	return galleryFrame(h, "Input", [
		gallerySection(h, "Plain", [
			box(
				input(h, {
					placeholder: "Placeholder",
					interaction: at("name"),
					attributes: labelled("Name"),
				}),
			),
			box(
				input(h, {
					defaultValue: "Ada Lovelace",
					interaction: at("filled"),
					attributes: labelled("Filled"),
				}),
			),
			box(
				input(h, {
					defaultValue: "Disabled",
					isDisabled: true,
					interaction: at("disabled"),
					attributes: labelled("Disabled"),
				}),
			),
			box(
				input(h, {
					defaultValue: "Invalid",
					isInvalid: true,
					interaction: at("invalid"),
					attributes: labelled("Invalid"),
				}),
			),
		]),
		gallerySection(h, "Groups", [
			box(
				inputGroup(h, { interaction: at("group search") }, [
					IconMagnifier3(h),
					input(h, {
						placeholder: "Search",
						interaction: at("search"),
						attributes: labelled("Leading icon"),
					}),
				]),
			),
			box(
				inputGroup(h, { interaction: at("group loader") }, [
					input(h, {
						placeholder: "Loading",
						interaction: at("loading"),
						attributes: labelled("Trailing loader"),
					}),
					loader(h),
				]),
			),
			box(
				inputGroup(h, { interaction: at("group prefix") }, [
					h.span([h.DataAttribute("slot", "text")], ["https://"]),
					input(h, {
						placeholder: "example.com",
						interaction: at("prefix"),
						attributes: labelled("Prefix text"),
					}),
				]),
			),
			box(
				inputGroup(h, { interaction: at("group button") }, [
					input(h, {
						placeholder: "Invite by email",
						interaction: at("invite"),
						attributes: labelled("With button"),
					}),
					button(h, { intent: "outline", interaction: at("send") }, ["Send"]),
				]),
			),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Input", {
	Model,
	init: () => ({ model: { interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
