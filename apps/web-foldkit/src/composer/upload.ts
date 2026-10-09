import { AttachmentId, ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Exit, Queue, Schema, Stream } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { type UploadErrorType, uploadErrorMessages, uploadToStorage } from "~/lib/upload-to-storage"
import { ToastRequest } from "../overlay/toasts"
import { HazelRpc } from "../rpc"
import { errorToast, runAtomFn } from "../data/actions"

/**
 * Port of `useFileUpload().uploadFile`: presign (`uploads.presign`), PUT with progress, then
 * `attachment.complete`, or `attachment.fail` with the legacy reason. Runs as a Stream so the
 * progress reaches the Model; the last event says how it ended.
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024

export const UploadEvent = defineMessageUnion({
	ProgressedUpload: { fileId: Schema.String, progress: Schema.Number },
	FinishedUpload: {
		fileId: Schema.String,
		attachmentId: Schema.NullOr(AttachmentId),
		toast: Schema.NullOr(ToastRequest),
	},
})
export type UploadEvent = typeof UploadEvent.Type

export interface UploadArgs {
	readonly fileId: string
	readonly file: File
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
}

const presign = HazelApiClient.mutation("uploads", "presign")

const markFailed = (id: AttachmentId, reason: string) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		yield* client("attachment.fail", { id, reason })
	}).pipe(Effect.ignore)

const upload = (args: UploadArgs, onProgress: (percent: number) => void) =>
	Effect.gen(function* () {
		const { file } = args
		if (file.size > MAX_FILE_SIZE) {
			return { attachmentId: null, toast: errorToast("File too large", `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`) }
		}
		const presigned = yield* Effect.exit(
			runAtomFn(presign, {
				payload: {
					type: "attachment" as const,
					fileName: file.name,
					fileSize: file.size,
					contentType: file.type || "application/octet-stream",
					organizationId: args.organizationId,
					channelId: args.channelId,
				},
			}),
		)
		if (Exit.isFailure(presigned)) {
			return { attachmentId: null, toast: errorToast("Upload failed", "Failed to get upload URL. Please try again.") }
		}
		const { uploadUrl, resourceId } = presigned.value
		if (!resourceId) {
			return {
				attachmentId: null,
				toast: errorToast("Upload failed", "Failed to create attachment record. Please try again."),
			}
		}
		const attachmentId = AttachmentId.make(resourceId)
		const stored = yield* Effect.promise(() => uploadToStorage(uploadUrl, file, { timeout: 120000, onProgress }))
		if (!stored.success) {
			const errorType: UploadErrorType = stored.errorType ?? "server"
			if (errorType === "aborted") {
				yield* markFailed(attachmentId, "Upload cancelled")
				return { attachmentId: null, toast: null }
			}
			yield* markFailed(attachmentId, `Storage upload failed: ${stored.errorType}`)
			return { attachmentId: null, toast: errorToast("Upload failed", uploadErrorMessages[errorType]) }
		}
		const completed = yield* Effect.exit(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("attachment.complete", { id: attachmentId })
			}),
		)
		if (Exit.isFailure(completed)) {
			yield* markFailed(attachmentId, "Failed to finalize upload")
			return { attachmentId: null, toast: errorToast("Upload failed", "Failed to finalize upload. Please try again.") }
		}
		return { attachmentId, toast: null }
	})

/** The upload of one file as events: progress percentages, then `FinishedUpload`. */
export const uploadStream = (args: UploadArgs): Stream.Stream<UploadEvent, never, HazelRpc> =>
	Stream.callback<UploadEvent, never, HazelRpc>((queue) =>
		upload(args, (progress) => Queue.offerUnsafe(queue, UploadEvent.ProgressedUpload({ fileId: args.fileId, progress }))).pipe(
			Effect.catchCause(() =>
				Effect.succeed({
					attachmentId: null,
					toast: errorToast("Upload failed", "An unexpected error occurred. Please try again."),
				}),
			),
			Effect.flatMap((result) =>
				Queue.offer(queue, UploadEvent.FinishedUpload({ fileId: args.fileId, ...result })),
			),
			Effect.andThen(Effect.never),
		),
	)
