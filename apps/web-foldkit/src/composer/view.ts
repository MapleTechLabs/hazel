import { Mount } from "foldkit"
import {
	type Attribute,
	type ChildAttribute,
	childAttributes,
	type Html,
	type HtmlBuilder,
} from "foldkit/html"
import { cn } from "~/lib/utils"
import { cx } from "~/utils/cx"
import { IconEmoji1, IconGif, IconPaperclip2 } from "../icons"
import { ACCEPT_ATTRIBUTE } from "../editor/file-types"
import { autocompletePopover } from "./autocomplete-view"
import { commandInputPanel } from "./trigger-views"
import { type Message, type Model, MountEditor } from "./composer"

/** Port of `SlateMessageComposer`: DropZone > (previews, indicators) > Frame > (Editor, Actions). */

const PICKER_BUTTON_CLASS =
	"inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs outline-none transition-colors hover:text-fg"

/** What a draft adds around the bare editor. */
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

export type PickerButton = (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html

/** The GIF and Emoji `AriaButton`s (DialogTrigger children); the picker renders beside its button, not in it. */
const pickerButton =
	<M>(h: HtmlBuilder<M>, label: "GIF" | "Emoji"): PickerButton =>
	(attributes, overlay) =>
		h.div(
			[h.Class("contents")],
			[
				h.button(
					[
						...attributes,
						h.Class(PICKER_BUTTON_CLASS),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("tabindex", "0"),
						h.Attribute("type", "button"),
					],
					[
						(label === "GIF" ? IconGif : IconEmoji1)(h, { className: "size-4 text-muted-fg" }),
						label,
					],
				),
				overlay,
			],
		)

const closedPicker =
	<M>(h: HtmlBuilder<M>) =>
	(render: PickerButton) =>
		render(childAttributes([h.Attribute("aria-expanded", "false")]), h.empty)

/** `ComposerActions`: hidden file input, then Attach, GIF and Emoji. */
const actions = <M>(h: HtmlBuilder<M>, extras: BoxExtras<M>): Array<Html> => [
	h.input([
		h.Attribute("type", "file"),
		h.Attribute("multiple", ""),
		h.Class("hidden"),
		h.Attribute("accept", ACCEPT_ATTRIBUTE),
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
		[h.Class("relative"), ...(extras.dropZoneAttributes ?? [])],
		[
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
										[
											h.Class(
												cx(
													"relative w-full",
													model.commandInput !== null &&
														"[&>[role=combobox]]:hidden",
												),
											),
										],
										[
											model.commandInput === null
												? autocompletePopover(h, model, extras.toMessage)
												: commandInputPanel(
														h,
														model.editorId,
														model.commandInput,
														extras.toMessage,
													),
											// ProseMirror owns this element's attributes and children.
											h.keyed("div")("editor", [
												h.OnMount(
													Mount.mapMessage(
														MountEditor({
															editorId: model.editorId,
															placeholder: model.placeholder,
															initialMarkdown: model.markdown,
														}),
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
