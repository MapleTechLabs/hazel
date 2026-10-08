import { Schema } from "effect"
import type { Update } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconPlus } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import { button, type ButtonOptions } from "../../ui/button"
import { loader } from "../../ui/loader"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	lastClicked: Schema.NullOr(Schema.String),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	ClickedButton: { label: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		ClickedButton: ({ label }) => ({ model: modifyFields(model, { lastClicked: () => label }) }),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const intents = ["primary", "secondary", "warning", "danger", "outline", "plain"] as const
const sizes = ["xs", "sm", "md", "lg"] as const
const squareSizes = ["sq-xs", "sq-sm", "sq-md", "sq-lg"] as const

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	// Every button gets its own interaction target; the label doubles as the target id.
	const demo = (label: string, options: ButtonOptions<Message> = {}) => ({
		...options,
		onPress: Message.ClickedButton({ label }),
		interaction: { wiring, target: label },
	})
	const ariaLabel = (label: string) => [h.AriaLabel(label)]
	return galleryFrame(h, "Button", [
		gallerySection(
			h,
			"Intents",
			intents.map((intent) => button(h, demo(intent, { intent }), [intent])),
		),
		gallerySection(
			h,
			"Sizes",
			sizes.map((size) => button(h, demo(`size ${size}`, { size }), [`Size ${size}`])),
		),
		gallerySection(h, "Circle", [
			button(h, demo("circle", { isCircle: true }), ["Circle"]),
			button(h, demo("circle outline", { isCircle: true, intent: "outline" }), ["Circle outline"]),
		]),
		gallerySection(h, "Icons", [
			...sizes.map((size) =>
				button(h, demo(`add ${size}`, { size, intent: "outline" }), [IconPlus(h), `Add ${size}`]),
			),
			button(h, demo("trailing", { intent: "secondary" }), ["Trailing", IconPlus(h)]),
		]),
		gallerySection(h, "Square sizes", [
			...squareSizes.map((size) =>
				button(
					h,
					{
						...demo(`add ${size}`, { size, intent: "outline" }),
						attributes: ariaLabel(`Add ${size}`),
					},
					[IconPlus(h)],
				),
			),
			button(
				h,
				{
					...demo("add circle", { size: "sq-md", isCircle: true }),
					attributes: ariaLabel("Add circle"),
				},
				[IconPlus(h)],
			),
		]),
		gallerySection(
			h,
			"Disabled",
			intents.map((intent) =>
				button(h, demo(`disabled ${intent}`, { intent, isDisabled: true }), [`Disabled ${intent}`]),
			),
		),
		gallerySection(h, "Pending", [
			button(h, demo("saving", { isPending: true }), [loader(h), "Saving"]),
			button(h, demo("loading", { intent: "outline", isPending: true }), [
				loader(h, { variant: "ring" }),
				"Loading",
			]),
		]),
	])
}

export const gallery = defineGallery<Model, Message>("Button", {
	Model,
	init: () => ({ model: { lastClicked: null, interaction: Interaction.init() } }),
	update,
	view,
	subscriptions: interaction.subscriptions,
})
