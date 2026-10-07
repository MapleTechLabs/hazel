import { Option, Record, Schema } from "effect"
import { Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { IconStar } from "../../icons"
import * as Toggle from "../../ui/toggle"
import { defineGallery } from "../define"
import { galleryFrame, gallerySection } from "../frame"

// MODEL

const Model = Schema.Record(Schema.String, Toggle.Model)
type Model = typeof Model.Type

// MESSAGE

const Message = defineMessageUnion({
	GotToggleMessage: { id: Schema.String, message: Toggle.Message },
})
type Message = typeof Message.Type

// UPDATE

const foldToggle = (id: string) =>
	Update.foldChild({
		update: Toggle.update,
		read: (model: Model) => Record.get(model, id),
		write: (model, nextToggle) => ({ ...model, [id]: nextToggle }),
		toParentMessage: (message) => Message.GotToggleMessage({ id, message }),
	})

const update = (model: Model, message: Message) =>
	Message.match<Update.Return<Model, Message>>(message, {
		GotToggleMessage: ({ id, message }) => foldToggle(id)(model, message),
	})

// VIEW

const sizes = ["xs", "sm", "md", "lg"] as const
const squareSizes = ["sq-xs", "sq-sm", "sq-md", "sq-lg"] as const

interface ToggleSpec extends Omit<Toggle.ViewInputs, "content"> {
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

const view = (model: Model, h: HtmlBuilder<Message>) =>
	galleryFrame(
		h,
		"Toggle",
		sections.map(([title, toggles]) =>
			gallerySection(
				h,
				title,
				toggles.flatMap(({ id, isSelected: _isSelected, content, ...viewInputs }) =>
					Option.match(Record.get(model, id), {
						onNone: () => [],
						onSome: (toggle) => [
							h.submodel({
								slotId: id,
								model: toggle,
								view: Toggle.view,
								viewInputs: { ...viewInputs, content: content(h) },
								toParentMessage: (message) => Message.GotToggleMessage({ id, message }),
							}),
						],
					}),
				),
			),
		),
	)

export const gallery = defineGallery<Model, Message>("Toggle", {
	Model,
	init: () => ({
		model: Record.fromEntries(
			sections.flatMap(([, toggles]) =>
				toggles.map(({ id, isSelected }) => [id, Toggle.init({ isSelected })] as const),
			),
		),
	}),
	update,
	view,
})
