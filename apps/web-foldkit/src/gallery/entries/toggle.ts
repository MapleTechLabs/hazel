import { Record, Schema } from "effect"
import type { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { IconStar } from "../../icons"
import * as Interaction from "../../ui/aria/interaction"
import { toggle, type ToggleOptions } from "../../ui/toggle"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"
import { embedInteraction } from "../interaction"

// MODEL

const Model = Schema.Struct({
	selected: Schema.Record(Schema.String, Schema.Boolean),
	interaction: Interaction.Model,
})
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	PressedToggle: { id: Schema.String },
	GotInteractionMessage: { message: Interaction.Message },
})
type Message = typeof Message.Type

const interaction = embedInteraction<Model, Message>((message) => Message.GotInteractionMessage({ message }))

// UPDATE

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		PressedToggle: ({ id }) => ({
			model: modifyFields(model, {
				selected: (selected) => ({ ...selected, [id]: !(selected[id] ?? false) }),
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
	})

// VIEW

const sizes = ["xs", "sm", "md", "lg"] as const
const squareSizes = ["sq-xs", "sq-sm", "sq-md", "sq-lg"] as const

interface ToggleSpec extends Omit<ToggleOptions<Message>, "isSelected" | "onPress" | "interaction"> {
	readonly id: string
	readonly isSelected?: boolean
	readonly content: (h: HtmlBuilder<Message>) => ReadonlyArray<Html | string>
}

const star = (h: HtmlBuilder<Message>) => IconStar(h)

const sections: ReadonlyArray<readonly [string, ReadonlyArray<ToggleSpec>]> = [
	[
		"Intents",
		[
			{ id: "plain", intent: "plain", content: () => ["Plain"] },
			{ id: "outline", intent: "outline", content: () => ["Outline"] },
			{ id: "plain-selected", intent: "plain", isSelected: true, content: () => ["Plain selected"] },
			{
				id: "outline-selected",
				intent: "outline",
				isSelected: true,
				content: () => ["Outline selected"],
			},
		],
	],
	["Sizes", sizes.map((size) => ({ id: size, intent: "outline", size, content: () => [`Size ${size}`] }))],
	[
		"Square sizes",
		squareSizes.map((size) => ({
			id: size,
			intent: "outline",
			size,
			ariaLabel: `Star ${size}`,
			content: (h) => [star(h)],
		})),
	],
	[
		"Circle and icon",
		[
			{ id: "circle", intent: "outline", isCircle: true, content: () => ["Circle"] },
			{ id: "starred", intent: "outline", isSelected: true, content: (h) => [star(h), "Starred"] },
		],
	],
	[
		"Disabled",
		[
			{ id: "disabled", intent: "outline", isDisabled: true, content: () => ["Disabled"] },
			{
				id: "disabled-selected",
				intent: "outline",
				isDisabled: true,
				isSelected: true,
				content: () => ["Disabled selected"],
			},
		],
	],
]

const view = (model: Model, h: HtmlBuilder<Message>) => {
	const wiring = interaction.wiring(model)
	return galleryFrame(
		h,
		"Toggle",
		sections.map(([title, toggles]) =>
			gallerySection(
				h,
				title,
				toggles.map(({ id, isSelected: _isSelected, content, ...options }) =>
					toggle(
						h,
						{
							...options,
							isSelected: Record.get(model.selected, id).pipe(
								(found) => found._tag === "Some" && found.value,
							),
							onPress: Message.PressedToggle({ id }),
							interaction: { wiring, target: id },
						},
						content(h),
					),
				),
			),
		),
	)
}

export const gallery = defineGallery<Model, Message>("Toggle", {
	Model,
	init: () => ({
		model: {
			selected: Record.fromEntries(
				sections.flatMap(([, toggles]) =>
					toggles.map(({ id, isSelected }) => [id, isSelected ?? false] as const),
				),
			),
			interaction: Interaction.init(),
		},
	}),
	update,
	subscriptions: interaction.subscriptions,
	view,
})
