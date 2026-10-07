import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconDownload, IconPlay } from "../../../icons"
import type * as Interaction from "../../../ui/aria/interaction"
import { button } from "../../../ui/button"
import { isVideo, isViewerImage, mediaOf, visibleCountFor } from "./derive"
import { Message, type Model } from "./page"
import type { FileAttachment } from "./queries"

/** Ports of `ChannelFilesMediaGrid` (one row plus "See all") and `MediaGalleryView` (masonry). */

export interface FilesContext<M> {
	readonly h: HtmlBuilder<M>
	readonly model: Model
	readonly toParentMessage: (message: Message) => M
	readonly wiring: Interaction.Wiring<M>
}

export const filesPath = (model: Model) => `/${model.orgSlug}/chat/${model.channelId}/files`

const OVERLAY =
	"pointer-events-none absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/40 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100"

/** The hover overlay's secondary download button; the click must not reach the tile. */
export const downloadOverlay = <M>(context: FilesContext<M>, attachment: FileAttachment): Html => {
	const { h, toParentMessage } = context
	return h.div(
		[h.Class(OVERLAY)],
		[
			button(
				h,
				{
					intent: "secondary",
					size: "sq-sm",
					className: "pointer-events-auto bg-bg/90",
					interaction: { wiring: context.wiring, target: `files-media-download-${attachment.id}` },
					attributes: [
						h.AriaLabel(`Download ${attachment.fileName}`),
						h.OnClick(toParentMessage(Message.ClickedDownload({ attachmentId: attachment.id })), {
							propagation: "Stop",
						}),
					],
				},
				[IconDownload(h)],
			),
		],
	)
}

/** The `<video>` or `<img>` of a tile; `onError` drops the tile like legacy's `imageError`. */
export const mediaElement = <M>(
	context: FilesContext<M>,
	attachment: FileAttachment,
	options: { readonly className: string; readonly isLazy?: boolean; readonly hasErrorHandler: boolean },
): Html => {
	const { h, toParentMessage } = context
	const onError = options.hasErrorHandler
		? [h.OnError(toParentMessage(Message.FailedToLoadMedia({ attachmentId: attachment.id })))]
		: []
	return isVideo(attachment)
		? h.video(
				[
					h.Src(attachment.url),
					h.Class(options.className),
					h.Attribute("preload", "metadata"),
					...onError,
				],
				[],
			)
		: h.img([
				h.Src(attachment.url),
				h.Alt(attachment.fileName),
				h.Class(options.className),
				...(options.isLazy ? [h.Attribute("loading", "lazy")] : []),
				...onError,
			])
}

const playBadge = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class("pointer-events-none absolute inset-0 flex items-center justify-center")],
		[
			h.div(
				[h.Class("flex size-12 items-center justify-center rounded-full bg-black/60")],
				[IconPlay(h, { className: "ml-0.5 size-6 text-white" })],
			),
		],
	)

const tileContent = <M>(
	context: FilesContext<M>,
	attachment: FileAttachment,
	className: string,
	isLazy: boolean,
) => [
	mediaElement(context, attachment, { className, isLazy, hasErrorHandler: true }),
	...(isVideo(attachment) ? [playBadge(context.h)] : []),
	downloadOverlay(context, attachment),
]

const clickedMedia = (attachment: FileAttachment) =>
	Message.ClickedMedia({ attachmentId: attachment.id, isVideo: isVideo(attachment) })

const gridItem = <M>(context: FilesContext<M>, attachment: FileAttachment): Html => {
	const { h, toParentMessage } = context
	return h.keyed("div")(
		attachment.id,
		[
			h.Role("button"),
			h.Tabindex(0),
			h.Class(
				"group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-border bg-secondary/30 transition-colors hover:border-muted-fg/50",
			),
			h.OnClick(toParentMessage(clickedMedia(attachment))),
			h.OnKeyDownPreventDefault((key) =>
				key === "Enter" || key === " "
					? Option.some(toParentMessage(clickedMedia(attachment)))
					: Option.none(),
			),
		],
		tileContent(context, attachment, "size-full object-cover", false),
	)
}

const seeAllItem = <M>(
	context: FilesContext<M>,
	attachment: FileAttachment,
	remainingCount: number,
): Html => {
	const { h } = context
	return h.keyed("a")(
		attachment.id,
		[
			h.Class("relative aspect-square overflow-hidden rounded-lg border border-border bg-secondary/30"),
			h.Href(`${filesPath(context.model)}/media`),
		],
		[
			mediaElement(context, attachment, {
				className: "size-full object-cover",
				hasErrorHandler: false,
			}),
			h.div(
				[
					h.Class(
						"absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white",
					),
				],
				[
					h.span([h.Class("font-semibold text-2xl")], ["+", String(remainingCount)]),
					h.span([h.Class("text-sm text-white/80")], ["See all"]),
				],
			),
		],
	)
}

/** `ChannelFilesMediaGrid`; the image viewer modal is not ported (see `viewerImageId`). */
export const mediaGridView = <M>(
	context: FilesContext<M>,
	attachments: ReadonlyArray<FileAttachment>,
): Html => {
	const { h, model } = context
	const visibleCount = visibleCountFor(model.breakpoint)
	const visible = attachments.slice(0, visibleCount)
	const remainingCount = attachments.length - visibleCount
	return h.div(
		[h.Class("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")],
		visible.flatMap((attachment, index) => {
			if (index === visible.length - 1 && remainingCount > 0) {
				return [seeAllItem(context, attachment, remainingCount)]
			}
			return model.failedMediaIds.includes(attachment.id) ? [] : [gridItem(context, attachment)]
		}),
	)
}

const masonryItem = <M>(context: FilesContext<M>, attachment: FileAttachment): Html => {
	const { h, toParentMessage } = context
	return h.keyed("button")(
		attachment.id,
		[
			h.Class(
				"group relative mb-2 w-full cursor-pointer break-inside-avoid overflow-hidden rounded-lg",
			),
			h.Type("button"),
			h.OnClick(toParentMessage(clickedMedia(attachment))),
		],
		tileContent(context, attachment, "w-full object-cover", true),
	)
}

/** `MediaGalleryView`: stats line and the masonry columns of every image and video. */
export const mediaGalleryView = <M>(context: FilesContext<M>): Html => {
	const { h, model } = context
	const media = mediaOf(model.attachments)
	if (media.length === 0) {
		return h.div(
			[h.Class("flex flex-1 items-center justify-center p-8 text-muted-fg")],
			["No media found in this channel"],
		)
	}
	const imageCount = media.filter(isViewerImage).length
	const videoCount = media.length - imageCount
	return h.div(
		[h.Class("flex-1 overflow-y-auto p-4")],
		[
			h.p(
				[h.Class("mb-4 text-muted-fg text-sm")],
				[
					String(imageCount),
					" ",
					imageCount === 1 ? "photo" : "photos",
					...(videoCount > 0 ? [`, ${videoCount} ${videoCount === 1 ? "video" : "videos"}`] : []),
				],
			),
			h.div(
				[h.Class("columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4")],
				media.flatMap((attachment) =>
					model.failedMediaIds.includes(attachment.id) ? [] : [masonryItem(context, attachment)],
				),
			),
		],
	)
}
