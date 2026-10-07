import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../ui/aria/interaction"
import { link, type LinkOptions } from "../../ui/link"
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
	const demo = (target: string, options: LinkOptions<Message> = {}) => ({
		...options,
		interaction: { wiring, target },
	})
	return galleryFrame(h, "Link", [
		gallerySection(h, "With href", [
			link(h, demo("docs", { href: "/dev/gallery/link#docs" }), ["Documentation"]),
			link(h, demo("primary", { href: "/dev/gallery/link#primary", className: "text-primary" }), [
				"Primary text",
			]),
			link(
				h,
				demo("underlined", {
					href: "/dev/gallery/link#underlined",
					className: "underline underline-offset-4",
				}),
				["Underlined"],
			),
		]),
		gallerySection(h, "Without href", [link(h, demo("pressable"), ["Pressable text"])]),
		gallerySection(h, "Disabled", [
			link(h, demo("disabled href", { href: "/dev/gallery/link#disabled", isDisabled: true }), [
				"Disabled with href",
			]),
			link(h, demo("disabled", { isDisabled: true }), ["Disabled without href"]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Link", {
	Model,
	init: () => ({ model: { interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
