/**
 * What both files pages share: the viewer over the channel's images, and the links between them.
 */
import type { ChannelId } from "@hazel/schema"
import { type FileAttachment, isViewerImage, mediaOf } from "./attachments"

/** The images the viewer pages through (every image, newest first) and the open one's index. */
export const viewerOf = (attachments: ReadonlyArray<FileAttachment>, openId: string | null) => {
	const images = mediaOf(attachments).filter(isViewerImage)
	const index = openId === null ? -1 : images.findIndex((image) => image.id === openId)
	return { images, index, current: index === -1 ? undefined : images[index] }
}

export const filesHref = (orgSlug: string, channelId: ChannelId) => `/${orgSlug}/chat/${channelId}/files`

export const mediaHref = (orgSlug: string, channelId: ChannelId) => `${filesHref(orgSlug, channelId)}/media`
