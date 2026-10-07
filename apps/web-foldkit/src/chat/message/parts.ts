import type { Html, HtmlBuilder } from "foldkit/html"
import { formatDistanceToNow } from "~/lib/date-fns-shared"
import { cx } from "~/utils/cx"
import { IconDiscord, IconPin } from "../../icons"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import type { MessageRow, ReplyPreview, ThreadPreview } from "../../page/chat/rows"

/** Static parts of `Message.*`: author header, reply section, thread preview. */

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

/** `InlineThreadPreview`. */
export const threadPreviewView = <M>(h: HtmlBuilder<M>, thread: ThreadPreview, onClick: M | null): Html =>
	h.button(
		[
			h.Attribute("type", "button"),
			...(onClick === null ? [] : [h.OnClick(onClick)]),
			h.Class(
				cx(
					"group/thread mt-1 flex items-center gap-2 rounded-md py-1 px-1 -ml-1 max-w-full",
					"transition-colors hover:bg-secondary/60 active:bg-secondary/80",
					"cursor-pointer select-none",
				),
			),
		],
		[
			h.div(
				[h.Class("shrink-0")],
				thread.authors.length === 0
					? []
					: [
							h.div(
								[h.Class("flex items-center -space-x-1.5")],
								thread.authors.map((author, index) =>
									author === null
										? h.div(
												[
													h.Class(
														"size-5 rounded-md bg-muted ring-[1.5px] ring-bg",
													),
													h.Attribute("style", `z-index: ${10 - index};`),
												],
												[],
											)
										: avatar(h, {
												src: author.avatarUrl,
												seed: author.displayName || undefined,
												alt: author.displayName,
												size: "xxs",
												className: "ring-[1.5px] ring-bg",
												isSquare: true,
											}),
								),
							),
						],
			),
			h.div(
				[h.Class("flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap")],
				[
					...(thread.customName
						? [
								h.span(
									[h.Class("max-w-[150px] truncate font-medium text-fg/80")],
									[thread.customName],
								),
								h.span([h.Class("shrink-0 text-muted-fg")], ["·"]),
							]
						: []),
					h.span(
						[h.Class("shrink-0 font-medium text-primary group-hover/thread:underline")],
						[String(thread.count), " ", thread.count === 1 ? "reply" : "replies"],
					),
					h.span([h.Class("shrink-0 text-muted-fg")], ["·"]),
					h.span(
						[h.Class("relative shrink-0")],
						[
							...(thread.lastReplyAtMs !== null
								? [
										h.span(
											[h.Class("text-muted-fg group-hover/thread:invisible truncate")],
											[
												...(thread.count > 1 ? ["Last reply "] : []),
												formatDistanceToNow(new Date(thread.lastReplyAtMs), {
													addSuffix: false,
												}),
												" ago",
											],
										),
									]
								: []),
							h.span(
								[
									h.Class(
										"invisible absolute left-0 text-muted-fg group-hover/thread:visible",
									),
								],
								["View thread"],
							),
						],
					),
				],
			),
		],
	)
