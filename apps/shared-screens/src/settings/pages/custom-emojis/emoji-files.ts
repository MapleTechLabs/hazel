/**
 * The custom emoji page's files: the host picks or receives an image, checks it, holds it under its
 * preview URL, and uploads it on save. Files never cross into the page as data, only their preview.
 * The web implements it in `web-foldkit/src/root/emoji-files.ts`.
 */
import type { OrganizationId } from "@hazel/schema"
import { Context, type Effect, Schema } from "effect"
import { CommonReason, type ErrorCopy } from "../../../modals/feedback"

export const MAX_EMOJI_SIZE = 256 * 1024
export const EMOJI_ACCEPT = "image/png,image/gif,image/webp"

/** Why a file can't become an emoji, or its upload failed (today's `settings/upload.ts` problems). */
export const UploadProblem = Schema.Literals([
	"InvalidType",
	"TooLarge",
	"NotConfigured",
	"PresignRejected",
	"StorageOffline",
	"StorageTimeout",
	"StorageError",
	"StorageCancelled",
])
export type UploadProblem = typeof UploadProblem.Type

export class EmojiFileError extends Schema.TaggedError<EmojiFileError, { readonly brand: unique symbol }>()(
	"EmojiFileError",
	{
		reason: Schema.Union([UploadProblem, CommonReason]),
	},
) {}

/** A file the host holds: its object URL (the preview, and the handle for `upload`) and its name. */
export const HeldFile = Schema.Struct({ previewUrl: Schema.String, fileName: Schema.String })
export type HeldFile = typeof HeldFile.Type

export class EmojiFiles extends Context.Service<
	EmojiFiles,
	{
		/** The platform's picker; null when cancelled. A file that fails the checks fails here. */
		readonly pick: Effect.Effect<HeldFile | null, EmojiFileError>
		/** The file of the drop zone's last `files` event. */
		readonly dropped: Effect.Effect<HeldFile | null, EmojiFileError>
		/** Uploads the held file; succeeds with its public URL. */
		readonly upload: (
			previewUrl: string,
			organizationId: OrganizationId,
		) => Effect.Effect<string, EmojiFileError>
		/** Forgets the held file and revokes its preview. */
		readonly release: (previewUrl: string) => Effect.Effect<void>
	}
>()("hazel/settings/EmojiFiles") {}

const STORAGE = "Upload failed"

/** The copy for an upload problem (today's `uploadProblemMessage("emoji", ...)`). */
export const uploadCopy = (problem: UploadProblem): ErrorCopy => {
	switch (problem) {
		case "InvalidType":
			return { title: "Invalid file type", description: "Please select a PNG, GIF, or WebP image" }
		case "TooLarge":
			return { title: "File too large", description: "File size must be less than 256KB" }
		case "NotConfigured":
			return {
				title: "Configuration error",
				description: "Image upload is not configured. Please contact support.",
			}
		case "PresignRejected":
			return { title: STORAGE, description: "Failed to get upload URL. Please try again." }
		case "StorageOffline":
			return { title: STORAGE, description: "Network error. Check your connection and try again." }
		case "StorageTimeout":
			return {
				title: STORAGE,
				description: "Upload timed out. Try a smaller file or check your connection.",
			}
		case "StorageError":
			return { title: STORAGE, description: "Server error during upload. Please try again later." }
		case "StorageCancelled":
			return { title: STORAGE, description: "Upload was cancelled." }
	}
}
