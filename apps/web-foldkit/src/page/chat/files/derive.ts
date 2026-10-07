import { Schema } from "effect"
import { getFileCategory, getFileTypeFromName } from "~/utils/file-utils"
import type { Breakpoint, FileAttachment, FileUploader } from "./queries"

/** Pure derivations of `channel-files/*`: filtering, the grid's row size and the relative dates. */

export const FileFilterType = Schema.Literals(["all", "image", "video", "document"])
export type FileFilterType = typeof FileFilterType.Type

/** `filterOptions` of `channel-files-header.tsx`. */
export const filterOptions: ReadonlyArray<{ readonly id: FileFilterType; readonly label: string }> = [
	{ id: "all", label: "All Files" },
	{ id: "image", label: "Images" },
	{ id: "video", label: "Videos" },
	{ id: "document", label: "Documents" },
]

/** `filteredAttachments` of `ChannelFilesView`: search on the file name, then the type filter. */
export const filterAttachments = (
	attachments: ReadonlyArray<FileAttachment>,
	searchQuery: string,
	filterType: FileFilterType,
): ReadonlyArray<FileAttachment> => {
	const query = searchQuery.toLowerCase()
	const searched = searchQuery
		? attachments.filter((attachment) => attachment.fileName.toLowerCase().includes(query))
		: attachments
	return filterType === "all"
		? searched
		: searched.filter((attachment) => getFileCategory(attachment.fileName) === filterType)
}

const isMediaCategory = (attachment: FileAttachment) => {
	const category = getFileCategory(attachment.fileName)
	return category === "image" || category === "video"
}

export const mediaOf = (attachments: ReadonlyArray<FileAttachment>) => attachments.filter(isMediaCategory)

export const documentsOf = (attachments: ReadonlyArray<FileAttachment>) =>
	attachments.filter((attachment) => getFileCategory(attachment.fileName) === "document")

export const isVideo = (attachment: FileAttachment) =>
	["mp4", "webm"].includes(getFileTypeFromName(attachment.fileName))

export const isViewerImage = (attachment: FileAttachment) =>
	["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(getFileTypeFromName(attachment.fileName))

/** `visibleCount` of `ChannelFilesMediaGrid`. */
export const visibleCountFor = (breakpoint: Breakpoint): number =>
	breakpoint === "xl" ? 5 : breakpoint === "lg" ? 4 : breakpoint === "sm" ? 3 : 2

const DAY_MS = 1000 * 60 * 60 * 24

/** `formatRelativeTime` of `channel-files-documents-list.tsx`, with the clock passed in. */
export const formatRelativeTime = (dateMs: number, nowMs: number): string => {
	const diffDays = Math.floor((nowMs - dateMs) / DAY_MS)
	if (diffDays === 0) return "Today"
	if (diffDays === 1) return "Yesterday"
	if (diffDays < 7) return `${diffDays} days ago`
	if (diffDays < 30) {
		const weeks = Math.floor(diffDays / 7)
		return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`
	}
	return new Date(dateMs).toLocaleDateString()
}

/** `buildChatAuthorIdentity` without the bot-name lookup (see the report). */
export const uploaderIdentity = (uploader: FileUploader | null) => {
	const displayName = uploader
		? [uploader.firstName, uploader.lastName].filter(Boolean).join(" ").trim()
		: ""
	return {
		name: displayName || "Unknown",
		seed: displayName || undefined,
		avatarUrl: uploader?.avatarUrl ?? undefined,
	}
}
