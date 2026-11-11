import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { formatDistanceToNowStrict } from "date-fns"
import { cx } from "~/utils/cx"
import { IconChevronRight, IconDiscord, IconPin } from "../../icons"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import type { MessageRow, ReplyPreview, ThreadPreview } from "../../page/chat/rows"

/** Static parts of `Message.*`: author header, reply section, thread card. */

const pad = (value: number) => String(value).padStart(2, "0")

/** date-fns `format(date, "HH:mm")` in the local time zone. */
export const formatTime = (ms: number) => {
	const date = new Date(ms)
	return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `Message.Header`; `statusEmoji` is the tooltip-wrapped status trigger (or nothing). */
export const headerView = <M>(h: HtmlBuilder<M>, row: MessageRow, statusEmoji: Html): Html => {
	const { message, author } = row
	const isEdited = message.updatedAtMs !== null && message.updatedAtMs > message.createdAtMs
	const time = formatTime(message.createdAtMs)
	const isMachine = author.isBot
	return h.div(
		[h.Class("flex items-baseline gap-2 max-md:flex-wrap max-md:gap-y-0")],
		[
			h.span(
				[h.Class("font-semibold text-fg max-md:min-w-0 max-md:break-words")],
				[author.displayName],
			),
			statusEmoji,
			isMachine && row.isDiscordSynced
				? h.span(
						[
							h.Class(
								"inline-flex items-center gap-1 rounded-sm bg-primary px-1.5 py-0.5 text-xs/5 font-medium text-primary-fg",
							),
						],
						[
							IconDiscord(h, { className: "size-3", attributes: { fill: "currentColor" } }),
							"Discord",
						],
					)
				: isMachine
					? badge(h, { intent: "primary" }, ["APP"])
					: row.isDiscordSynced
						? badge(h, { intent: "secondary" }, ["Synced from Discord"])
						: h.empty,
			h.span([h.Class("text-muted-fg text-xs")], isEdited ? [time, " (edited)"] : [time]),
			message.isPinned
				? h.span(
						[
							h.Class("flex items-center gap-1 text-warning text-xs"),
							h.Attribute("title", "Pinned message"),
						],
						[IconPin(h, { className: "size-3" }), h.span([], ["Pinned"])],
					)
				: h.empty,
		],
	)
}

/** What the quoted message of a reply does when pressed. */
export interface ReplyActions<M> {
	/** Wraps the quoted author's button in an overlay trigger (their profile popover). */
	readonly toAuthor: (toTrigger: (attributes: ReadonlyArray<ChildAttribute>) => Html) => Html
	/** The quoted text's press: jump to that message. */
	readonly onJump: M
}

// Each control draws its own ring, tight around what it holds.
const REPLY_CONTROL =
	"cursor-pointer rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-primary/40"

/**
 * `MessageReplySection`: the curve, then the quoted author (opens their profile) and the first line
 * (jumps to the message).
 */
export const replySectionView = <M>(h: HtmlBuilder<M>, reply: ReplyPreview, actions: ReplyActions<M>): Html =>
	h.div(
		[h.Class("relative mb-1")],
		[
			h.svg(
				[
					h.Class("absolute -bottom-1 left-5 rotate-90 text-muted-fg"),
					h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
					h.Attribute("width", "24"),
					h.Attribute("height", "20"),
					h.Attribute("viewBox", "0 0 24 20"),
					h.Attribute("fill", "none"),
				],
				[
					h.path([
						h.Attribute("d", "M2 2 L2 12 Q2 16 6 16 L12 16"),
						h.Attribute("stroke", "currentColor"),
						h.Attribute("stroke-width", "2"),
						h.Attribute("stroke-linecap", "round"),
						h.Attribute("fill", "none"),
					]),
				],
			),
			h.div(
				[h.Class("flex min-w-0 items-center gap-1.5 pl-12")],
				reply.authorId === null
					? [h.span([h.Class("text-muted-fg text-sm")], ["Message not found"])]
					: [
							replyAuthorView(h, reply.author, actions),
							h.button(
								[
									h.Type("button"),
									h.Attribute("aria-label", "Jump to message"),
									h.OnClick(actions.onJump),
									h.Class(
										cx(
											REPLY_CONTROL,
											"min-w-0 max-w-xs truncate text-left text-muted-fg text-sm hover:text-fg",
										),
									),
								],
								[reply.firstLine === "" ? "Click to see attachment" : reply.firstLine],
							),
						],
			),
		],
	)

/** The quoted author's avatar and name, a profile popover trigger; nothing until the users lookup has them. */
const replyAuthorView = <M>(
	h: HtmlBuilder<M>,
	author: ReplyPreview["author"],
	actions: ReplyActions<M>,
): Html =>
	author === null
		? h.empty
		: actions.toAuthor((attributes) =>
				h.button(
					[
						// The trigger's attributes carry its own `aria-expanded` and `type`.
						...(attributes.length === 0
							? [h.Attribute("aria-expanded", "false"), h.Type("button")]
							: attributes),
						h.Class(cx(REPLY_CONTROL, "group/author flex shrink-0 items-center gap-1")),
					],
					[
						avatar(h, {
							size: "xs",
							src: author.avatarUrl,
							seed: author.displayName || undefined,
							alt: author.displayName,
						}),
						h.span(
							[h.Class("font-medium text-fg text-sm group-hover/author:underline")],
							[author.displayName],
						),
					],
				),
			)

/** Discord's thread card under its starter message: the name, the message count and the last message. */
export const threadPreviewView = <M>(h: HtmlBuilder<M>, thread: ThreadPreview, onClick: M | null): Html => {
	const last = thread.lastMessage
	return h.button(
		[
			h.Attribute("type", "button"),
			h.Attribute("aria-label", `Open thread ${thread.name}`),
			...(onClick === null ? [] : [h.OnClick(onClick)]),
			h.Class(
				cx(
					"group/thread mt-2 flex h-[58px] w-full max-w-lg cursor-pointer select-none flex-col justify-center gap-0.5",
					"rounded-lg border border-border bg-secondary/40 px-3 text-left text-sm",
					"transition-colors hover:border-fg/15 hover:bg-secondary active:bg-secondary/80",
				),
			),
		],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-2")],
				[
					h.span([h.Class("truncate font-semibold text-fg")], [thread.name]),
					h.span(
						[
							h.Class(
								"flex shrink-0 items-center gap-0.5 font-medium text-primary group-hover/thread:underline",
							),
						],
						[
							`${thread.count} ${thread.count === 1 ? "Message" : "Messages"}`,
							IconChevronRight(h, { className: "size-3.5" }),
						],
					),
				],
			),
			h.div(
				[h.Class("flex min-w-0 items-center gap-1.5")],
				[
					last.author === null
						? h.div([h.Class("size-4 shrink-0 rounded-full bg-muted")])
						: avatar(h, {
								src: last.author.avatarUrl,
								seed: last.author.displayName || undefined,
								alt: last.author.displayName,
								size: "xxs",
								className: "size-4 shrink-0",
							}),
					last.author === null
						? h.empty
						: h.span([h.Class("shrink-0 font-medium text-fg/85")], [last.author.displayName]),
					h.span(
						[h.Class("min-w-0 truncate text-muted-fg")],
						[last.text === "" ? "Click to see attachment" : last.text],
					),
					h.span(
						[h.Class("ml-1 shrink-0 text-muted-fg text-xs")],
						[formatDistanceToNowStrict(new Date(last.createdAtMs), { addSuffix: true })],
					),
				],
			),
		],
	)
}
