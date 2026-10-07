import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cn } from "~/lib/utils"
import { IconPin } from "../../icons"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import { markdownView } from "./markdown-view"
import type { AggregatedReaction, DisplayRow, GroupPosition } from "./rows"

/** Port of `MessageItem` (`components/chat/message-item.tsx` + `message.tsx`) and `DateDivider`. */

const pad = (value: number) => String(value).padStart(2, "0")

/** date-fns `format(date, "HH:mm")` in the local time zone. */
export const formatTime = (ms: number) => {
	const date = new Date(ms)
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `DateDivider`: the line is hidden while the divider is pinned to the top. */
export const dateDividerView = <Message>(h: HtmlBuilder<Message>, label: string, isStuck: boolean): Html =>
	h.div(
		[h.Class("sticky top-0 z-0 my-2 flex items-center justify-center")],
		[
			...(isStuck ? [] : [h.div([h.Class("absolute inset-x-4 border-t border-border")], [])]),
			h.span(
				[
					h.Class(
						"relative rounded-lg bg-secondary px-3 py-1 font-mono text-muted-fg text-xs shadow-sm",
					),
				],
				[label],
			),
		],
	)

/** `ReactionButton` (a React Aria tooltip trigger). */
const reactionButton = <Message>(h: HtmlBuilder<Message>, reaction: AggregatedReaction): Html =>
	h.button(
		[
			h.Class(
				cn(
					"inline-flex size-max cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium text-sm ring ring-inset transition-colors",
					reaction.hasReacted
						? "bg-primary/10 text-primary ring-primary/20 hover:bg-primary/20"
						: "bg-secondary text-fg ring-border hover:bg-secondary/80",
				),
			),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
		[reaction.emoji, " ", String(reaction.count)],
	)

/** `buildChatAuthorIdentity` for human authors (bot names come with the bots dataset in Phase 3). */
const displayNameOf = (author: MessageRow["message"]["author"]) =>
	author === null ? "" : [author.firstName, author.lastName].filter(Boolean).join(" ").trim()

const isGroupStartOf = (position: GroupPosition) => position === "start" || position === "standalone"
const isGroupEndOf = (position: GroupPosition) => position === "end" || position === "standalone"

type MessageRow = Extract<DisplayRow, { readonly _tag: "MessageRow" }>

export const messageRowView = <Message>(h: HtmlBuilder<Message>, row: MessageRow): Html => {
	const { message, groupPosition, reactions } = row
	const isGroupStart = isGroupStartOf(groupPosition)
	const displayName = displayNameOf(message.author)
	const showAvatar = isGroupStart || message.replyToMessageId !== null || message.hasEmbeds
	const isEdited = message.updatedAtMs !== null && message.updatedAtMs > message.createdAtMs
	const time = formatTime(message.createdAtMs)

	const avatarOrTime = showAvatar
		? h.button(
				[
					h.Attribute("aria-expanded", "false"),
					h.Class("size-fit outline-hidden"),
					h.Attribute("data-rac", ""),
					h.Attribute("data-react-aria-pressable", "true"),
					h.Attribute("tabindex", "0"),
					h.Attribute("type", "button"),
				],
				[
					avatar(h, {
						size: "md",
						alt: displayName || undefined,
						src: message.author?.avatarUrl,
						seed: displayName || undefined,
					}),
				],
			)
		: h.div(
				[
					h.Class(
						"flex w-10 items-center justify-end pr-1 text-[10px] text-muted-fg leading-tight opacity-0 group-hover:opacity-100",
					),
				],
				[time],
			)

	const header =
		showAvatar && message.author !== null
			? [
					h.div(
						[h.Class("flex items-baseline gap-2")],
						[
							h.span([h.Class("font-semibold text-fg")], [displayName]),
							...(message.author.userType === "machine"
								? [badge(h, { intent: "primary" }, ["APP"])]
								: []),
							h.span(
								[h.Class("text-muted-fg text-xs")],
								isEdited ? [time, " (edited)"] : [time],
							),
							...(message.isPinned
								? [
										h.span(
											[
												h.Class("flex items-center gap-1 text-warning text-xs"),
												h.Attribute("title", "Pinned message"),
											],
											[IconPin(h, { className: "size-3" }), h.span([], ["Pinned"])],
										),
									]
								: []),
						],
					),
				]
			: []

	const reactionList =
		reactions.length === 0
			? []
			: [
					h.div(
						[h.Class("mt-2 flex flex-wrap gap-1")],
						reactions.map((reaction) => reactionButton(h, reaction)),
					),
				]

	return h.div(
		[
			h.Attribute("aria-haspopup", "menu"),
			// ContextMenuTrigger: twMerge("cursor-default focus:outline-hidden", className)
			h.Class(twMerge("cursor-default focus:outline-hidden", "block w-full text-left")),
		],
		[
			h.div(
				[
					h.Class(
						cn(
							"group relative flex flex-col rounded-lg px-0.5 py-1 hover:bg-secondary",
							isGroupStart ? "mt-2" : "",
							isGroupEndOf(groupPosition) ? "mb-2" : "",
							message.isPinned
								? "rounded-l-none border-warning border-l-4 bg-warning/10 pl-2 shadow-sm hover:bg-warning/15"
								: "",
						),
					),
					h.Attribute("data-id", message.id),
					h.Id(`message-${message.id}`),
				],
				[
					h.div(
						[h.Class("flex gap-4")],
						[
							avatarOrTime,
							h.div(
								[h.Class("min-w-0 flex-1")],
								[
									...header,
									...(message.content ? [markdownView(h, message.content)] : []),
									...reactionList,
								],
							),
						],
					),
				],
			),
		],
	)
}
