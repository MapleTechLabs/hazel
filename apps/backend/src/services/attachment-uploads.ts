/**
 * Starting an attachment upload: the `uploading` row in the channel's `ChannelObject` (a Connect
 * mount's host), which refuses a writer who cannot see the channel. Shared by the web app's
 * presigned uploads (`routes/uploads.http.ts`) and the MCP server's file tools (`routes/mcp.ts`).
 */
import { withRemapDbErrors } from "@hazel/domain"
import { UploadError } from "@hazel/domain/http"
import { Effect, Option, Schema } from "effect"
import { AttachmentEffects, type CreateAttachmentPayload } from "../worker/objects/channel/attachments"
import { WORKER_SENDER } from "../worker/objects/effects/registry"
import { channelTarget } from "../worker/objects/kinds"
import { ObjectStubs } from "../worker/objects/protocol"
import { Directory } from "./directory"

export const createAttachmentInChannel = Effect.fn("Uploads.createAttachment")(function* (
	payload: CreateAttachmentPayload,
) {
	const directory = yield* Directory
	const stubs = yield* ObjectStubs
	const index = yield* directory
		.channel(payload.channelId)
		.pipe(withRemapDbErrors("ChannelIndex", "select"))
	const hostId = Option.match(index, {
		onNone: () => payload.channelId,
		onSome: (row) => row.hostChannelId ?? payload.channelId,
	})
	const kind = AttachmentEffects.createAttachment
	const result = yield* stubs
		.get(channelTarget(hostId))
		.applyEffect({
			objectId: hostId,
			kind: kind.name,
			payload: yield* Schema.encodeEffect(kind.payload)(payload).pipe(Effect.orDie),
			key: `attachment:${payload.id}`,
			sender: WORKER_SENDER,
		})
		.pipe(Effect.mapError(() => new UploadError({ message: "The channel is unreachable" })))
	if (result._tag === "Rejected") {
		yield* Effect.logWarning("Attachment upload refused", { message: result.message })
		return yield* new UploadError({ message: "You can't upload to this channel" })
	}
})
