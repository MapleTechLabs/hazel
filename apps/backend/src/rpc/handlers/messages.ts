import { AttachmentRepo, MessageRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser, MessageNotFoundError, withRemapDbErrors } from "@hazel/domain"
import { HtmlRenderUrlResponse, MessageResponse, MessageRpcs } from "@hazel/domain/rpc"
import type { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { AttachmentPolicy } from "../../policies/attachment-policy"
import { MessagePolicy } from "../../policies/message-policy"
import { ChannelViewers } from "../../services/channel-viewers"
import { HtmlRenders, htmlRenderIdsOf } from "../../services/html-renders"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"
import { SqlClient } from "effect/sql/SqlClient"
import { emitMessageEvent } from "../../worker/objects/channel/message-events"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { StorageEffects } from "../../worker/objects/effects/storage-effects"
import { searchMessages } from "../../worker/objects/org/message-search"

/**
 * Claim (`storage.claimHtmlRenders`) or delete (`storage.deleteHtmlRenders`) the pages of renders a
 * message started or stopped showing, once the write commits.
 */
const enqueueHtmlRenders = (
	kind: typeof StorageEffects.claimHtmlRenders | typeof StorageEffects.deleteHtmlRenders,
	message: { readonly channelId: ChannelId; readonly authorId: UserId },
	renderIds: ReadonlyArray<HtmlRenderId>,
) =>
	renderIds.length === 0
		? Effect.void
		: Effect.asVoid(
				enqueueEffect(
					kind,
					{ kind: "storage" },
					{ channelId: message.channelId, authorId: message.authorId, renderIds },
				),
			).pipe(Effect.catchTag("SchemaError", (error) => Effect.die(error)))

const claimHtmlRenders = (
	message: { readonly channelId: ChannelId; readonly authorId: UserId },
	renderIds: ReadonlyArray<HtmlRenderId>,
) => enqueueHtmlRenders(StorageEffects.claimHtmlRenders, message, renderIds)

const deleteHtmlRenders = (
	message: { readonly channelId: ChannelId; readonly authorId: UserId },
	renderIds: ReadonlyArray<HtmlRenderId>,
) => enqueueHtmlRenders(StorageEffects.deleteHtmlRenders, message, renderIds)

/**
 * Message RPC handlers. Writes run in the message's `ChannelObject` (`rpc/routing.ts`), search in
 * the org's `OrgObject`. Writes: authorization
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
		const sql = yield* SqlClient
		const htmlRenders = yield* HtmlRenders

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

								yield* claimHtmlRenders(
									createdMessage,
									htmlRenderIdsOf(createdMessage.embeds),
								)
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
								const existing =
									payload.embeds === undefined
										? Option.none()
										: yield* messageRepo.findById(id)
								const updatedMessage = yield* messageRepo.update({ id, ...payload })

								if (Option.isSome(existing)) {
									const before = new Set(htmlRenderIdsOf(existing.value.embeds))
									const after = new Set(htmlRenderIdsOf(updatedMessage.embeds))
									yield* claimHtmlRenders(
										updatedMessage,
										[...after].filter((renderId) => !before.has(renderId)),
									)
									yield* deleteHtmlRenders(
										updatedMessage,
										[...before].filter((renderId) => !after.has(renderId)),
									)
								}
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
									yield* deleteHtmlRenders(
										existing.value,
										htmlRenderIdsOf(existing.value.embeds),
									)
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

			// Only through a message that shows the render: its author published the page.
			"message.htmlRenderUrl": ({ channelId, messageId, renderId }) =>
				Effect.gen(function* () {
					yield* messagePolicy.canRead(channelId)
					const message = yield* messageRepo.findById(messageId)
					if (
						Option.isNone(message) ||
						message.value.channelId !== channelId ||
						!htmlRenderIdsOf(message.value.embeds).includes(renderId)
					) {
						return yield* new MessageNotFoundError({ messageId })
					}
					const { url, expiresAt } = yield* htmlRenders.signedUrl({
						channelId,
						authorId: message.value.authorId,
						renderId,
					})
					return new HtmlRenderUrlResponse({ url, expiresAt })
				}).pipe(withRemapDbErrors("Message", "select")),

			// Runs in the org's `OrgObject` (`message-search.ts`), not a channel's.
			"message.search": (payload) =>
				searchMessages(payload).pipe(Effect.provideService(SqlClient, sql)),
		}
	}),
)
