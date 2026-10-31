import { isActiveContentType } from "@hazel/domain/http"
import { AttachmentId, type ChannelId, type OrganizationId } from "@hazel/schema"
import { Duration, Effect, Queue, Schema, Stream } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import { HazelApiClient, HazelRpc } from "../rpc"

/**
 * Port of `useFileUpload().uploadFile`: presign (`uploads.presign`), PUT with progress, then
 * `attachment.complete`, or `attachment.fail` with the legacy reason. Runs as a Stream so the
 * progress reaches the Model; the last event says how it ended. Stopping the Stream (a channel
 * switch, a closed thread) aborts the PUT and marks the attachment failed.
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024

/** What can go wrong with one upload, beyond the shared reasons. */
export const UploadFailure = Schema.Union([
	Schema.Literals([
		"FileTooLarge",
		/** The server refused to presign (quota, unknown organization). */
		"Rejected",
		"StorageNetwork",
		"StorageTimeout",
		"StorageServer",
		/** The file was stored but its attachment could not be completed. */
		"NotCompleted",
	]),
	CommonReason,
])
export type UploadFailure = typeof UploadFailure.Type

export const UploadEvent = defineMessageUnion({
	ProgressedUpload: { fileId: Schema.String, progress: Schema.Number },
	SucceededUpload: { fileId: Schema.String, attachmentId: AttachmentId },
	FailedUpload: { fileId: Schema.String, reason: UploadFailure },
})
export type UploadEvent = typeof UploadEvent.Type

export interface UploadArgs {
	readonly fileId: string
	readonly file: File
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
}

const STORAGE_TIMEOUT_MS = 120_000

class StorageUploadError extends Schema.TaggedError<StorageUploadError>()("StorageUploadError", {
	reason: Schema.Literals(["StorageNetwork", "StorageTimeout", "StorageServer"]),
}) {}

/** The type the file is stored with: one a browser would run as a document is stored as plain bytes. */
const uploadContentType = (file: File) =>
	file.type === "" || isActiveContentType(file.type) ? "application/octet-stream" : file.type

/** The presigned PUT, with progress. Interrupting it aborts the request. */
const putToStorage = (uploadUrl: string, file: File, onProgress: (percent: number) => void) =>
	Effect.callback<void, StorageUploadError>((resume) => {
		const xhr = new XMLHttpRequest()
		xhr.timeout = STORAGE_TIMEOUT_MS
		const fail = (reason: StorageUploadError["reason"]) =>
			resume(Effect.fail(new StorageUploadError({ reason })))
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100))
		}
		xhr.onload = () =>
			xhr.status >= 200 && xhr.status < 300 ? resume(Effect.void) : fail("StorageServer")
		xhr.onerror = () => fail("StorageNetwork")
		xhr.ontimeout = () => fail("StorageTimeout")
		xhr.open("PUT", uploadUrl)
		xhr.setRequestHeader("Content-Type", uploadContentType(file))
		xhr.send(file)
		return Effect.sync(() => xhr.abort())
	})

/** `attachment.fail`, so the row does not stay pending. Best-effort: the upload already failed for the user. */
const markFailed = (id: AttachmentId, channelId: ChannelId, reason: string) =>
	HazelRpc.use((client) => client("attachment.fail", { id, channelId, reason })).pipe(
		Effect.timeout(Duration.seconds(10)),
		Effect.ignore,
	)

const completeAttachment = (id: AttachmentId, channelId: ChannelId) =>
	HazelRpc.use((client) => client("attachment.complete", { id, channelId }))

/** Store the file for a presigned attachment and complete it; on any failure the attachment is marked failed. */
const storeAndComplete = (
	args: UploadArgs,
	uploadUrl: string,
	attachmentId: AttachmentId,
	onProgress: (percent: number) => void,
) =>
	putToStorage(uploadUrl, args.file, onProgress).pipe(
		Effect.andThen(completeAttachment(attachmentId, args.channelId)),
		Effect.as(UploadEvent.SucceededUpload({ fileId: args.fileId, attachmentId })),
		Effect.catchTags({
			StorageUploadError: ({ reason }) =>
				markFailed(attachmentId, args.channelId, `Storage upload failed: ${reason}`).pipe(
					Effect.as(UploadEvent.FailedUpload({ fileId: args.fileId, reason })),
				),
			AttachmentNotFoundError: () =>
				Effect.succeed(UploadEvent.FailedUpload({ fileId: args.fileId, reason: "NotCompleted" })),
		}),
		// What is left is a common failure of `attachment.complete`.
		Effect.tapError(() => markFailed(attachmentId, args.channelId, "Failed to finalize upload")),
		Effect.onInterrupt(() => markFailed(attachmentId, args.channelId, "Upload cancelled")),
	)

const upload = (args: UploadArgs, onProgress: (percent: number) => void) => {
	const failed = (reason: UploadFailure) => UploadEvent.FailedUpload({ fileId: args.fileId, reason })
	const { file } = args
	if (file.size > MAX_FILE_SIZE) return Effect.succeed(failed("FileTooLarge"))
	return HazelApiClient.use((client) =>
		client.uploads.presign({
			payload: {
				type: "attachment" as const,
				fileName: file.name,
				fileSize: file.size,
				contentType: uploadContentType(file),
				organizationId: args.organizationId,
				channelId: args.channelId,
			},
		}),
	).pipe(
		Effect.flatMap(({ uploadUrl, resourceId }) =>
			// The backend always creates the attachment row for an attachment presign.
			resourceId
				? storeAndComplete(args, uploadUrl, AttachmentId.make(resourceId), onProgress)
				: Effect.succeed(failed("Unexpected")),
		),
		Effect.catchTags({
			UploadError: () => Effect.succeed(failed("Rejected")),
			BotNotFoundForUploadError: () => Effect.succeed(failed("Rejected")),
			OrganizationNotFoundForUploadError: () => Effect.succeed(failed("Rejected")),
		}),
		catchCommon(failed),
	)
}

/** The upload of one file as events: progress percentages, then `SucceededUpload` or `FailedUpload`. */
export const uploadStream = (
	args: UploadArgs,
): Stream.Stream<UploadEvent, never, HazelRpc | HazelApiClient> =>
	Stream.callback<UploadEvent, never, HazelRpc | HazelApiClient>((queue) =>
		upload(args, (progress) =>
			Queue.offerUnsafe(queue, UploadEvent.ProgressedUpload({ fileId: args.fileId, progress })),
		).pipe(
			Effect.flatMap((result) => Queue.offer(queue, result)),
			Effect.andThen(Effect.never),
		),
	)
