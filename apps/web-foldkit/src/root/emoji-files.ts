/**
 * The browser's `EmojiFiles` for the Custom emojis page (`shared-screens/src/settings/pages/custom-emojis`):
 * a hidden file input, the drop zone's held files, and today's presigned upload (`page/settings/upload.ts`).
 */
import {
	EMOJI_ACCEPT,
	EmojiFileError,
	EmojiFiles,
	type HeldFile,
} from "@hazel/shared-screens/settings/pages/custom-emojis/emoji-files"
import { takeDropped } from "@hazel/ui/web/primitives/controls/dropped"
import { Effect, Layer } from "effect"
import { reasonOfUnknown } from "~/lib/error-messages"
import { uploadFile, validateUploadFile } from "../page/settings/upload"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

/** The files the page holds, by preview URL, until uploaded or released. */
const held = new Map<string, File>()

const hold = (file: File | undefined): Effect.Effect<HeldFile | null, EmojiFileError> =>
	Effect.suspend(() => {
		if (file === undefined) return Effect.succeed(null)
		const problem = validateUploadFile("emoji", file)
		if (problem !== null) return Effect.fail(new EmojiFileError({ reason: problem }))
		const previewUrl = URL.createObjectURL(file)
		held.set(previewUrl, file)
		return Effect.succeed({ previewUrl, fileName: file.name })
	})

/** Today's FileTrigger: a hidden input clicked once; a cancelled pick picks nothing. */
const pickFile = Effect.callback<File | undefined>((resume) => {
	const input = document.createElement("input")
	input.type = "file"
	input.accept = EMOJI_ACCEPT
	input.style.display = "none"
	const done = (file: File | undefined) => {
		input.remove()
		resume(Effect.succeed(file))
	}
	input.addEventListener("change", () => done(input.files?.[0]))
	input.addEventListener("cancel", () => done(undefined))
	document.body.append(input)
	input.click()
})

export const emojiFilesLayer = Layer.effect(
	EmojiFiles,
	Effect.map(Effect.service(HazelApiClient), (api) =>
		EmojiFiles.of({
			pick: Effect.flatMap(pickFile, hold),
			dropped: Effect.suspend(() => hold(takeDropped()[0])),
			upload: (previewUrl, organizationId) => {
				const file = held.get(previewUrl)
				if (file === undefined) return Effect.fail(new EmojiFileError({ reason: "StorageCancelled" }))
				return uploadFile({ _tag: "CustomEmoji", organizationId }, file).pipe(
					Effect.provideService(HazelApiClient, api),
					Effect.mapError(
						(error) =>
							new EmojiFileError({
								reason:
									error._tag === "UploadFailedError"
										? error.problem
										: reasonOfUnknown(error),
							}),
					),
				)
			},
			release: (previewUrl) =>
				Effect.sync(() => {
					if (held.delete(previewUrl)) URL.revokeObjectURL(previewUrl)
				}),
		}),
	),
).pipe(Layer.provide(HazelApiClientLive))
