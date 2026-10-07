import type { ChannelId, MessageId } from "@hazel/schema"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cn } from "~/lib/utils"
import type { MessageRow } from "../../page/chat/rows"
import { avatar } from "../../ui/avatar"
import { attachmentsView } from "../attachments"
import { messageEmbedsView } from "../embeds"
import { markdownView } from "../markdown/markdown-view"
import { processUrls } from "./content"
import { formatTime, headerView, replySectionView, threadPreviewView } from "./parts"
import { reactionButton, statusEmojiView, type TooltipContext } from "./tooltips"

/** Port of `MessageItem` (`components/chat/message-item.tsx` + `message.tsx`) and `DateDivider`. */

export interface RowContext<M> {
	readonly tooltip: TooltipContext<M>
	readonly toOpenImage: (messageId: MessageId, index: number) => M
	readonly toOpenThread: (threadChannelId: ChannelId, messageId: MessageId) => M
	/** The row's ContextMenuTrigger: `render` with no extra attributes, or inside the open menu. */
	readonly contextMenu: (
		row: MessageRow,
		render: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html,
	) => Html
	/** The author avatar, a `UserProfilePopover` trigger. */
	readonly avatar: (row: MessageRow) => Html
}

/** `DateDivider`: the line is hidden while the divider is pinned to the top. */
export const dateDividerView = <M>(h: HtmlBuilder<M>, label: string, isStuck: boolean): Html =>
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

const isGroupStartOf = (row: MessageRow) =>
	row.groupPosition === "start" || row.groupPosition === "standalone"
const isGroupEndOf = (row: MessageRow) => row.groupPosition === "end" || row.groupPosition === "standalone"

/** `UserProfilePopover`'s resting trigger: the author avatar. */
export const avatarButton = <M>(
	h: HtmlBuilder<M>,
	row: MessageRow,
	attributes: ReadonlyArray<ChildAttribute>,
	overlay: Html,
) =>
	h.button(
		[
			...attributes,
			h.Class("size-fit outline-hidden"),
			h.Attribute("data-rac", ""),
			h.Attribute("data-react-aria-pressable", "true"),
			h.Attribute("tabindex", "0"),
			h.Attribute("type", "button"),
		],
		[
			avatar(h, {
				size: "md",
				alt: row.author.displayName || undefined,
				src: row.author.avatarUrl,
				seed: row.author.displayName || undefined,
			}),
			overlay,
		],
	)

/** `MessageContent.Text` + `MessageContent.Embeds` (URL unfurls need the network; not rendered). */
const contentView = <M>(h: HtmlBuilder<M>, row: MessageRow): ReadonlyArray<Html> => {
	const { message } = row
	const hasLiveState = message.embeds?.some((embed) => embed.liveState?.enabled === true) ?? false
	const { displayContent } = processUrls(message.content, message.embeds)
	return [
		!hasLiveState && displayContent ? markdownView(h, displayContent, row.refs) : h.empty,
		messageEmbedsView(h, message.embeds),
	]
}

export const messageRowView = <M>(h: HtmlBuilder<M>, row: MessageRow, context: RowContext<M>): Html => {
	const { message } = row
	const isGroupStart = isGroupStartOf(row)
	const showAvatar = isGroupStart || message.replyToMessageId !== null || message.hasEmbeds
	const avatarOrTime = showAvatar
		? context.avatar(row)
		: h.div(
				[
					h.Class(
						"flex w-10 items-center justify-end pr-1 text-[10px] text-muted-fg leading-tight opacity-0 group-hover:opacity-100",
					),
				],
				[formatTime(message.createdAtMs)],
			)

	return context.contextMenu(row, (attributes, overlay) =>
		h.div(
			[
				...attributes,
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
								isGroupEndOf(row) ? "mb-2" : "",
								message.isPinned
									? "rounded-l-none border-warning border-l-4 bg-warning/10 pl-2 shadow-sm hover:bg-warning/15"
									: "",
							),
						),
						h.Attribute("data-id", message.id),
						h.Id(`message-${message.id}`),
					],
					[
						row.reply === null ? h.empty : replySectionView(h, row.reply, null),
						h.div(
							[h.Class("flex gap-4")],
							[
								avatarOrTime,
								h.div(
									[h.Class("min-w-0 flex-1")],
									[
										showAvatar && message.author !== null
											? headerView(
													h,
													row,
													statusEmojiView(
														h,
														message.id,
														row.status,
														context.tooltip,
													),
												)
											: h.empty,
										...contentView(h, row),
										attachmentsView(h, row.attachments, {
											toOpenImage: (index) => context.toOpenImage(message.id, index),
										}),
										row.reactions.length === 0
											? h.empty
											: h.div(
													[h.Class("mt-2 flex flex-wrap gap-1")],
													row.reactions.map((reaction) =>
														reactionButton(
															h,
															message.id,
															reaction,
															context.tooltip,
														),
													),
												),
										row.thread === null
											? h.empty
											: threadPreviewView(
													h,
													row.thread,
													context.toOpenThread(
														row.thread.threadChannelId,
														message.id,
													),
												),
									],
								),
							],
						),
					],
				),
				overlay,
			],
		),
	)
}
