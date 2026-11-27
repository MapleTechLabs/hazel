/**
 * The settings uploads (organization logo here; avatars, bot avatars and custom emoji for PS7 and
 * PS2): what a file may be, the copy for each failure, and `ImageUploads`, the host that picks a
 * file and stores it. The bytes never reach the page: the host holds the file it picked.
 */
import { BotId, OrganizationId } from "@hazel/schema"
import { Context, type Effect, Match, Schema } from "effect"
import { CommonReason, type ErrorCopy } from "../../modals/feedback"

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024
export const MAX_EMOJI_SIZE = 256 * 1024
export const ALLOWED_AVATAR_TYPES: ReadonlyArray<string> = ["image/jpeg", "image/png", "image/webp"]
export const ALLOWED_EMOJI_TYPES: ReadonlyArray<string> = ["image/png", "image/gif", "image/webp"]

/** What the file is for: the presign request's `type` and its owner. */
export const UploadTarget = Schema.Union([
	Schema.TaggedStruct("UserAvatar", {}),
	Schema.TaggedStruct("BotAvatar", { botId: BotId }),
	Schema.TaggedStruct("OrganizationAvatar", { organizationId: OrganizationId }),
	Schema.TaggedStruct("CustomEmoji", { organizationId: OrganizationId }),
])
export type UploadTarget = typeof UploadTarget.Type

/** Avatars and logos share one set of limits; emoji have their own. */
export type UploadKind = "avatar" | "emoji"

export const kindOf = (target: UploadTarget): UploadKind =>
	target._tag === "CustomEmoji" ? "emoji" : "avatar"

/** Why an upload failed before or while storing the file (the backend's own failures are common reasons). */
export const UploadProblem = Schema.Literals([
	"InvalidType",
	"TooLarge",
	/** No public bucket URL is configured, so no public URL can be built. */
	"NotConfigured",
	/** The presign endpoint refused the file or its owner is gone. */
	"PresignRejected",
	"StorageOffline",
	"StorageTimeout",
	"StorageError",
	"StorageCancelled",
])
export type UploadProblem = typeof UploadProblem.Type

export const UploadFailure = Schema.Union([UploadProblem, CommonReason])
export type UploadFailure = typeof UploadFailure.Type

export class UploadFailedError extends Schema.TaggedError<
	UploadFailedError,
	{ readonly brand: unique symbol }
>()("UploadFailedError", {
	failure: UploadFailure,
}) {}

/** A file the host picked and holds until `upload` stores it (or the page drops it). */
export const PickedImage = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	/** MIME type, `""` when unknown. */
	type: Schema.String,
	size: Schema.Finite,
})
export type PickedImage = typeof PickedImage.Type

/** The file check `upload` runs first; a page may reject a pick before it uploads. */
export const validateUploadFile = (
	kind: UploadKind,
	file: { readonly type: string; readonly size: number },
): "InvalidType" | "TooLarge" | null => {
	const allowed = kind === "emoji" ? ALLOWED_EMOJI_TYPES : ALLOWED_AVATAR_TYPES
	if (!allowed.includes(file.type)) return "InvalidType"
	if (file.size > (kind === "emoji" ? MAX_EMOJI_SIZE : MAX_AVATAR_SIZE)) return "TooLarge"
	return null
}

/** The `accept` of a picker for the kind. */
export const acceptOf = (kind: UploadKind): string =>
	(kind === "emoji" ? ALLOWED_EMOJI_TYPES : ALLOWED_AVATAR_TYPES).join(",")

const STORAGE_COPY = {
	network: "Network error. Check your connection and try again.",
	timeout: "Upload timed out. Try a smaller file or check your connection.",
	server: "Server error during upload. Please try again later.",
	aborted: "Upload was cancelled.",
} as const

/** The copy for an upload problem; the file checks name the kind's types and size limit. */
export const uploadProblemMessage = (kind: UploadKind, problem: UploadProblem): ErrorCopy =>
	Match.value(problem).pipe(
		Match.when("InvalidType", () => ({
			title: "Invalid file type",
			description:
				kind === "emoji"
					? "Please select a PNG, GIF, or WebP image"
					: "Please select a JPEG, PNG, or WebP image",
		})),
		Match.when("TooLarge", () => ({
			title: "File too large",
			description: `File size must be less than ${kind === "emoji" ? "256KB" : "5MB"}`,
		})),
		Match.when("NotConfigured", () => ({
			title: "Configuration error",
			description: "Image upload is not configured. Please contact support.",
		})),
		Match.when("PresignRejected", () => ({
			title: "Upload failed",
			description: "Failed to get upload URL. Please try again.",
		})),
		Match.when("StorageOffline", () => ({ title: "Upload failed", description: STORAGE_COPY.network })),
		Match.when("StorageTimeout", () => ({ title: "Upload failed", description: STORAGE_COPY.timeout })),
		Match.when("StorageError", () => ({ title: "Upload failed", description: STORAGE_COPY.server })),
		Match.when("StorageCancelled", () => ({ title: "Upload failed", description: STORAGE_COPY.aborted })),
		Match.exhaustive,
	)

export const isUploadProblem = Schema.is(UploadProblem)

/**
 * The platform's picker and storage: `pick` opens the picker (`null` when dismissed), `upload`
 * validates, presigns and stores the picked file, answering its public URL.
 */
export class ImageUploads extends Context.Service<
	ImageUploads,
	{
		readonly pick: (kind: UploadKind) => Effect.Effect<PickedImage | null>
		readonly upload: (
			target: UploadTarget,
			image: PickedImage,
		) => Effect.Effect<string, UploadFailedError>
	}
>()("hazel/settings/ImageUploads") {}
