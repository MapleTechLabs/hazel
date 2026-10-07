import { Mount } from "foldkit"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { defineView } from "foldkit/submodel"
import { cn } from "~/lib/utils"
import { cx } from "~/utils/cx"
import { IconEmoji1, IconGif, IconPaperclip2 } from "../icons"
import { autocompletePopover } from "./autocomplete-view"
import { commandInputPanel } from "./trigger-views"
import { type Message, type Model, MountEditor } from "./composer"

/** Port of `SlateMessageComposer`: DropZone > (previews, indicators) > Frame > (Editor, Actions). */

const VISUALLY_HIDDEN =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

const PICKER_BUTTON_CLASS =
	"inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs outline-none transition-colors hover:text-fg"

const ACCEPT = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"

/** What a draft adds around the bare editor; the gallery composer passes none of it. */
export interface BoxExtras<M> {
	readonly toMessage: (message: Message) => M
	/** Attachment previews, reply and edit indicators, above the frame. */
	readonly topContent?: ReadonlyArray<Html>
	readonly hasTopContent?: boolean
	/** The drop zone's overlay ("Drop files here"). */
	readonly dropOverlay?: Html
	readonly dropZoneAttributes?: ReadonlyArray<Attribute<M>>
	readonly fileInputAttributes?: ReadonlyArray<Attribute<M>>
	readonly attachAttributes?: ReadonlyArray<Attribute<M>>
	/** DialogTrigger buttons with their pickers: (attributes, overlay) wiring per button. */
	readonly gifTrigger?: (render: PickerButton) => Html
	readonly emojiTrigger?: (render: PickerButton) => Html
}

export type PickerButton = (attributes: ReadonlyArray<Attribute<never>>, overlay: Html) => Html

/** The GIF and Emoji `AriaButton`s (DialogTrigger children). */
const pickerButton =
	<M>(h: HtmlBuilder<M>, label: "GIF" | "Emoji"): PickerButton =>
	(attributes, overlay) =>
		h.button(
			[
				...(attributes as ReadonlyArray<Attribute<M>>),
				h.Class(PICKER_BUTTON_CLASS),
				h.Attribute("data-rac", ""),
				h.Attribute("data-react-aria-pressable", "true"),
				h.Attribute("tabindex", "0"),
				h.Attribute("type", "button"),
			],
			[(label === "GIF" ? IconGif : IconEmoji1)(h, { className: "size-4 text-muted-fg" }), label, overlay],
		)

const closedPicker =
	<M>(h: HtmlBuilder<M>) =>
	(render: PickerButton) =>
		render([h.Attribute("aria-expanded", "false") as Attribute<never>], h.empty)

/** `ComposerActions`: hidden file input, then Attach, GIF and Emoji. */
const actions = <M>(h: HtmlBuilder<M>, extras: BoxExtras<M>): Array<Html> => [
	h.input([
		h.Attribute("type", "file"),
		h.Attribute("multiple", ""),
		h.Class("hidden"),
		h.Attribute("accept", ACCEPT),
		h.Attribute("aria-label", "File upload"),
		...(extras.fileInputAttributes ?? []),
	]),
	h.div(
		[h.Class(cn("flex w-full items-center justify-between gap-3 px-3 py-2"))],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					h.button(
						[
							h.Attribute("type", "button"),
							h.Class(
								"inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs transition-colors hover:text-fg disabled:opacity-50",
							),
							...(extras.attachAttributes ?? []),
						],
						[IconPaperclip2(h, { className: "size-4 text-muted-fg" }), "Attach"],
					),
					(extras.gifTrigger ?? closedPicker(h))(pickerButton(h, "GIF")),
					(extras.emojiTrigger ?? closedPicker(h))(pickerButton(h, "Emoji")),
				],
			),
		],
	),
]

/** The whole composer box for a composer Model, in the parent's Message type. */
export const composerBoxView = <M>(h: HtmlBuilder<M>, model: Model, extras: BoxExtras<M>): Html =>
	h.div(
		[h.Class("relative"), h.Attribute("data-rac", ""), ...(extras.dropZoneAttributes ?? [])],
		[
			h.div(
				[h.Attribute("style", VISUALLY_HIDDEN)],
				[
					h.button([
						h.Attribute("aria-label", "DropZone"),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("tabindex", "0"),
						h.Attribute("type", "button"),
					]),
				],
			),
			h.div(
				[h.Class("relative flex h-max items-center gap-3")],
				[
					extras.dropOverlay ?? h.empty,
					h.div(
						[h.Class("w-full")],
						[
							...(extras.topContent ?? []),
							h.div(
								[
									h.Class(
										cn(
											"relative inset-ring inset-ring-secondary flex h-max flex-col rounded-xl bg-secondary",
											(extras.hasTopContent ?? false) && "rounded-t-none",
										),
									),
								],
								[
									h.div(
										// Command input replaces the editor in legacy; ours stays mounted, hidden.
										[h.Class(cx("relative w-full", model.commandInput !== null && "[&>[role=combobox]]:hidden"))],
										[
											model.commandInput === null
												? autocompletePopover(h, model, extras.toMessage)
												: commandInputPanel(h, model.editorId, model.commandInput, extras.toMessage),
											// ProseMirror owns this element's attributes and children.
											h.keyed("div")("editor", [
												h.OnMount(
													Mount.mapMessage(
														MountEditor({ editorId: model.editorId, placeholder: model.placeholder }),
														extras.toMessage,
													),
												),
											]),
										],
									),
									...actions(h, extras),
								],
							),
						],
					),
				],
			),
		],
	)

const identity = (message: Message) => message

/** The bare composer (the gallery entry). */
export const view = defineView<Model, Message>((model, h) => composerBoxView(h, model, { toMessage: identity }))
