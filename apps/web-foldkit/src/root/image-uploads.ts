// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The browser's `ImageUploads` for the settings pages: the file input picks, the page keeps only a
 * handle, and the upload is today's presign and PUT (`page/settings/upload.ts`).
 */
import { pickWithInput } from "@hazel/client-data/web"
import { reasonOf } from "@hazel/shared-screens/modals/feedback"
import {
	ImageUploads,
	type PickedImage,
	UploadFailedError,
	type UploadTarget,
} from "@hazel/shared-screens/settings/shared/upload"
import { Cause, Effect, Layer, Match, Option } from "effect"
import { UploadTarget as FoldkitTarget, uploadFile } from "../page/settings/upload"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

const toFoldkit = (target: UploadTarget): FoldkitTarget =>
	Match.value(target).pipe(
		Match.tagsExhaustive({
			UserAvatar: () => FoldkitTarget.UserAvatar(),
			BotAvatar: ({ botId }) => FoldkitTarget.BotAvatar({ botId }),
			OrganizationAvatar: ({ organizationId }) => FoldkitTarget.OrganizationAvatar({ organizationId }),
			CustomEmoji: ({ organizationId }) => FoldkitTarget.CustomEmoji({ organizationId }),
		}),
	)

export const imageUploadsLayer = Layer.effect(
	ImageUploads,
	Effect.gen(function* () {
		const api = yield* HazelApiClient
		// The picked files, by the handle the page holds; an upload takes its file.
		const held = new Map<string, File>()
		let next = 0
		return ImageUploads.of({
			pick: () =>
				Effect.map(pickWithInput("media", false), (files): PickedImage | null => {
					const file = files[0]
					if (file === undefined) return null
					next += 1
					const id = `image-${next}`
					held.set(id, file)
					return { id, name: file.name, type: file.type, size: file.size }
				}),
			upload: (target, image) =>
				Effect.suspend(() => {
					const file = held.get(image.id)
					held.delete(image.id)
					if (file === undefined)
						return Effect.fail(new UploadFailedError({ failure: "StorageCancelled" }))
					return uploadFile(toFoldkit(target), file).pipe(
						Effect.provideService(HazelApiClient, api),
						Effect.catchTag("UploadFailedError", (error) =>
							Effect.fail(new UploadFailedError({ failure: error.problem })),
						),
						// BOUNDARY: the presign's transport, auth and rate-limit failures read as their common reason.
						Effect.catchCause((cause) =>
							Effect.fail(
								Option.match(Cause.findErrorOption(cause), {
									onNone: () => new UploadFailedError({ failure: "Unexpected" }),
									onSome: (error) =>
										error instanceof UploadFailedError
											? error
											: new UploadFailedError({ failure: reasonOf(error) }),
								}),
							),
						),
					)
				}),
		})
	}),
).pipe(Layer.provide(HazelApiClientLive))
