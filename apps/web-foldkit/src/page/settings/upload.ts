import { BotId, OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineTaggedUnion } from "foldkit/schema"
import { type UploadErrorType, uploadToStorage } from "~/lib/upload-to-storage"
import type { CommonError } from "~/lib/error-messages"
import {
	type UploadKind,
	UploadProblem,
	validateUploadFile,
} from "@hazel/shared-screens/settings/shared/upload"
import { HazelApiClient } from "../../rpc"
import { currentServer } from "~/config/server"

/**
 * The settings uploads for the Foldkit pages still on it (custom emoji, profile, bot avatars): the
 * rules and copy are the shared ones (`@hazel/shared-screens/settings/shared/upload`).
 */
export {
	ALLOWED_AVATAR_TYPES,
	ALLOWED_EMOJI_TYPES,
	UploadProblem,
	uploadProblemMessage,
	validateUploadFile,
} from "@hazel/shared-screens/settings/shared/upload"

/** What the file is for; the presign request's `type` and its organization. */
export const UploadTarget = defineTaggedUnion({
	UserAvatar: {},
	BotAvatar: { botId: BotId },
	OrganizationAvatar: { organizationId: OrganizationId },
	CustomEmoji: { organizationId: OrganizationId },
})
export type UploadTarget = typeof UploadTarget.Type

const kindOf = (target: UploadTarget): UploadKind => (target._tag === "CustomEmoji" ? "emoji" : "avatar")

export class UploadFailedError extends Schema.TaggedError<
	UploadFailedError,
	{ readonly brand: unique symbol }
>()("UploadFailedError", {
	problem: UploadProblem,
}) {}

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
		const base = currentServer().cdn
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
