import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { cx } from "~/utils/cx"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { IconDiscord, IconSlack } from "../icons"
import { avatar } from "../ui/avatar"
import { presenceDot } from "../ui/presence-dot"
import {
	FitAutocompleteHeight,
	listboxId,
	Message,
	type Model,
	optionDomId,
	PreventEditorBlur,
} from "./composer"
import type { MentionProvider } from "./composer"
import { clampedActiveIndex, type MentionOption, mentionOptions } from "./update"
import { commandTriggerContent, emojiTriggerContent } from "./trigger-views"

/** `EditorAutocomplete` with the trigger lists (`MentionTrigger`, `CommandTrigger`, `EmojiTrigger`). */

/** The platform's mark in the avatar's corner, cut out like the presence dot. */
const providerBadge = <M>(h: HtmlBuilder<M>, provider: MentionProvider): Html => {
	const label = provider === "discord" ? "Discord" : "Slack"
	return h.span(
		[
			h.Class(
				cx(
					"flex size-3 translate-x-1/4 translate-y-1/4 items-center justify-center rounded-full ring-2 ring-bg",
					provider === "discord" ? "bg-discord text-white" : "bg-bg",
				),
			),
			h.Attribute("role", "img"),
			h.Attribute("aria-label", label),
			h.Attribute("title", label),
		],
		[
			provider === "discord"
				? IconDiscord(h, { className: "size-2" })
				: IconSlack(h, { className: "size-2" }),
		],
	)
}

/** `MentionItem` from `triggers/mention-trigger.tsx`. */
const mentionItem = <M>(h: HtmlBuilder<M>, option: MentionOption): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			option.type === "user" || option.type === "bot"
				? avatar(h, {
						size: "xs",
						src: option.avatarUrl,
						seed: option.displayName,
						alt: option.displayName,
						...(option.provider
							? { badge: providerBadge(h, option.provider) }
							: option.status
								? {
										badge: presenceDot(
											h,
											getEffectivePresenceStatus({ status: option.status }),
										),
									}
								: {}),
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
					h.div(
						[h.Class("truncate font-medium")],
						[
							option.type === "user" || option.type === "bot"
								? option.label
								: `@${option.displayName}`,
						],
					),
					...(option.description
						? [h.div([h.Class("truncate text-muted-fg text-xs")], [option.description])]
						: []),
				],
			),
		],
	)

/** Pressing in the list keeps the focus (and the caret) in the editor. */
const keepFocus = <M>(h: HtmlBuilder<M>, toMessage: (message: Message) => M) =>
	h.OnMount(Mount.mapMessage(PreventEditorBlur(), toMessage))

/** `AutocompleteListBox`: the option rows, or the trigger's empty message. */
export const listBox = <M>(
	h: HtmlBuilder<M>,
	editorId: string,
	options: ReadonlyArray<{ readonly id: string; readonly content: Html }>,
	activeIndex: number,
	emptyMessage: string,
	toMessage: (message: Message) => M,
): Html =>
	options.length === 0
		? h.div([h.Class("p-4 text-center text-muted-fg text-sm"), keepFocus(h, toMessage)], [emptyMessage])
		: h.div(
				[h.Class(cx("p-2 outline-none")), keepFocus(h, toMessage)],
				options.map((option, index) => {
					const isActive = index === activeIndex
					return h.keyed("div")(
						option.id,
						[
							h.Id(optionDomId(editorId, index)),
							h.Role("option"),
							h.Attribute("aria-selected", String(isActive)),
							h.OnClick(toMessage(Message.ClickedAutocompleteOption({ index }))),
							h.OnMouseEnter(toMessage(Message.HoveredAutocompleteOption({ index }))),
							h.Class(
								cx(
									"flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
									"outline-none transition-colors",
									isActive && "bg-primary/10 text-primary",
									!isActive && "hover:bg-muted",
								),
							),
						],
						[option.content],
					)
				}),
			)

const mentionContent = <M>(h: HtmlBuilder<M>, model: Model, toMessage: (message: Message) => M): Html =>
	listBox(
		h,
		model.editorId,
		mentionOptions(model).map((option) => ({ id: option.id, content: mentionItem(h, option) })),
		clampedActiveIndex(model),
		"No users found",
		toMessage,
	)

/** The popover above the editor while a trigger is open (nothing otherwise). */
export const autocompletePopover = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	toMessage: (message: Message) => M,
): Html => {
	const trigger = model.autocomplete?.trigger
	if (trigger === undefined) return h.empty
	const content =
		trigger === "mention"
			? mentionContent(h, model, toMessage)
			: trigger === "command"
				? commandTriggerContent(h, model, toMessage)
				: emojiTriggerContent(h, model, toMessage)
	if (content === null) return h.empty
	return h.keyed("div")(
		"autocomplete",
		[
			h.Id(listboxId(model.editorId)),
			h.Role("listbox"),
			h.OnMount(Mount.mapMessage(FitAutocompleteHeight(), toMessage)),
			h.Class(
				cx(
					"absolute right-0 bottom-full left-0 z-50 mb-2",
					"overflow-y-auto overflow-x-hidden rounded-xl",
					"border border-fg/10 bg-overlay shadow-lg",
					"fade-in slide-in-from-bottom-2 animate-in duration-150",
				),
			),
		],
		[content],
	)
}
