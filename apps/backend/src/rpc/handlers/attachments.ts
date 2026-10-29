import { AttachmentRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { withRemapDbErrors } from "@hazel/domain"
import { AttachmentRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { AttachmentPolicy } from "../../policies/attachment-policy"

/**
 * Attachment RPC handlers. Run in the attachment's `ChannelObject` (routed by the payload's
 * `channelId`), where the upload route created the row (`channel.createAttachment`). Uploads left
 * `uploading` fail on the object's alarm (`worker/objects/channel/uploads.ts`).
 */
export const AttachmentRpcLive = AttachmentRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const attachmentPolicy = yield* AttachmentPolicy
		const attachmentRepo = yield* AttachmentRepo

		return {
			"attachment.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* attachmentPolicy.canDelete(id)
							yield* attachmentRepo.deleteById(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Attachment", "delete")),

			"attachment.complete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* attachmentPolicy.canUpdate(id)
							const attachment = yield* attachmentRepo.update({ id, status: "complete" })

							return attachment
						}),
					)
					.pipe(withRemapDbErrors("Attachment", "update")),

			"attachment.fail": ({ id, reason }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* Effect.logWarning(
								`Marking attachment ${id} as failed${reason ? `: ${reason}` : ""}`,
							)

							yield* attachmentPolicy.canUpdate(id)
							yield* attachmentRepo.update({ id, status: "failed" })
						}),
					)
					.pipe(withRemapDbErrors("Attachment", "update")),
		}
	}),
)
