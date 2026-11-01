import type { Html, HtmlBuilder } from "foldkit/html"
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
	const isMachine = message.author?.userType === "machine"
	return h.div(
		[h.Class("flex items-baseline gap-2")],
		[
			h.span([h.Class("font-semibold text-fg")], [author.displayName]),
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

/** `MessageReplySection`: the curve, then the quoted author and first line. */
export const replySectionView = <M>(h: HtmlBuilder<M>, reply: ReplyPreview, onClick: M | null): Html =>
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
			h.button(
				[
					h.Attribute("type", "button"),
					h.Class("flex w-fit items-center gap-1 pl-12 text-left hover:bg-transparent"),
					...(onClick === null ? [] : [h.OnClick(onClick)]),
				],
				reply.author === null
					? [h.span([h.Class("text-muted-fg text-sm")], ["Message not found"])]
					: [
							avatar(h, {
								size: "xs",
								src: reply.author.avatarUrl,
								seed: reply.author.displayName || undefined,
								alt: reply.author.displayName,
							}),
							h.span(
								[h.Class("font-medium text-fg text-sm hover:underline")],
								[reply.author.displayName],
							),
							h.span(
								[h.Class("max-w-xs truncate text-ellipsis text-muted-fg text-sm")],
								[reply.firstLine],
							),
						],
			),
		],
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
			last === null
				? h.span([h.Class("truncate text-muted-fg")], ["No recent messages"])
				: h.div(
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
								: h.span(
										[h.Class("shrink-0 font-medium text-fg/85")],
										[last.author.displayName],
									),
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
