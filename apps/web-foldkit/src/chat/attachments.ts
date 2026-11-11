import type { Html, HtmlBuilder } from "foldkit/html"
import { formatFileSize, getFileTypeFromName } from "~/utils/file-utils"
import { IconDownload } from "../icons"
import { button } from "../ui/button"
import { fileIcon } from "./file-icons"
import { imageMosaicView } from "./image-mosaic"
import { videoPlayerView } from "./video-player"

/** Port of `MessageAttachments` (`components/chat/message-attachments.tsx`). */

export interface ChatAttachmentView {
	readonly id: string
	readonly fileName: string
	readonly fileSize: number
	/** Legacy `getAttachmentUrl(attachment)`. */
	readonly url: string
}

export interface AttachmentsOptions<M> {
	/** The image click: legacy sets the selected index and opens `ImageViewerModal`. */
	readonly toOpenImage: (index: number) => M
	/** The file card and video download buttons (legacy builds a temporary `<a download>`). */
	readonly toDownload?: (attachment: ChatAttachmentView) => M
}

// No svg: uploads store it as plain bytes (`isActiveContentType`), which no image tag renders.
const IMAGE_TYPES = ["jpg", "png", "gif", "webp"]
const VIDEO_TYPES = ["mp4", "webm"]

const typeOf = (attachment: ChatAttachmentView) => getFileTypeFromName(attachment.fileName)
export const isImageAttachment = (attachment: ChatAttachmentView) => IMAGE_TYPES.includes(typeOf(attachment))
const isVideoAttachment = (attachment: ChatAttachmentView) => VIDEO_TYPES.includes(typeOf(attachment))

/** `AttachmentItem`: a video player or a compact file card. */
const attachmentItem = <M>(
	h: HtmlBuilder<M>,
	attachment: ChatAttachmentView,
	options: AttachmentsOptions<M>,
): Html => {
	const fileType = typeOf(attachment)
	const onDownload = options.toDownload?.(attachment)
	if (VIDEO_TYPES.includes(fileType)) {
		return videoPlayerView(h, {
			id: attachment.id,
			src: attachment.url,
			fileName: attachment.fileName,
			...(onDownload === undefined ? {} : { onDownload }),
		})
	}
	return h.div(
		[
			h.Class(
				"group flex items-center gap-3 rounded-lg border border-border bg-bg p-3 shadow-sm transition-colors hover:bg-muted",
			),
		],
		[
			fileIcon(h, fileType, { className: "size-10 text-muted-fg" }),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div([h.Class("truncate font-medium text-fg text-sm")], [attachment.fileName]),
					h.div([h.Class("text-muted-fg text-xs")], [formatFileSize(attachment.fileSize)]),
				],
			),
			button(
				h,
				{
					intent: "plain",
					size: "sq-sm",
					className: "opacity-0 transition-opacity group-hover:opacity-100",
					...(onDownload === undefined ? {} : { onPress: onDownload }),
					attributes: [h.AriaLabel("Download file")],
				},
				[IconDownload(h)],
			),
		],
	)
}

const fileColumn = <M>(
	h: HtmlBuilder<M>,
	attachments: ReadonlyArray<ChatAttachmentView>,
	options: AttachmentsOptions<M>,
): Html =>
	h.div(
		[h.Class("flex max-w-md flex-col gap-2")],
		attachments.map((attachment) => attachmentItem(h, attachment, options)),
	)

export const attachmentsView = <M>(
	h: HtmlBuilder<M>,
	attachments: ReadonlyArray<ChatAttachmentView>,
	options: AttachmentsOptions<M>,
): Html => {
	if (attachments.length === 0) return h.empty
	const images = attachments.filter(isImageAttachment)
	const videos = attachments.filter(isVideoAttachment)
	const otherFiles = attachments.filter(
		(attachment) => !isImageAttachment(attachment) && !isVideoAttachment(attachment),
	)
	return h.div(
		[h.Class("mt-2 flex flex-col gap-2")],
		[
			imageMosaicView(
				h,
				images.map((attachment, index) => ({
					key: attachment.id,
					url: attachment.url,
					alt: attachment.fileName,
					onOpen: options.toOpenImage(index),
				})),
			),
			...(videos.length > 0 ? [fileColumn(h, videos, options)] : []),
			...(otherFiles.length > 0 ? [fileColumn(h, otherFiles, options)] : []),
		],
	)
}
