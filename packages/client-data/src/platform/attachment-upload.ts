/**
 * One picked or dropped file uploaded as a channel attachment, as the web composer does
 * (`apps/web-foldkit/src/composer/upload.ts`): presign (`POST /uploads/presign`), the host's PUT of
 * the bytes it holds, then `attachment.complete`, or `attachment.fail` when anything after the
 * presign fails or is interrupted. The bytes never pass through here: `put` is the host's.
 */
import { isActiveContentType, MAX_ATTACHMENT_SIZE } from "@hazel/domain/http"
import { AttachmentId, type ChannelId, type OrganizationId } from "@hazel/schema"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HazelRpc } from "../rpc"
import { ClientDataConfig, Session } from "./services"
import { FilesError, type PickedFile } from "./ui-services"

/** Where the files of a pick go: the composer's channel. */
export interface UploadTarget {
	readonly organizationId: OrganizationId
	readonly channelId: ChannelId
}

/** What the host knows of a file it holds. */
export interface HeldFile {
	readonly name: string
	readonly size: number
	/** MIME type, `""` when unknown. */
	readonly type: string
	readonly width?: number
	readonly height?: number
}

/** The type the file is stored with: one a browser would run as a document is stored as plain bytes. */
export const uploadContentType = (type: string) =>
	type === "" || isActiveContentType(type) ? "application/octet-stream" : type

export const kindOf = (type: string): PickedFile["kind"] =>
	type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file"

const Presigned = Schema.Struct({ uploadUrl: Schema.String, resourceId: Schema.optional(AttachmentId) })
const decodePresigned = Schema.decodeUnknownEffect(Presigned)

const failed = () => new FilesError({ reason: "uploadFailed" })

const presign = (file: HeldFile, target: UploadTarget) =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient
		const config = yield* ClientDataConfig
		const authorization = yield* (yield* Session).authorization
		const request = HttpClientRequest.post(`${config.apiUrl}/uploads/presign`).pipe(
			HttpClientRequest.bodyJsonUnsafe({
				type: "attachment",
				fileName: file.name,
				fileSize: file.size,
				contentType: uploadContentType(file.type),
				organizationId: target.organizationId,
				channelId: target.channelId,
			}),
			authorization === null ? (r) => r : HttpClientRequest.setHeader("authorization", authorization),
		)
		const response = yield* http.execute(request)
		if (response.status < 200 || response.status >= 300) return yield* failed()
		const { uploadUrl, resourceId } = yield* response.json.pipe(Effect.flatMap(decodePresigned))
		// The backend always creates the attachment row for an attachment presign.
		if (resourceId === undefined) return yield* failed()
		return { uploadUrl, attachmentId: resourceId }
	}).pipe(
		Effect.scoped,
		Effect.catchTags({
			HttpClientError: () => Effect.fail(failed()),
			SchemaError: () => Effect.fail(failed()),
			SessionLoadError: () => Effect.fail(failed()),
		}),
	)

/** `attachment.fail`, so the row does not stay pending. Best effort: the upload already failed. */
const markFailed = (id: AttachmentId, channelId: ChannelId, reason: string) =>
	HazelRpc.use((rpc) => rpc("attachment.fail", { id, channelId, reason })).pipe(
		Effect.timeout(Duration.seconds(10)),
		Effect.ignore,
	)

/**
 * Uploads `file` to `target`'s channel. `put` sends the bytes to the presigned URL with the given
 * content type; interrupting the upload interrupts it and marks the attachment failed.
 */
export const uploadAttachment = (
	file: HeldFile,
	target: UploadTarget,
	put: (uploadUrl: string, contentType: string) => Effect.Effect<void, FilesError>,
): Effect.Effect<PickedFile, FilesError, HazelRpc | HttpClient.HttpClient | Session | ClientDataConfig> =>
	Effect.gen(function* () {
		if (file.size > MAX_ATTACHMENT_SIZE) return yield* new FilesError({ reason: "tooLarge" })
		const { uploadUrl, attachmentId } = yield* presign(file, target)
		const { channelId } = target
		yield* put(uploadUrl, uploadContentType(file.type)).pipe(
			Effect.andThen(
				HazelRpc.use((rpc) => rpc("attachment.complete", { id: attachmentId, channelId })),
			),
			Effect.catch(() =>
				markFailed(attachmentId, channelId, "Upload failed").pipe(
					Effect.andThen(Effect.fail(failed())),
				),
			),
			Effect.onInterrupt(() => markFailed(attachmentId, channelId, "Upload cancelled")),
		)
		const picked = { attachmentId, name: file.name, kind: kindOf(file.type), size: file.size }
		// Dimensions go together: a host that measured the file knows both.
		return file.width === undefined || file.height === undefined
			? picked
			: { ...picked, width: file.width, height: file.height }
	})

/** Uploads every file, up to three at once; the first failure fails the batch (others still finish). */
export const uploadAll = <F extends HeldFile>(
	files: ReadonlyArray<F>,
	target: UploadTarget,
	put: (file: F) => (uploadUrl: string, contentType: string) => Effect.Effect<void, FilesError>,
) => Effect.forEach(files, (file) => uploadAttachment(file, target, put(file)), { concurrency: 3 })
