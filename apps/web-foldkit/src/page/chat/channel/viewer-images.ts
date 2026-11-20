import { isImageAttachment } from "../../../chat/attachments"
import type { ImageViewerImage } from "../../../chat/image-viewer"
import * as Overlays from "../overlays"
import type { MessageRow } from "../rows"
import type { Model } from "./model"

/** The row an image viewer opened from: a channel row, or a reply in the open thread. */
export const viewerRowOf = (model: Model, messageId: string): MessageRow | undefined => {
	const row = model.rows.find((candidate) => candidate.key === messageId)
	if (row !== undefined) return row._tag === "MessageRow" ? row : undefined
	return model.threadPanel?.rows.find((candidate) => candidate.key === messageId)
}

/**
 * The open viewer's images and its row: the message's image attachments, or the embed images
 * (a GIF or tweet photos) it opened on. Null when no viewer is open or its message is gone.
 */
export const openViewerOf = (
	model: Model,
): {
	readonly row: MessageRow
	readonly images: ReadonlyArray<ImageViewerImage>
	readonly index: number
} | null => {
	const viewer = Overlays.imageViewerOf(model.overlays)
	if (viewer === null) return null
	const row = viewerRowOf(model, viewer.messageId)
	if (row === undefined) return null
	const images =
		viewer.urlImages === null
			? row.attachments.filter(isImageAttachment)
			: viewer.urlImages.map((image, index) => ({
					id: `${image.url}-${index}`,
					fileName: image.alt,
					fileSize: 0,
					url: image.url,
					caption: { title: image.title, description: image.description },
				}))
	return { row, images, index: viewer.index }
}
