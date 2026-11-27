/**
 * The channel's files as the Files and All media pages show them (`web-foldkit/src/page/chat/files`,
 * now deleted): the live query, the search and type filter, and the mapping to hazel `Attachment`s.
 */
import { AttachmentId, type ChannelId } from "@hazel/schema"
import type { Attachment } from "@hazel/ui/vocabulary/content"
import { AttachmentFileType } from "@hazel/ui/vocabulary/options"
import { and, eq, isNull } from "@tanstack/db"
import { Schema } from "effect"
import { withData } from "../../app/live"
import { formatFileSize, getFileCategory, getFileTypeFromName } from "../../lib/utils/file-utils"

export const FileUploader = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type FileUploader = typeof FileUploader.Type

export const FileAttachment = Schema.Struct({
	id: AttachmentId,
	fileName: Schema.String,
	fileSize: Schema.Finite,
	/** Its own url, else the CDN's copy (today's `getAttachmentUrl`). */
	url: Schema.String,
	uploadedAtMs: Schema.Finite,
	uploader: Schema.NullOr(FileUploader),
})
export type FileAttachment = typeof FileAttachment.Type

export const FileFilterType = Schema.Literals(["all", "image", "video", "document"])
export type FileFilterType = typeof FileFilterType.Type

/** `filterOptions` of `channel-files-header.tsx`. */
export const filterOptions: ReadonlyArray<{ readonly value: FileFilterType; readonly label: string }> = [
	{ value: "all", label: "All files" },
	{ value: "image", label: "Images" },
	{ value: "video", label: "Videos" },
	{ value: "document", label: "Documents" },
]

interface Row {
	readonly attachment: {
		readonly id: AttachmentId
		readonly fileName: string
		readonly fileSize: number
		readonly externalUrl?: string | null
		readonly uploadedAt: Date | string
	}
	readonly user?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	} | null
}

const epochMs = (at: Date | string) => (typeof at === "string" ? Date.parse(at) : at.getTime())

/** `useChannelAttachments`: the channel's uploaded, undeleted files with their uploader, newest first. */
export const channelFilesStream = <Message>(
	channelId: ChannelId,
	cdnUrl: string,
	/** `nowMs`: the clock when the rows arrived, for each row's "Yesterday" (today read it at render). */
	toMessage: (attachments: ReadonlyArray<FileAttachment>, nowMs: number) => Message,
) =>
	withData((data) =>
		data.liveQueryStream<Row, Message>(
			(q) =>
				q
					.from({ attachment: data.collections.attachmentCollection })
					.leftJoin({ user: data.collections.userCollection }, ({ attachment, user }) =>
						eq(attachment.uploadedBy, user.id),
					)
					.where(({ attachment }) =>
						and(
							eq(attachment.channelId, channelId),
							eq(attachment.status, "complete"),
							isNull(attachment.deletedAt),
						),
					)
					.orderBy(({ attachment }) => attachment.uploadedAt, "desc"),
			(rows) =>
				toMessage(
					rows.map(({ attachment, user }) => ({
						id: attachment.id,
						fileName: attachment.fileName,
						fileSize: attachment.fileSize,
						url: attachment.externalUrl?.trim() || `${cdnUrl}/${attachment.id}`,
						uploadedAtMs: epochMs(attachment.uploadedAt),
						uploader:
							user === null || user === undefined
								? null
								: {
										firstName: user.firstName,
										lastName: user.lastName,
										avatarUrl: user.avatarUrl ?? null,
									},
					})),
					Date.now(),
				),
		),
	)

/** Search on the file name, then the type filter (`ChannelFilesView`). */
export const filterAttachments = (
	attachments: ReadonlyArray<FileAttachment>,
	query: string,
	filter: FileFilterType,
): ReadonlyArray<FileAttachment> => {
	const lower = query.toLowerCase()
	const searched =
		query === "" ? attachments : attachments.filter((each) => each.fileName.toLowerCase().includes(lower))
	return filter === "all" ? searched : searched.filter((each) => getFileCategory(each.fileName) === filter)
}

const isMedia = (attachment: FileAttachment) => getFileCategory(attachment.fileName) !== "document"

export const mediaOf = (attachments: ReadonlyArray<FileAttachment>) => attachments.filter(isMedia)

export const documentsOf = (attachments: ReadonlyArray<FileAttachment>) =>
	attachments.filter((attachment) => !isMedia(attachment))

export const isVideo = (attachment: FileAttachment) =>
	["mp4", "webm"].includes(getFileTypeFromName(attachment.fileName))

/** The images the viewer pages through (videos open in a tab, as today). */
export const isViewerImage = (attachment: FileAttachment) =>
	["jpg", "png", "gif", "webp", "svg"].includes(getFileTypeFromName(attachment.fileName))

/** The Tailwind breakpoints the media strip sizes its one row by (`sm`, `lg`, `xl`). */
export const Breakpoint = Schema.Literals(["base", "sm", "lg", "xl"])
export type Breakpoint = typeof Breakpoint.Type

/** `visibleCount` of `ChannelFilesMediaGrid`: one row of the grid's columns. */
export const visibleCountFor = (breakpoint: Breakpoint): number =>
	breakpoint === "xl" ? 5 : breakpoint === "lg" ? 4 : breakpoint === "sm" ? 3 : 2

const DAY_MS = 1000 * 60 * 60 * 24

/** `formatRelativeTime` of `channel-files-documents-list.tsx`, with the clock passed in. */
export const formatRelativeTime = (dateMs: number, nowMs: number): string => {
	const days = Math.floor((nowMs - dateMs) / DAY_MS)
	if (days === 0) return "Today"
	if (days === 1) return "Yesterday"
	if (days < 7) return `${days} days ago`
	if (days < 30) {
		const weeks = Math.floor(days / 7)
		return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`
	}
	return new Date(dateMs).toLocaleDateString()
}

const isFileType = Schema.is(AttachmentFileType)

/** The uploader's name, "Unknown" without one (today's `uploaderIdentity`). */
const uploaderOf = (uploader: FileUploader | null): NonNullable<Attachment["uploader"]> => {
	const name =
		uploader === null ? "" : [uploader.firstName, uploader.lastName].filter(Boolean).join(" ").trim()
	const shown = name === "" ? "Unknown" : name
	const avatar = uploader?.avatarUrl
	return avatar == null ? { name: shown } : { name: shown, avatar }
}

/** A documents row (`DocumentItem`): its type's icon, the upload time and the uploader. */
export const toFileRow = (attachment: FileAttachment, nowMs: number | null): Attachment => {
	const type = getFileTypeFromName(attachment.fileName)
	const row: Attachment = {
		...toAttachment(attachment),
		fileType: isFileType(type) ? type : "empty",
		uploader: uploaderOf(attachment.uploader),
	}
	return nowMs === null ? row : { ...row, meta: formatRelativeTime(attachment.uploadedAtMs, nowMs) }
}

/** A lightbox item: the uploader and the upload's date and time over it (today's viewer author). */
export const toViewerItem = (attachment: FileAttachment): Attachment => ({
	...toAttachment(attachment),
	uploader: uploaderOf(attachment.uploader),
	meta: new Date(attachment.uploadedAtMs).toLocaleString(),
})

/** A file as a hazel attachment, its size formatted as today. */
export const toAttachment = (attachment: FileAttachment): Attachment => ({
	id: attachment.id,
	kind: isVideo(attachment) ? "video" : isViewerImage(attachment) ? "image" : "file",
	name: attachment.fileName,
	size: formatFileSize(attachment.fileSize),
	url: attachment.url,
})
