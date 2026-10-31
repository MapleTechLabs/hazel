import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { type UploadErrorType, uploadErrorMessages, uploadToStorage } from "~/lib/upload-to-storage"
import type { CommonError, UserErrorMessage } from "~/lib/error-messages"
import { HazelApiClient } from "../../rpc"

/** Port of `hooks/use-upload.ts` for the settings uploads (avatars, bot avatars, organization logo, custom emoji). */

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024
export const MAX_EMOJI_SIZE = 256 * 1024
export const ALLOWED_AVATAR_TYPES: ReadonlyArray<string> = ["image/jpeg", "image/png", "image/webp"]
export const ALLOWED_EMOJI_TYPES: ReadonlyArray<string> = ["image/png", "image/gif", "image/webp"]

/** What the file is for; the presign request's `type` and its organization. */
export const UploadTarget = defineTaggedUnion({
	UserAvatar: {},
	BotAvatar: { botId: BotId },
	OrganizationAvatar: { organizationId: OrganizationId },
	CustomEmoji: { organizationId: OrganizationId },
})
export type UploadTarget = typeof UploadTarget.Type

/** Avatars and logos share one set of limits; emoji have their own. */
export type UploadKind = "avatar" | "emoji"

const kindOf = (target: UploadTarget): UploadKind => (target._tag === "CustomEmoji" ? "emoji" : "avatar")

/** Why an upload failed before or while storing the file (the backend's own failures are `CommonReason`s). */
export const UploadProblem = Schema.Literals([
	"InvalidType",
	"TooLarge",
	/** `VITE_R2_PUBLIC_URL` is unset, so no public URL can be built. */
	"NotConfigured",
	/** The presign endpoint refused the file (`UploadError`) or its owner is gone. */
	"PresignRejected",
	"StorageOffline",
	"StorageTimeout",
	"StorageError",
	"StorageCancelled",
])
export type UploadProblem = typeof UploadProblem.Type

export class UploadFailedError extends Schema.TaggedError<UploadFailedError>()("UploadFailedError", {
	problem: UploadProblem,
}) {}

/** The file check `uploadFile` runs first, for views and updates that reject a file before uploading it. */
export const validateUploadFile = (kind: UploadKind, file: File): "InvalidType" | "TooLarge" | null => {
	const allowed = kind === "emoji" ? ALLOWED_EMOJI_TYPES : ALLOWED_AVATAR_TYPES
	if (!allowed.includes(file.type)) return "InvalidType"
	if (file.size > (kind === "emoji" ? MAX_EMOJI_SIZE : MAX_AVATAR_SIZE)) return "TooLarge"
	return null
}

const storageProblem: { readonly [T in UploadErrorType]: UploadProblem } = {
	network: "StorageOffline",
	timeout: "StorageTimeout",
	server: "StorageError",
	aborted: "StorageCancelled",
}

const presignPayload = (target: UploadTarget) =>
	UploadTarget.match(target, {
		UserAvatar: () => ({ type: "user-avatar" as const }),
		BotAvatar: ({ botId }) => ({ type: "bot-avatar" as const, botId }),
		OrganizationAvatar: ({ organizationId }) => ({
			type: "organization-avatar" as const,
			organizationId,
		}),
		CustomEmoji: ({ organizationId }) => ({
			type: "custom-emoji" as const,
			organizationId,
		}),
	})

const fail = (problem: UploadProblem) => Effect.fail(new UploadFailedError({ problem }))

/**
 * Validates, presigns and PUTs the file; succeeds with its public URL. The presign call's transport, auth
 * and rate-limit failures stay `CommonError`s for the Command's `catchCommon`.
 */
export const uploadFile = (
	target: UploadTarget,
	file: File,
): Effect.Effect<string, UploadFailedError | CommonError, HazelApiClient> =>
	Effect.gen(function* () {
		const invalid = validateUploadFile(kindOf(target), file)
		if (invalid !== null) return yield* fail(invalid)
		const base = import.meta.env.VITE_R2_PUBLIC_URL
		if (!base) return yield* fail("NotConfigured")
		const presigned = yield* HazelApiClient.use((client) =>
			client.uploads.presign({
				payload: { ...presignPayload(target), contentType: file.type, fileSize: file.size },
			}),
		).pipe(
			Effect.catchTags({
				UploadError: () => fail("PresignRejected"),
				BotNotFoundForUploadError: () => fail("PresignRejected"),
				OrganizationNotFoundForUploadError: () => fail("PresignRejected"),
			}),
		)
		// `uploadToStorage` settles every XHR outcome; a throw is a storage error, not a defect.
		const result = yield* Effect.tryPromise({
			try: () => uploadToStorage(presigned.uploadUrl, file, { timeout: 60000 }),
			catch: () => new UploadFailedError({ problem: "StorageError" }),
		})
		if (!result.success) return yield* fail(storageProblem[result.errorType ?? "server"])
		// The frontend builds the public URL (the backend may not know its public bucket URL).
		return `${base}/${presigned.key}`
	})

/** The copy for an upload problem; the file checks name the kind's types and size limit. */
export const uploadProblemMessage = (kind: UploadKind, problem: UploadProblem): UserErrorMessage => {
	switch (problem) {
		case "InvalidType":
			return {
				title: "Invalid file type",
				description:
					kind === "emoji"
						? "Please select a PNG, GIF, or WebP image"
						: "Please select a JPEG, PNG, or WebP image",
			}
		case "TooLarge":
			return {
				title: "File too large",
				description: `File size must be less than ${kind === "emoji" ? "256KB" : "5MB"}`,
			}
		case "NotConfigured":
			return {
				title: "Configuration error",
				description: "Image upload is not configured. Please contact support.",
			}
		case "PresignRejected":
			return { title: "Upload failed", description: "Failed to get upload URL. Please try again." }
		case "StorageOffline":
			return { title: "Upload failed", description: uploadErrorMessages.network }
		case "StorageTimeout":
			return { title: "Upload failed", description: uploadErrorMessages.timeout }
		case "StorageError":
			return { title: "Upload failed", description: uploadErrorMessages.server }
		case "StorageCancelled":
			return { title: "Upload failed", description: uploadErrorMessages.aborted }
	}
}
