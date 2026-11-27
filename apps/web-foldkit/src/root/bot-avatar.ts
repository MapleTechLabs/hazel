/**
 * `BotAvatarUploads` in the browser: the file input, then today's presigned upload to the bot's
 * avatar target (`page/settings/upload.ts`). A dismissed picker stores nothing.
 */
import { pickWithInput } from "@hazel/client-data/web/ui-services"
import { BotAvatarUploadError, BotAvatarUploads } from "@hazel/shared-screens/modals/bot-avatar"
import { Effect, Layer } from "effect"
import { commonMessage, reasonOfUnknown } from "~/lib/error-messages"
import { UploadTarget, uploadFile, uploadProblemMessage } from "../page/settings/upload"
import { HazelApiClient, HazelApiClientLive } from "../rpc"

const failed = (copy: { readonly title: string; readonly description?: string }) =>
	new BotAvatarUploadError({ title: copy.title, description: copy.description ?? null })

export const botAvatarUploadsLayer = Layer.effect(
	BotAvatarUploads,
	Effect.map(Effect.service(HazelApiClient), (client) =>
		BotAvatarUploads.of({
			pick: (botId) =>
				Effect.gen(function* () {
					const [file] = yield* pickWithInput("media", false)
					if (file === undefined) return null
					return yield* uploadFile(UploadTarget.BotAvatar({ botId }), file).pipe(
						Effect.provideService(HazelApiClient, client),
					)
				}).pipe(
					Effect.mapError((error) =>
						error._tag === "UploadFailedError"
							? failed(uploadProblemMessage("avatar", error.problem))
							: failed(commonMessage(reasonOfUnknown(error))),
					),
				),
		}),
	),
).pipe(Layer.provide(HazelApiClientLive))
