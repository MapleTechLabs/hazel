// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's side of the shared composer (`@hazel/shared-screens/chat/composer`): the channel page's
 * requests and notices over the bus, the files it holds (an input pick, a drop or paste, a page-wide
 * paste) and uploads with progress (presign, an XHR PUT, `attachment.complete`), the page-wide drag
 * state, and the bot command endpoint. Part of the adapter until the channel page is native (PC8).
 */
import { ExecuteBotCommandRequest, isActiveContentType, MAX_ATTACHMENT_SIZE } from "@hazel/domain/http"
import { AttachmentId, type ChannelId, type OrganizationId } from "@hazel/schema"
import {
	type BotCommandFailure,
	BotCommands,
	ComposerFiles,
	ComposerHost,
	type ComposerNotice,
	type ComposerRequest,
	makeDrafts,
	Drafts,
	type ThreadTarget,
	type UploadEvent,
} from "@hazel/shared-screens/chat/composer/host"
import type { HeldFile } from "@hazel/shared-screens/chat/composer/model"
import { pickWithInput } from "@hazel/client-data/web"
import { takeDropped as takeComposerDropped } from "@hazel/ui/web/primitives/controls/composer"
import { trustCustomEmojiBase } from "@hazel/ui/web/primitives/controls/composer/markdown"
import { takeDropped as takeZoneDropped } from "@hazel/ui/web/primitives/controls/dropped"
import { Duration, Effect, Layer, Queue, Stream } from "effect"
import { currentServer } from "~/config/server"
import { isAcceptedFile } from "../editor/file-types"
import { HazelApiClient, HazelApiClientLive, HazelRpc } from "../rpc"
import { eventsOf, publish } from "./bus"

// ---------------------------------------------------------------------------
// the files the composer holds
// ---------------------------------------------------------------------------

interface Held {
	readonly file: File
	readonly preview: string | null
}

const held = new Map<string, Held>()

const kindOf = (type: string): HeldFile["kind"] =>
	type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : "file"

/** Keeps `files` for the composer: their ids, names and, for an image, a local preview url. */
export const holdFiles = (files: ReadonlyArray<File>): ReadonlyArray<HeldFile> =>
	files.map((file) => {
		const localId = crypto.randomUUID()
		const kind = kindOf(file.type)
		const preview = kind === "image" && typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null
		held.set(localId, { file, preview })
		return { localId, name: file.name, size: file.size, kind, preview }
	})

const release = (localId: string) =>
	Effect.sync(() => {
		const entry = held.get(localId)
		if (entry?.preview != null) URL.revokeObjectURL(entry.preview)
		held.delete(localId)
	})

// ---------------------------------------------------------------------------
// uploads
// ---------------------------------------------------------------------------

/** One a browser would run as a document is stored as plain bytes. */
const contentTypeOf = (file: File) =>
	file.type === "" || isActiveContentType(file.type) ? "application/octet-stream" : file.type

const STORAGE_TIMEOUT_MS = 120_000

/** The presigned PUT with progress (0 to 1); interrupting it aborts the request. */
const put = (uploadUrl: string, file: File, onProgress: (progress: number) => void) =>
	Effect.callback<boolean>((resume) => {
		const xhr = new XMLHttpRequest()
		xhr.timeout = STORAGE_TIMEOUT_MS
		xhr.upload.onprogress = (event) => {
			if (event.lengthComputable) onProgress(event.loaded / event.total)
		}
		xhr.onload = () => resume(Effect.succeed(xhr.status >= 200 && xhr.status < 300))
		xhr.onerror = () => resume(Effect.succeed(false))
		xhr.ontimeout = () => resume(Effect.succeed(false))
		xhr.open("PUT", uploadUrl)
		xhr.setRequestHeader("Content-Type", contentTypeOf(file))
		xhr.send(file)
		return Effect.sync(() => xhr.abort())
	})

/** `attachment.fail`, so the row does not stay pending; best effort, the upload already failed. */
const markFailed = (id: AttachmentId, channelId: ChannelId, reason: string) =>
	HazelRpc.use((rpc) => rpc("attachment.fail", { id, channelId, reason })).pipe(
		Effect.timeout(Duration.seconds(10)),
		Effect.ignore,
	)

const uploadOne = (
	file: File,
	args: { readonly organizationId: OrganizationId; readonly channelId: ChannelId },
	onProgress: (progress: number) => void,
): Effect.Effect<UploadEvent, never, HazelRpc | HazelApiClient> => {
	const failed = (reason: Extract<UploadEvent, { _tag: "Failed" }>["reason"]): UploadEvent => ({
		_tag: "Failed",
		reason,
	})
	if (!isAcceptedFile(file)) return Effect.succeed(failed("Unsupported"))
	if (file.size > MAX_ATTACHMENT_SIZE) return Effect.succeed(failed("TooLarge"))
	return HazelApiClient.use((client) =>
		client.uploads.presign({
			payload: {
				type: "attachment" as const,
				fileName: file.name,
				fileSize: file.size,
				contentType: contentTypeOf(file),
				organizationId: args.organizationId,
				channelId: args.channelId,
			},
		}),
	).pipe(
		Effect.flatMap(({ uploadUrl, resourceId }) => {
			// The backend always creates the attachment row for an attachment presign.
			if (!resourceId) return Effect.succeed(failed("Rejected"))
			const id = AttachmentId.make(resourceId)
			return put(uploadUrl, file, onProgress).pipe(
				Effect.flatMap((stored) =>
					stored
						? HazelRpc.use((rpc) => rpc("attachment.complete", { id, channelId: args.channelId })).pipe(
								Effect.as<UploadEvent>({ _tag: "Uploaded", attachmentId: id }),
								Effect.catchCause(() =>
									markFailed(id, args.channelId, "Failed to finalize upload").pipe(
										Effect.as(failed("Failed")),
									),
								),
							)
						: markFailed(id, args.channelId, "Storage upload failed").pipe(Effect.as(failed("Network"))),
				),
				Effect.onInterrupt(() => markFailed(id, args.channelId, "Upload cancelled")),
			)
		}),
		Effect.catchTags({
			UploadError: () => Effect.succeed(failed("Rejected")),
			BotNotFoundForUploadError: () => Effect.succeed(failed("Rejected")),
			OrganizationNotFoundForUploadError: () => Effect.succeed(failed("Rejected")),
		}),
		// BOUNDARY: a transport or decode failure of the presign: the tile offers a retry.
		Effect.catchCause(() => Effect.succeed(failed("Network"))),
	)
}

/** `ComposerFiles` on the web: the browser's picker, the composer's drops and pastes, XHR uploads. */
const filesLayer = Layer.effect(
	ComposerFiles,
	Effect.gen(function* () {
		const context = yield* Effect.context<HazelRpc | HazelApiClient>()
		return ComposerFiles.of({
			pick: Effect.map(pickWithInput("any", true), holdFiles),
			dropped: Effect.sync(() => {
				const files = takeComposerDropped()
				return holdFiles(files.length > 0 ? files : takeZoneDropped())
			}),
			upload: ({ localId, organizationId, channelId }) => {
				const entry = held.get(localId)
				if (entry === undefined) return Stream.succeed<UploadEvent>({ _tag: "Failed", reason: "Failed" })
				return Stream.callback<UploadEvent>((queue) =>
					uploadOne(entry.file, { organizationId, channelId }, (progress) =>
						Queue.offerUnsafe(queue, { _tag: "Progressed", progress }),
					).pipe(
						Effect.flatMap((result) => Queue.offer(queue, result)),
						Effect.andThen(Effect.never),
						Effect.provideContext(context),
					),
				)
			},
			release,
		})
	}),
)

// ---------------------------------------------------------------------------
// the page around it
// ---------------------------------------------------------------------------

/** Files dragged anywhere over the page, as today's `useDragDetection` counts them. */
const dragging = Stream.callback<boolean>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			let depth = 0
			const report = () => Queue.offerUnsafe(queue, depth > 0)
			const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false
			const enter = (event: DragEvent) => {
				if (!carriesFiles(event)) return
				depth++
				report()
			}
			const leave = () => {
				depth = Math.max(0, depth - 1)
				report()
			}
			const reset = () => {
				depth = 0
				report()
			}
			document.addEventListener("dragenter", enter)
			document.addEventListener("dragleave", leave)
			document.addEventListener("drop", reset)
			document.addEventListener("dragend", reset)
			return () => {
				document.removeEventListener("dragenter", enter)
				document.removeEventListener("dragleave", leave)
				document.removeEventListener("drop", reset)
				document.removeEventListener("dragend", reset)
			}
		}),
		(stop) => Effect.sync(stop),
	).pipe(Effect.andThen(Effect.never)),
)

const appDrafts = makeDrafts()

/** The open thread panel's thread, kept so a composer mounted later starts from it. */
let currentThread: ThreadTarget | null = null

/** The channel page reports its thread panel (opened, created, closed). */
export const reportThread = (thread: ThreadTarget | null) => {
	currentThread = thread
	publish({ _tag: "ComposerThread", thread })
}

/** What the channel page asks of a composer, over the bus. */
export const requestComposer = (channelId: ChannelId, request: ComposerRequest) =>
	publish({ _tag: "ComposerRequest", channelId, request })

const hostLayer = Layer.succeed(
	ComposerHost,
	ComposerHost.of({
		requests: (channelId) =>
			eventsOf("ComposerRequest").pipe(
				Stream.filter((event) => event.channelId === channelId),
				Stream.map((event) => event.request),
			),
		notify: (notice: ComposerNotice) => Effect.sync(() => publish({ _tag: "ComposerNotice", notice })),
		dragging,
		thread: Stream.concat(
			Stream.suspend(() => Stream.succeed(currentThread)),
			eventsOf("ComposerThread").pipe(Stream.map(({ thread }) => thread)),
		),
	}),
)

const failureOf = (tag: string): BotCommandFailure =>
	tag === "BotNotFoundError"
		? "BotNotFound"
		: tag === "BotNotInstalledError"
			? "BotNotInstalled"
			: tag === "BotCommandNotFoundError"
				? "CommandNotFound"
				: tag === "BotCommandExecutionError"
					? "ExecutionFailed"
					: "Unavailable"

const botCommandsLayer = Layer.effect(
	BotCommands,
	Effect.map(Effect.service(HazelApiClient), (client) =>
		BotCommands.of({
			execute: ({ orgId, botId, commandName, channelId, arguments: args }) =>
				client["bot-commands"]
					.executeBotCommand({
						params: { orgId, botId, commandName },
						payload: new ExecuteBotCommandRequest({ channelId, arguments: [...args] }),
					})
					.pipe(
						Effect.asVoid,
						// BOUNDARY: the API's errors by tag, anything else as unavailable.
						Effect.mapError((error) =>
							failureOf(typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : ""),
						),
					),
		}),
	),
).pipe(Layer.provide(HazelApiClientLive))

/** What the shared composer needs from the web, over the app's RPC client and API. */
export const composerWebLayer = Layer.mergeAll(
	hostLayer,
	filesLayer.pipe(Layer.provide(HazelApiClientLive)),
	botCommandsLayer,
	// One store for the app, so a channel keeps its draft across composer mounts.
	Layer.succeed(Drafts, appDrafts),
	// Custom emoji in a draft draw from the server's storage only (W12b).
	Layer.effectDiscard(Effect.sync(() => trustCustomEmojiBase(currentServer().cdn ?? undefined))),
)

/** The parity flag (`compare-pages.ts`): `"0"` draws today's Foldkit composer instead. */
export const COMPOSER_PARITY_FLAG = "hazel:native:Composer"

// The parity runner sets the flag before the app loads.
export const isComposerNative = (): boolean =>
	typeof localStorage === "undefined" || localStorage.getItem(COMPOSER_PARITY_FLAG) !== "0"
