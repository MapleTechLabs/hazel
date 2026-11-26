/**
 * The UI platform services on iOS: the system pickers and the composer's drops are held in Swift
 * (`__native.files`), uploaded from disk by URLSession after the data layer presigns them
 * (`../attachment-upload.ts`); their bytes never cross into JS. `Clipboard` is `UIPasteboard`.
 */
import { Effect, Layer } from "effect"
import type { HttpClient } from "effect/http"
import type { HazelRpc } from "../../rpc"
import { type UploadTarget, uploadAll } from "../attachment-upload"
import type { ClientDataConfig, Session } from "../services"
import { Clipboard, ClipboardError, Files, FilesError } from "../ui-services"
import { type NativeBridge, type NativeFile, nativeBridge } from "./bridge"

type NativeFiles = NonNullable<NativeBridge["files"]>

/** The PUT of a held file, from disk. Interrupting it cancels the transfer. */
const putHeld =
	(files: NativeFiles, file: NativeFile) =>
	(uploadUrl: string, contentType: string): Effect.Effect<void, FilesError> =>
		Effect.callback<void, FilesError>((resume) => {
			const id = files.upload(file.handle, uploadUrl, contentType, (status, error) =>
				resume(
					error === null && status >= 200 && status < 300
						? Effect.void
						: Effect.fail(new FilesError({ reason: "uploadFailed" })),
				),
			)
			return Effect.sync(() => files.cancel(id))
		})

export interface FilesJscOptions {
	/** The channel the files go to; `undefined` fails the pick (no composer is open). */
	readonly target: () => UploadTarget | undefined
	readonly bridge?: () => NativeBridge
}

export const makeFilesJsc = (options: FilesJscOptions) =>
	Layer.effect(
		Files,
		Effect.gen(function* () {
			const context = yield* Effect.context<
				HazelRpc | HttpClient.HttpClient | Session | ClientDataConfig
			>()
			const bridge = options.bridge ?? nativeBridge
			const upload = (files: NativeFiles, held: ReadonlyArray<NativeFile>) =>
				Effect.gen(function* () {
					if (held.length === 0) return []
					const target = options.target()
					if (target === undefined) return yield* new FilesError({ reason: "uploadFailed" })
					return yield* uploadAll(held, target, (file) => putHeld(files, file))
				}).pipe(
					Effect.provideContext(context),
					// The temporary copies go whatever happened.
					Effect.ensuring(Effect.sync(() => held.forEach((file) => files.release(file.handle)))),
				)
			const filesOf = Effect.suspend(() => {
				const files = bridge().files
				return files === undefined
					? Effect.fail(new FilesError({ reason: "denied" }))
					: Effect.succeed(files)
			})
			return Files.of({
				pick: ({ accept, multiple }) =>
					Effect.flatMap(filesOf, (files) =>
						Effect.callback<ReadonlyArray<NativeFile>, FilesError>((resume) =>
							files.pick(accept, multiple, (picked, error) =>
								resume(
									picked === null
										? Effect.fail(
												new FilesError({
													reason: error === "tooLarge" ? "tooLarge" : "denied",
												}),
											)
										: Effect.succeed(picked),
								),
							),
						).pipe(Effect.flatMap((held) => upload(files, held))),
					),
				dropped: Effect.flatMap(filesOf, (files) => upload(files, files.takeDropped())),
			})
		}),
	)

export const ClipboardJsc = Layer.sync(Clipboard, () =>
	Clipboard.of({
		write: (text) =>
			Effect.suspend(() => {
				const clipboard = nativeBridge().clipboard
				if (clipboard === undefined) return Effect.fail(new ClipboardError({ reason: "unavailable" }))
				return clipboard.write(text)
					? Effect.void
					: Effect.fail(new ClipboardError({ reason: "denied" }))
			}),
	}),
)
