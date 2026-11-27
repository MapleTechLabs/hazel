// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Picking and storing a bot's avatar: the host opens its picker and uploads the image to the bot's
 * avatar target (`Files` uploads attachments only). The web's is `web-foldkit/src/root/bot-avatar.ts`.
 */
import type { BotId } from "@hazel/schema"
import { Context, type Effect, Schema } from "effect"

/** Why the pick or upload failed, already worded for a toast. */
export class BotAvatarUploadError extends Schema.TaggedError<BotAvatarUploadError>()("BotAvatarUploadError", {
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
}) {}

/** `pick` succeeds with the stored image's public URL, or null when the picker was dismissed. */
export class BotAvatarUploads extends Context.Service<
	BotAvatarUploads,
	{ readonly pick: (botId: BotId) => Effect.Effect<string | null, BotAvatarUploadError> }
>()("hazel/modals/BotAvatarUploads") {}
