import type { Html, HtmlBuilder } from "foldkit/html"
import { defineView } from "foldkit/submodel"
import { cn } from "~/lib/utils"
import { cx } from "~/utils/cx"
import { getStatusDotColor } from "~/utils/status"
import { IconEmoji1, IconGif, IconPaperclip2 } from "../icons"
import { avatar } from "../ui/avatar"
import { KeepEditorFocus, type Message, Message as Messages, type Model, MountEditor } from "./composer"
import { clampedActiveIndex, type MentionOption, mentionOptions } from "./update"

/** Port of `SlateMessageComposer`: DropZone > Frame > (Editor, Actions), no draft extras. */

const VISUALLY_HIDDEN =
	"border: 0px; clip: rect(0px, 0px, 0px, 0px); clip-path: inset(50%); height: 1px; margin: -1px; overflow: hidden; padding: 0px; position: absolute; width: 1px; white-space: nowrap;"

const ACTION_CLASS =
	"inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs outline-none transition-colors hover:text-fg"

/** `AvatarOnlineIndicator` at size xs, inside `AvatarBadge`. */
const statusDot = (h: HtmlBuilder<Message>, status: string) =>
	h.span([
		h.Class(cx("absolute right-0 bottom-0 rounded-full ring-[1.5px] ring-bg", getStatusDotColor(status), "size-1.5")),
	])

/** `MentionItem` from `triggers/mention-trigger.tsx`. */
const mentionItem = (h: HtmlBuilder<Message>, option: MentionOption): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			option.type === "user"
				? avatar(h, {
						size: "xs",
						src: option.avatarUrl,
						seed: option.displayName,
						alt: option.displayName,
						...(option.status ? { badge: statusDot(h, option.status) } : {}),
					})
				: h.div(
						[
							h.Class(
								"flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-medium text-primary-fg text-xs",
							),
						],
						["@"],
					),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div([h.Class("truncate font-medium")], [option.type === "user" ? option.label : `@${option.displayName}`]),
					...(option.description
						? [h.div([h.Class("truncate text-muted-fg text-xs")], [option.description])]
						: []),
				],
			),
		],
	)

/** `EditorAutocomplete` + `AutocompleteListBox` for the mention trigger. */
const autocompletePopover = (h: HtmlBuilder<Message>, model: Model): Html => {
	const options = mentionOptions(model)
	const activeIndex = clampedActiveIndex(model)
	return h.keyed("div")(
		"autocomplete",
		[
			h.Role("listbox"),
			h.OnMount(KeepEditorFocus()),
			h.Class(
				cx(
					"absolute right-0 bottom-full left-0 z-50 mb-2",
					"overflow-y-auto overflow-x-hidden rounded-xl",
					"border border-fg/10 bg-overlay shadow-lg",
					"fade-in slide-in-from-bottom-2 animate-in duration-150",
				),
			),
		],
		[
			options.length === 0
				? h.div([h.Class("p-4 text-center text-muted-fg text-sm")], ["No users found"])
				: h.div(
						[h.Class(cx("p-2 outline-none"))],
						options.map((option, index) => {
							const isActive = index === activeIndex
							return h.keyed("div")(
								option.id,
								[
									h.Role("option"),
									h.Attribute("aria-selected", String(isActive)),
									h.OnClick(Messages.ClickedAutocompleteOption({ index })),
									h.OnMouseEnter(Messages.HoveredAutocompleteOption({ index })),
									h.Class(
										cx(
											"flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
											"outline-none transition-colors",
											isActive && "bg-primary/10 text-primary",
											!isActive && "hover:bg-muted",
										),
									),
								],
								[mentionItem(h, option)],
							)
						}),
					),
		],
	)
}

const actions = (h: HtmlBuilder<Message>): Array<Html> => [
	h.input([
		h.Attribute("type", "file"),
		h.Attribute("multiple", ""),
		h.Class("hidden"),
		h.Attribute("accept", "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"),
		h.Attribute("aria-label", "File upload"),
	]),
	h.div(
		[h.Class(cn("flex w-full items-center justify-between gap-3 px-3 py-2"))],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					// Phase 4: uploads and the GIF and emoji pickers.
					h.button(
						[
							h.Attribute("type", "button"),
							h.Class(
								"inline-flex items-center gap-1.5 rounded-xs p-0 font-semibold text-muted-fg text-xs transition-colors hover:text-fg disabled:opacity-50",
							),
						],
						[IconPaperclip2(h, { className: "size-4 text-muted-fg" }), "Attach"],
					),
					...(
						[
							["GIF", IconGif],
							["Emoji", IconEmoji1],
						] as const
					).map(([label, icon]) =>
						h.button(
							[
								h.Attribute("aria-expanded", "false"),
								h.Class(ACTION_CLASS),
								h.Attribute("data-rac", ""),
								h.Attribute("data-react-aria-pressable", "true"),
								h.Attribute("tabindex", "0"),
								h.Attribute("type", "button"),
							],
							[icon(h, { className: "size-4 text-muted-fg" }), label],
						),
					),
				],
			),
		],
	),
]

export const view = defineView<Model, Message>((model, h) =>
	h.div(
		[h.Class("relative"), h.Attribute("data-rac", "")],
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
					h.div(
						[h.Class("w-full")],
						[
							h.div(
								[h.Class(cn("relative inset-ring inset-ring-secondary flex h-max flex-col rounded-xl bg-secondary"))],
								[
									h.div(
										[h.Class(cx("relative w-full"))],
										[
											...(model.autocomplete?.trigger === "mention" ? [autocompletePopover(h, model)] : []),
											// ProseMirror owns this element's attributes and children.
											h.keyed("div")("editor", [
												h.OnMount(MountEditor({ editorId: model.editorId, placeholder: model.placeholder })),
											]),
										],
									),
									...actions(h),
								],
							),
						],
					),
				],
			),
		],
	),
)
