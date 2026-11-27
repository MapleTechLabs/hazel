/**
 * The UI platform services in a browser: `Files.pick` opens a file input, `Files.dropped` takes
 * the files the web composer held from its last drop or paste (`holdDroppedFiles`), and both upload
 * as channel attachments (`../attachment-upload.ts`, a `fetch` PUT of the `File`). `Clipboard.write`
 * is `navigator.clipboard.writeText`.
 */
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/http"
import type { HazelRpc } from "../../rpc"
import { type HeldFile, type UploadTarget, uploadAll } from "../attachment-upload"
import type { ClientDataConfig, Session } from "../services"
import { Clipboard, ClipboardError, Files, FilesError, type PickAccept } from "../ui-services"

type FileLike = Pick<File, "name" | "size" | "type">

/** The files of the composer's last `files` event, until `Files.dropped` takes them. */
let dropped: ReadonlyArray<File> = []

/** The web composer keeps a drop's or paste's files here when it sends `files` (lane A2). */
export const holdDroppedFiles = (files: Iterable<File>): void => {
	dropped = [...files]
}

const ACCEPT = { any: "", media: "image/*,video/*" } satisfies Record<PickAccept, string>

/**
 * The browser's picker. A dismissed picker fires `cancel` (and, where it does not, the next focus
 * of the window with no `change` ends the pick empty).
 */
export const pickWithInput = (accept: PickAccept, multiple: boolean): Effect.Effect<ReadonlyArray<File>> =>
	Effect.callback<ReadonlyArray<File>>((resume) => {
		const input = document.createElement("input")
		input.type = "file"
		input.multiple = multiple
		if (ACCEPT[accept] !== "") input.accept = ACCEPT[accept]
		input.style.display = "none"
		let done = false
		const finish = (files: ReadonlyArray<File>) => {
			if (done) return
			done = true
			window.removeEventListener("focus", onFocus)
			input.remove()
			resume(Effect.succeed(files))
		}
		const onFocus = () => setTimeout(() => finish([...(input.files ?? [])]), 500)
		input.addEventListener("change", () => finish([...(input.files ?? [])]))
		input.addEventListener("cancel", () => finish([]))
		window.addEventListener("focus", onFocus)
		document.body.append(input)
		input.click()
		return Effect.sync(() => {
			done = true
			window.removeEventListener("focus", onFocus)
			input.remove()
		})
	})

/** An image's size, when the browser can decode it; nothing for other files. */
const measured = (file: File): Effect.Effect<HeldFile & { readonly file: File }> =>
	Effect.promise(async () => {
		const base = { name: file.name, size: file.size, type: file.type, file }
		if (!file.type.startsWith("image/") || typeof createImageBitmap !== "function") return base
		try {
			const bitmap = await createImageBitmap(file)
			const size = { width: bitmap.width, height: bitmap.height }
			bitmap.close()
			return { ...base, ...size }
		} catch {
			return base
		}
	})

/** The presigned PUT of a `File`. */
export const putFile =
	(file: FileLike & Blob) =>
	(uploadUrl: string, contentType: string): Effect.Effect<void, FilesError> =>
		Effect.tryPromise({
			try: (signal) =>
				fetch(uploadUrl, {
					method: "PUT",
					body: file,
					headers: { "content-type": contentType },
					signal,
				}),
			catch: () => new FilesError({ reason: "uploadFailed" }),
		}).pipe(
			Effect.flatMap((response) =>
				response.ok ? Effect.void : Effect.fail(new FilesError({ reason: "uploadFailed" })),
			),
		)

export interface FilesWebOptions {
	/** The channel the files go to; `undefined` fails the pick (no composer is open). */
	readonly target: () => UploadTarget | undefined
	/** The picker; a test passes its own. */
	readonly pick?: (accept: PickAccept, multiple: boolean) => Effect.Effect<ReadonlyArray<File>>
}

/** `Files` in a browser. Needs the data layer's RPC, HTTP client, session and config. */
export const FilesWeb = (options: FilesWebOptions) =>
	Layer.effect(
		Files,
		Effect.gen(function* () {
			const context = yield* Effect.context<
				HazelRpc | HttpClient.HttpClient | Session | ClientDataConfig
			>()
			const pick = options.pick ?? pickWithInput
			const upload = (files: ReadonlyArray<File>) =>
				Effect.gen(function* () {
					if (files.length === 0) return []
					const target = options.target()
					if (target === undefined) return yield* new FilesError({ reason: "uploadFailed" })
					const held = yield* Effect.forEach(files, measured)
					return yield* uploadAll(held, target, (file) => putFile(file.file))
				}).pipe(Effect.provideContext(context))
			return Files.of({
				pick: ({ accept, multiple }) => Effect.flatMap(pick(accept, multiple), upload),
				dropped: Effect.suspend(() => {
					const files = dropped
					dropped = []
					return upload(files)
				}),
			})
		}),
	)

/** `navigator.clipboard`: refused without permission or focus (`denied`), absent off a secure origin. */
export const ClipboardWeb = Layer.succeed(
	Clipboard,
	Clipboard.of({
		write: (text) =>
			Effect.suspend(() => {
				const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard
				if (clipboard?.writeText === undefined)
					return Effect.fail(new ClipboardError({ reason: "unavailable" }))
				return Effect.tryPromise({
					try: () => clipboard.writeText(text),
					catch: () => new ClipboardError({ reason: "denied" }),
				})
			}),
	}),
)
