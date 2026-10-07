import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Mount, type Update } from "foldkit"
import { type ChildAttribute, childAttributes, type Html, type HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { cn } from "~/lib/utils"
import { dismissButton, focusScopeSentinel, openModalPopover, popoverUnderlay } from "../ui/aria/overlay"
import * as Picker from "./picker"
import { CATEGORY_HEADER_CLASS, pickerView } from "./view"

/**
 * `EmojiPickerDialog`: a React Aria DialogTrigger whose Popover holds a Dialog ("Emoji picker")
 * with the picker, the organization's custom emojis and the footer. Selecting closes it.
 */

// MODEL

export const Model = Schema.Struct({ id: Schema.String, isOpen: Schema.Boolean, picker: Picker.Model })
export type Model = typeof Model.Type

export const init = (id: string): Model => ({ id, isOpen: false, picker: Picker.init(id) })

// MESSAGE

export const Message = defineMessageUnion({
	ClickedTrigger: {},
	ClickedDismiss: {},
	PressedEscape: {},
	PressedOutside: {},
	CompletedPortalEmojiPicker: {},
	GotPickerMessage: { message: Picker.Message },
})
export type Message = typeof Message.Type

export const OutMessage = Picker.OutMessage
export type OutMessage = Picker.OutMessage

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const triggerId = (id: string) => `${id}-trigger`
const popoverId = (id: string) => `${id}-popover`
const dialogId = (id: string) => `${id}-dialog`

// UPDATE

const closed = (model: Model): Model => ({ ...model, isOpen: false })

/** Opening mounts a fresh picker (frimousse remounts with the popover), which loads its data. */
const open = (model: Model): Return => ({
	model: { ...model, isOpen: true, picker: Picker.init(model.id) },
	commands: Command.mapMessages([Picker.LoadEmojiData()], (message) => Message.GotPickerMessage({ message })),
})

export const update = (model: Model, message: Message): Return =>
	Message.match<Return>(message, {
		ClickedTrigger: () => (model.isOpen ? { model: closed(model) } : open(model)),
		ClickedDismiss: () => ({ model: closed(model) }),
		PressedEscape: () => ({ model: closed(model) }),
		PressedOutside: () => ({ model: closed(model) }),
		CompletedPortalEmojiPicker: () => ({ model }),
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

// MOUNT

type PortalMessage = typeof Message.CompletedPortalEmojiPicker.Type | typeof Message.PressedOutside.Type

const PortalEmojiPicker = Mount.defineStream("PortalEmojiPicker", {
	args: { id: Schema.String },
	messages: [Message.CompletedPortalEmojiPicker, Message.PressedOutside],
	execute: ({ element, id }) =>
		Stream.callback<PortalMessage>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const release = openModalPopover(element, {
						triggerId: triggerId(id),
						placement: "bottom",
						offset: 8,
						initialFocusId: dialogId(id),
						insideSelector: `#${CSS.escape(popoverId(id))}`,
						onInteractOutside: () => Queue.offerUnsafe(queue, Message.PressedOutside()),
					})
					Queue.offerUnsafe(queue, Message.CompletedPortalEmojiPicker())
					return release
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.flatMap(() => Effect.never)),
		),
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
	/** The DialogTrigger's child: spread `attributes` on the button and put `overlay` last. */
	readonly toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
	readonly customEmojis: ReadonlyArray<CustomEmoji>
}

const popoverOverlay = <M>(h: HtmlBuilder<M>, model: Model, inputs: DialogViewInputs<M>): Html => {
	const { toMessage } = inputs
	const toPicker = (message: Picker.Message) => toMessage(Message.GotPickerMessage({ message }))
	return h.div(
		[
			h.Attribute("style", "display: contents;"),
			h.OnMount(Mount.mapMessage(PortalEmojiPicker({ id: model.id }), toMessage)),
		],
		[
			focusScopeSentinel(h, "start"),
			popoverUnderlay(h),
			h.div(
				[h.Attribute("style", "display: contents;")],
				[
					h.div(
						[
							h.Attribute("aria-labelledby", triggerId(model.id)),
							h.Class("react-aria-Popover"),
							h.Attribute("data-popover", ""),
							h.Attribute("data-rac", ""),
							h.Attribute("data-trigger", "DialogTrigger"),
							h.Attribute("dir", "ltr"),
							h.Id(popoverId(model.id)),
							h.OnKeyDownPreventDefault((key) =>
								key === "Escape" ? Option.some(toMessage(Message.PressedEscape())) : Option.none(),
							),
						],
						[
							dismissButton(h, toMessage(Message.ClickedDismiss())),
							h.section(
								[
									h.Attribute("aria-label", "Emoji picker"),
									h.Class("rounded-lg"),
									h.Attribute("data-rac", ""),
									h.Id(dialogId(model.id)),
									h.Role("dialog"),
									h.Attribute("tabindex", "-1"),
								],
								[
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
							),
							dismissButton(h, toMessage(Message.ClickedDismiss())),
						],
					),
				],
			),
			focusScopeSentinel(h, "end"),
		],
	)
}

export const view = <M>(h: HtmlBuilder<M>, model: Model, inputs: DialogViewInputs<M>): Html =>
	inputs.toTrigger(
		childAttributes([
			...(model.isOpen ? [h.Attribute("aria-controls", dialogId(model.id))] : []),
			h.Attribute("aria-expanded", model.isOpen ? "true" : "false"),
			...(model.isOpen ? [h.Attribute("data-pressed", "true")] : []),
			h.Id(triggerId(model.id)),
			h.OnClick(inputs.toMessage(Message.ClickedTrigger())),
		]),
		model.isOpen ? popoverOverlay(h, model, inputs) : h.empty,
	)
