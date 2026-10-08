import type { ChannelId, MessageId } from "@hazel/schema"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cn } from "~/lib/utils"
import { type MessageRow, UrlEmbed } from "../../page/chat/rows"
import { avatar } from "../../ui/avatar"
import { attachmentsView } from "../attachments"
import { messageEmbedsView } from "../embeds"
import { liveView } from "../embeds/live-view"
import { gifView, linkPreviewView, tweetView, youtubeView } from "../embeds/url-embeds"
import { markdownView } from "../markdown/markdown-view"
import { processMessageUrls } from "./content"
import { formatTime, headerView, replySectionView, threadPreviewView } from "./parts"
import { reactionButton, statusEmojiView, type TooltipContext } from "./tooltips"

/** Port of `MessageItem` (`components/chat/message-item.tsx` + `message.tsx`) and `DateDivider`. */

export interface RowContext<M> {
	readonly tooltip: TooltipContext<M>
	readonly toOpenImage: (messageId: MessageId, index: number) => M
	/** A GIF or tweet photo opens the viewer on its URL images. */
	readonly toOpenEmbedImage: (
		messageId: MessageId,
		images: ReadonlyArray<{ readonly url: string; readonly alt: string }>,
		index: number,
	) => M
	readonly toOpenThread: (threadChannelId: ChannelId, messageId: MessageId) => M
	/** A reaction pill's press: toggle that emoji (legacy `handleReaction`). */
	readonly toReact: (messageId: MessageId, emoji: string) => M
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

/** One URL embed; tweet photos and GIFs open the image viewer. */
const urlEmbedView = <M>(h: HtmlBuilder<M>, row: MessageRow, embed: UrlEmbed, context: RowContext<M>): Html => {
	const messageId = row.message.id
	return UrlEmbed.match<Html>(embed, {
		Tweet: ({ unfurl }) => {
			const tweet = unfurl?._tag === "LoadedTweet" ? unfurl.tweet : null
			const photos = tweet?.photos?.map((photo) => ({ url: photo.url, alt: tweet.text || "Tweet image" })) ?? []
			// Legacy only mounts the viewer for a message with an author.
			const canOpen = photos.length > 0 && row.message.author !== null
			return tweetView(h, unfurl, canOpen ? (index) => context.toOpenEmbedImage(messageId, photos, index) : null)
		},
		Youtube: ({ embedUrl }) => youtubeView(h, embedUrl),
		Gif: ({ mediaUrl, isKlipy }) =>
			gifView(h, mediaUrl, isKlipy, context.toOpenEmbedImage(messageId, [{ url: mediaUrl, alt: "GIF" }], 0)),
		LinkPreview: ({ url, unfurl }) => linkPreviewView(h, url, unfurl),
	})
}

/** `MessageContent.Text` + `MessageContent.Embeds`. */
const contentView = <M>(h: HtmlBuilder<M>, row: MessageRow, context: RowContext<M>): ReadonlyArray<Html> => {
	const { message } = row
	const { displayContent } = processMessageUrls(message)
	return [
		row.live === null && displayContent ? markdownView(h, displayContent, row.refs) : h.empty,
		...row.urlEmbeds.map((embed) => urlEmbedView(h, row, embed, context)),
		messageEmbedsView(h, message.embeds, row.live === null ? h.empty : liveView(h, row.live.state, row.live.loading)),
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
										...contentView(h, row, context),
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
															context.toReact(message.id, reaction.emoji),
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
