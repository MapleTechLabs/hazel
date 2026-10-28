import { AttachmentRepo, MessageOutboxRepo, MessageRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { MessageResponse, MessageRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { AttachmentPolicy } from "../../policies/attachment-policy"
import { MessagePolicy } from "../../policies/message-policy"
import { BotGatewayService } from "../../services/bot-gateway-service"
import { ChannelViewers } from "../../services/channel-viewers"
import { BotGatewayEffects } from "../../worker/objects/effects/bot-gateway-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"

/**
 * Message RPC Handlers. Run in the message's `ChannelObject` (`rpc/routing.ts`).
 *
 * Ported: `message.create` (viewer authorization, bot events through the object's outbox).
 * TODO(do-sync) `message.update` / `message.delete`: authorize with `MessagePolicy` (ported) and
 * replace `MessageOutboxRepo` + the inline `botGateway.publishMessageEvent` with
 * `enqueueEffect(BotGatewayEffects.messageEvent, ...)` as `message.create` does; the global
 * message outbox goes away.
 *
 * Implements the business logic for all message-related RPC methods.
 * Each handler receives the payload and has access to CurrentUser via Effect context
 * (provided by AuthMiddleware).
 *
 * All handlers use:
 * - Rate limiting (60 requests/min per user)
 * - Database transactions for atomicity
 * - Policy checks for authorization
 * - Transaction IDs for optimistic updates
 * - Error remapping for consistent error handling
 */
export const MessageRpcLive = MessageRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const botGateway = yield* BotGatewayService
		const outboxRepo = yield* MessageOutboxRepo
		const channelViewers = yield* ChannelViewers
		const messagePolicy = yield* MessagePolicy
		const messageRepo = yield* MessageRepo
		const attachmentPolicy = yield* AttachmentPolicy
		const attachmentRepo = yield* AttachmentRepo

		return {
			"message.create": ({ attachmentIds, ...messageData }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context

					// Admits everything in an object: the api Worker limited the call (`rpc/routing.ts`).
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

								// Update attachments with messageId if provided
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

								// Bots get the event after the commit, from this object's outbox.
								const organizationId = yield* channelViewers.organizationId
								if (Option.isSome(organizationId)) {
									yield* enqueueEffect(
										BotGatewayEffects.messageEvent,
										{ kind: "bot-gateway" },
										{
											organizationId: organizationId.value,
											eventType: "message.create",
											message: createdMessage,
										},
									)
								}
								// TODO(do-sync): enqueue the OrgObject effects (lastMessageAt, unread counts,
								// mentions) and the UserObject notifications the old outbox drove.

								const txid = yield* generateTransactionId()

								return new MessageResponse({
									data: createdMessage,
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("Message", "create"))
				}),

			"message.update": ({ id, channelId: _route, ...payload }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context

					// Check rate limit before processing
					yield* checkMessageRateLimit(user.id)

					const response = yield* db
						.transaction(
							Effect.gen(function* () {
								yield* messagePolicy.canUpdate(id)
								const updatedMessage = yield* messageRepo.update({
									id,
									...payload,
								})

								yield* outboxRepo.insert({
									eventType: "message_updated",
									aggregateId: updatedMessage.id,
									channelId: updatedMessage.channelId,
									payload: {
										messageId: updatedMessage.id,
									},
								})

								const txid = yield* generateTransactionId()

								return new MessageResponse({
									data: updatedMessage,
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("Message", "update"))

					yield* botGateway.publishMessageEvent("message.update", response.data).pipe(
						Effect.catchTag("DurableStreamRequestError", (error) =>
							Effect.logWarning("Failed to publish message.update to bot gateway", {
								error,
								messageId: response.data.id,
							}),
						),
					)

					return response
				}),

			"message.delete": ({ id }) =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context
					const existingMessage = yield* messageRepo
						.findById(id)
						.pipe(withRemapDbErrors("Message", "select"))

					// Check rate limit before processing
					yield* checkMessageRateLimit(user.id)

					const response = yield* db
						.transaction(
							Effect.gen(function* () {
								yield* messagePolicy.canDelete(id)
								yield* messageRepo.deleteById(id)

								if (Option.isSome(existingMessage)) {
									yield* outboxRepo.insert({
										eventType: "message_deleted",
										aggregateId: existingMessage.value.id,
										channelId: existingMessage.value.channelId,
										payload: {
											messageId: existingMessage.value.id,
											channelId: existingMessage.value.channelId,
										},
									})
								}

								const txid = yield* generateTransactionId()

								return { transactionId: txid }
							}),
						)
						.pipe(withRemapDbErrors("Message", "delete"))

					if (Option.isSome(existingMessage)) {
						yield* botGateway.publishMessageEvent("message.delete", existingMessage.value).pipe(
							Effect.catchTag("DurableStreamRequestError", (error) =>
								Effect.logWarning("Failed to publish message.delete to bot gateway", {
									error,
									messageId: existingMessage.value.id,
								}),
							),
						)
					}

					return response
				}),
		}
	}),
)
