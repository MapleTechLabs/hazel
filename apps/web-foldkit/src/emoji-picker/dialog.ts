import { Schema } from "effect"
import { Command, type Update } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { cn } from "~/lib/utils"
import { pickerPopover, PopoverEvent } from "../picker-popover/popover"
import * as Picker from "./picker"
import { CATEGORY_HEADER_CLASS, pickerView } from "./view"

/**
 * `EmojiPickerDialog`: a DialogTrigger whose Popover holds a Dialog ("Emoji picker") with the
 * picker, the organization's custom emojis and the footer. Selecting closes it.
 */

// MODEL

export const Model = Schema.Struct({ id: Schema.String, isOpen: Schema.Boolean, picker: Picker.Model })
export type Model = typeof Model.Type

export const init = (id: string): Model => ({ id, isOpen: false, picker: Picker.init(id) })

// MESSAGE

export const Message = defineMessageUnion({
	GotPopoverEvent: { event: PopoverEvent },
	GotPickerMessage: { message: Picker.Message },
})
export type Message = typeof Message.Type

export const OutMessage = Picker.OutMessage
export type OutMessage = Picker.OutMessage

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

// UPDATE

const closed = (model: Model): Model => ({ ...model, isOpen: false })

/** Opening mounts a fresh picker (frimousse remounts with the popover), which loads its data. */
const open = (model: Model): Return => ({
	model: { ...model, isOpen: true, picker: Picker.init(model.id) },
	commands: Command.mapMessages([Picker.LoadEmojiData()], (message) => Message.GotPickerMessage({ message })),
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		GotPopoverEvent: ({ event }) =>
			PopoverEvent.match<Return>(event, {
				ClickedTrigger: () => (model.isOpen ? { model: closed(model) } : open(model)),
				ClickedDismiss: () => ({ model: closed(model) }),
				PressedEscape: () => ({ model: closed(model) }),
				PressedOutside: () => ({ model: closed(model) }),
				CompletedPortalPickerPopover: () => ({ model }),
			}),
		GotPickerMessage: ({ message: pickerMessage }) => {
			const result = Picker.update(model.picker, pickerMessage)
			const next = { ...model, picker: result.model }
			const commands = Command.mapMessages(result.commands ?? [], (inner) => Message.GotPickerMessage({ message: inner }))
			// `handleEmojiSelect`: report the emoji, then close.
			return result.outMessage === undefined
				? { model: next, commands }
				: { model: closed(next), commands, outMessage: result.outMessage }
		},
	})

// VIEW

export interface CustomEmoji {
	readonly name: string
	readonly imageUrl: string
}

/** `CustomEmojiSection`: the organization's emojis, filtered by the picker's search. */
const customSection = <M>(
	h: HtmlBuilder<M>,
	model: Picker.Model,
	emojis: ReadonlyArray<CustomEmoji>,
	toMessage: (message: Picker.Message) => M,
): Html => {
	const search = model.search.toLowerCase()
	const filtered = search ? emojis.filter((emoji) => emoji.name.toLowerCase().includes(search)) : emojis
	if (filtered.length === 0) return h.empty
	return h.div(
		[h.Class("border-border border-t")],
		[
			h.div([h.Class(CATEGORY_HEADER_CLASS), h.Attribute("data-slot", "emoji-picker-category-header")], ["Custom"]),
			h.div(
				[h.Class("grid grid-cols-9 gap-0 px-2 pb-2")],
				filtered.map((emoji) =>
					h.keyed("button")(
						emoji.name,
						[
							h.Attribute("type", "button"),
							h.OnClick(toMessage(Picker.Message.ClickedCustomEmoji({ name: emoji.name, imageUrl: emoji.imageUrl }))),
							h.Class(cn("flex size-10 items-center justify-center rounded-md hover:bg-accent")),
							h.Attribute("title", `:${emoji.name}:`),
						],
						[h.img([h.Attribute("src", emoji.imageUrl), h.Attribute("alt", emoji.name), h.Class("size-7 object-contain")])],
					),
				),
			),
		],
	)
}

export interface DialogViewInputs<M> {
	readonly toMessage: (message: Message) => M
	readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	readonly customEmojis: ReadonlyArray<CustomEmoji>
}

export const view = <M>(h: HtmlBuilder<M>, model: Model, inputs: DialogViewInputs<M>): Html => {
	const toPicker = (message: Picker.Message) => inputs.toMessage(Message.GotPickerMessage({ message }))
	return pickerPopover(h, {
		id: model.id,
		isOpen: model.isOpen,
		ariaLabel: "Emoji picker",
		toMessage: (event) => inputs.toMessage(Message.GotPopoverEvent({ event })),
		toTrigger: inputs.toTrigger,
		content: () => [
			h.div(
				[],
				[
					pickerView(h, model.picker, {
						toMessage: toPicker,
						className: "h-[420px]",
						customSection: customSection(h, model.picker, inputs.customEmojis, toPicker),
					}),
				],
			),
		],
	})
}
