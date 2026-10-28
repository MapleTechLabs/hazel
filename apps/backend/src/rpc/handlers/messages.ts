import { AttachmentRepo, MessageRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { MessageResponse, MessageRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { AttachmentPolicy } from "../../policies/attachment-policy"
import { MessagePolicy } from "../../policies/message-policy"
import { ChannelViewers } from "../../services/channel-viewers"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"
import { emitMessageEvent } from "../../worker/objects/channel/message-events"

/**
 * Message RPC handlers. Run in the message's `ChannelObject` (`rpc/routing.ts`): authorization
 * against its `channel_viewers`, and every side effect (bots, notifications, thread naming,
 * chat-sync) enqueued by `emitMessageEvent` in the write's transaction.
 *
 * The rate limits (60 requests/min per user) run in the api Worker; here they admit everything.
 */
export const MessageRpcLive = MessageRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelViewers = yield* ChannelViewers
		const messagePolicy = yield* MessagePolicy
		const messageRepo = yield* MessageRepo
		const attachmentPolicy = yield* AttachmentPolicy
		const attachmentRepo = yield* AttachmentRepo

		return {
			"message.create": ({ attachmentIds, ...messageData }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* checkMessageRateLimit(user.id)

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* messagePolicy.canCreate(messageData.channelId)
								const conversationId = yield* channelViewers.conversationId
								const createdMessage = yield* messageRepo
									.insert({
										...messageData,
										conversationId,
										authorId: user.id,
										deletedAt: null,
									})
									.pipe(Effect.map((res) => res[0]!))

								if (attachmentIds && attachmentIds.length > 0) {
									yield* Effect.forEach(attachmentIds, (attachmentId) =>
										Effect.gen(function* () {
											yield* attachmentPolicy.canUpdate(attachmentId)
											yield* attachmentRepo.update({
												id: attachmentId,
												messageId: createdMessage.id,
											})
										}),
									)
								}

								yield* emitMessageEvent({ _tag: "MessageCreated", message: createdMessage })

								const txid = yield* generateTransactionId()
								return new MessageResponse({ data: createdMessage, transactionId: txid })
							}),
						)
						.pipe(withRemapDbErrors("Message", "create"))
				}),

			"message.update": ({ id, channelId: _route, ...payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* checkMessageRateLimit(user.id)

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* messagePolicy.canUpdate(id)
								const updatedMessage = yield* messageRepo.update({ id, ...payload })

								yield* emitMessageEvent({ _tag: "MessageUpdated", message: updatedMessage })

								const txid = yield* generateTransactionId()
								return new MessageResponse({ data: updatedMessage, transactionId: txid })
							}),
						)
						.pipe(withRemapDbErrors("Message", "update"))
				}),

			"message.delete": ({ id }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					yield* checkMessageRateLimit(user.id)

					return yield* db
						.transaction(
							Effect.gen(function* () {
								yield* messagePolicy.canDelete(id)
								const existing = yield* messageRepo.findById(id)
								yield* messageRepo.deleteById(id)
								// Its reactions and pins go with it (no foreign keys in the object's SQLite).
								yield* db.run(
									SQLite.deleteFrom(schema.messageReactionsTable).where(($) => [
										$.messageId.eq(id),
									]),
								)
								yield* db.run(
									SQLite.deleteFrom(schema.pinnedMessagesTable).where(($) => [
										$.messageId.eq(id),
									]),
								)

								if (Option.isSome(existing)) {
									yield* emitMessageEvent({
										_tag: "MessageDeleted",
										message: existing.value,
									})
								}

								const txid = yield* generateTransactionId()
								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("Message", "delete"))
				}),
		}
	}),
)
