import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { uploadErrorMessages, uploadToStorage } from "~/lib/upload-to-storage"
import { runAtomFn } from "./effects"

/** Port of `hooks/use-upload.ts` for the settings uploads (organization logo, custom emoji). */

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024
export const MAX_EMOJI_SIZE = 256 * 1024
export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"]
export const ALLOWED_EMOJI_TYPES = ["image/png", "image/gif", "image/webp"]

export class UploadFailedError extends Schema.TaggedError<UploadFailedError>()("UploadFailedError", {
	message: Schema.String,
	description: Schema.NullOr(Schema.String),
}) {}

export type UploadTarget =
	| { readonly type: "organization-avatar"; readonly organizationId: OrganizationId }
	| { readonly type: "custom-emoji"; readonly organizationId: OrganizationId }

const fail = (message: string, description: string | null) =>
	Effect.fail(new UploadFailedError({ message, description }))

const presign = HazelApiClient.mutation("uploads", "presign")

/** Validates, presigns and PUTs the file; succeeds with the storage key (the legacy `UploadResult`). */
export const uploadFile = (target: UploadTarget, file: File): Effect.Effect<string, UploadFailedError> =>
	Effect.gen(function* () {
		const isEmoji = target.type === "custom-emoji"
		const allowed = isEmoji ? ALLOWED_EMOJI_TYPES : ALLOWED_AVATAR_TYPES
		if (!allowed.includes(file.type)) {
			return yield* fail(
				"Invalid file type",
				isEmoji ? "Please select a PNG, GIF, or WebP image" : "Please select a JPEG, PNG, or WebP image",
			)
		}
		const maxSize = isEmoji ? MAX_EMOJI_SIZE : MAX_AVATAR_SIZE
		if (file.size > maxSize) {
			return yield* fail(
				"File too large",
				`File size must be less than ${isEmoji ? "256KB" : `${maxSize / 1024 / 1024}MB`}`,
			)
		}
		const presigned = yield* runAtomFn(presign, {
			payload: {
				type: target.type,
				organizationId: target.organizationId,
				contentType: file.type,
				fileSize: file.size,
			},
		}).pipe(Effect.catch(() => fail("Upload failed", "Failed to get upload URL. Please try again.")))
		const result = yield* Effect.promise(() =>
			uploadToStorage(presigned.uploadUrl, file, { timeout: 60000 }),
		)
		if (!result.success) {
			return yield* fail("Upload failed", uploadErrorMessages[result.errorType ?? "server"])
		}
		return presigned.key
	})

/** The public URL the frontend builds from the key (the backend may not know its public bucket URL). */
export const publicUrlOf = (key: string): string | null => {
	const base = import.meta.env.VITE_R2_PUBLIC_URL
	return base ? `${base}/${key}` : null
}
