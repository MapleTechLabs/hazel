import { AttachmentId } from "@hazel/schema"
import type { DateTime } from "effect"
import { Schema } from "effect"
import { toEpochMs } from "~/lib/utils"
import { getAttachmentUrl } from "~/utils/attachment-url"

/** Row shape of `useChannelAttachments` and its mapping to the Model (no collection imports). */

/** The Tailwind breakpoints `ChannelFilesMediaGrid` reads to size its single row. */
export const Breakpoint = Schema.Literals(["base", "sm", "lg", "xl"])
export type Breakpoint = typeof Breakpoint.Type

export const FileUploader = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.String,
})
export type FileUploader = typeof FileUploader.Type

export const FileAttachment = Schema.Struct({
	id: AttachmentId,
	fileName: Schema.String,
	fileSize: Schema.Number,
	/** `getAttachmentUrl(attachment)`, resolved once per query result. */
	url: Schema.String,
	uploadedAtMs: Schema.Number,
	uploader: Schema.NullOr(FileUploader),
})
export type FileAttachment = typeof FileAttachment.Type

/** Rows come out of collections decoded with the domain schemas, so ids are already branded. */
export interface AttachmentQueryRow {
	readonly attachments: {
		readonly id: AttachmentId
		readonly fileName: string
		readonly fileSize: number
		readonly externalUrl: string | null
		readonly uploadedAt: Date | DateTime.Utc
	}
	readonly user?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
		readonly userType: string
	} | null
}

export const toFileAttachment = ({ attachments, user }: AttachmentQueryRow): FileAttachment => ({
	id: attachments.id,
	fileName: attachments.fileName,
	fileSize: attachments.fileSize,
	url: getAttachmentUrl(attachments),
	uploadedAtMs: toEpochMs(attachments.uploadedAt),
	uploader: user
		? {
				firstName: user.firstName,
				lastName: user.lastName,
				avatarUrl: user.avatarUrl ?? null,
				userType: user.userType,
			}
		: null,
})
