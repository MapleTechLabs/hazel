/**
 * TODO(do-sync): runs in the ChannelObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - authorize with `ChannelViewers` (see `MessagePolicy`)
 * - `conversationId` from `channelViewers.conversationId`, not ConnectConversationService
 * - bot events through `BotGatewayEffects` if wanted
 */
import { MessageOutboxRepo, MessageReactionRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { MessageReactionResponse, MessageReactionRpcs } from "@hazel/domain/rpc"
import type { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { MessageReactionPolicy } from "../../policies/message-reaction-policy"
import { ConnectConversationService } from "../../services/connect-conversation-service"

export const MessageReactionRpcLive = MessageReactionRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const outboxRepo = yield* MessageOutboxRepo
		const connectConversationService = yield* ConnectConversationService
		const messageReactionPolicy = yield* MessageReactionPolicy
		const messageReactionRepo = yield* MessageReactionRepo

		return {
			"messageReaction.toggle": (payload) =>
				Effect.gen(function* () {
					const txResult = yield* db
						.transaction(
							Effect.gen(function* () {
								const user = yield* CurrentUser.Context
								const { messageId, channelId, emoji } = payload

								yield* messageReactionPolicy.canList(messageId)
								const existingReaction = yield* messageReactionRepo.findByMessageUserEmoji(
									messageId,
									user.id,
									emoji,
								)

								const txid = yield* generateTransactionId()

								// If reaction exists, delete it
								if (Option.isSome(existingReaction)) {
									const deletedSyncPayload = {
										reactionId: existingReaction.value.id,
										hazelChannelId: existingReaction.value.channelId,
										hazelMessageId: existingReaction.value.messageId,
										emoji: existingReaction.value.emoji,
										userId: existingReaction.value.userId,
									} as const
									yield* messageReactionPolicy.canDelete(existingReaction.value.id)
									yield* messageReactionRepo.deleteById(existingReaction.value.id)
									yield* outboxRepo.insert({
										eventType: "reaction_deleted",
										aggregateId: existingReaction.value.id,
										channelId: existingReaction.value.channelId,
										payload: {
											hazelChannelId: existingReaction.value.channelId,
											hazelMessageId: existingReaction.value.messageId,
											emoji: existingReaction.value.emoji,
											userId: existingReaction.value.userId,
										},
									})

									return {
										wasCreated: false,
										data: undefined,
										transactionId: txid,
										deletedSyncPayload,
									}
								}

								// Otherwise, create a new reaction
								yield* messageReactionPolicy.canCreate(messageId)
								const conversationId =
									yield* connectConversationService.getConversationIdForChannel(channelId)
								const createdMessageReaction = yield* messageReactionRepo
									.insert({
										messageId,
										channelId,
										conversationId,
										emoji,
										userId: user.id,
									})
									.pipe(Effect.map((res) => res[0]!))

								yield* outboxRepo.insert({
									eventType: "reaction_created",
									aggregateId: createdMessageReaction.id,
									channelId: createdMessageReaction.channelId,
									payload: {
										reactionId: createdMessageReaction.id,
									},
								})

								return {
									wasCreated: true,
									data: createdMessageReaction,
									transactionId: txid,
									deletedSyncPayload: null,
								}
							}),
						)
						.pipe(withRemapDbErrors("MessageReaction", "create"))

					return {
						wasCreated: txResult.wasCreated,
						data: txResult.data,
						transactionId: txResult.transactionId,
					}
				}),

			"messageReaction.create": (payload) =>
				Effect.gen(function* () {
					const result = yield* db
						.transaction(
							Effect.gen(function* () {
								const user = yield* CurrentUser.Context

								yield* messageReactionPolicy.canCreate(payload.messageId)
								const conversationId =
									yield* connectConversationService.getConversationIdForChannel(
										payload.channelId,
									)
								const createdMessageReaction = yield* messageReactionRepo
									.insert({
										...payload,
										conversationId,
										userId: user.id,
									})
									.pipe(Effect.map((res) => res[0]!))

								yield* outboxRepo.insert({
									eventType: "reaction_created",
									aggregateId: createdMessageReaction.id,
									channelId: createdMessageReaction.channelId,
									payload: {
										reactionId: createdMessageReaction.id,
									},
								})

								const txid = yield* generateTransactionId()

								return new MessageReactionResponse({
									data: createdMessageReaction,
									transactionId: txid,
								})
							}),
						)
						.pipe(withRemapDbErrors("MessageReaction", "create"))

					return result
				}),

			"messageReaction.update": ({ id, channelId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* messageReactionPolicy.canUpdate(id)
							const updatedMessageReaction = yield* messageReactionRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new MessageReactionResponse({
								data: updatedMessageReaction,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("MessageReaction", "update")),

			"messageReaction.delete": ({ id }) =>
				Effect.gen(function* () {
					const txResult = yield* db
						.transaction(
							Effect.gen(function* () {
								const existing = yield* messageReactionRepo.findById(id)
								const deletedSyncPayload = Option.match(existing, {
									onNone: () => null as null,
									onSome: (value) =>
										({
											hazelChannelId: value.channelId,
											hazelMessageId: value.messageId,
											emoji: value.emoji,
											userId: value.userId,
										}) as {
											hazelChannelId: ChannelId
											hazelMessageId: MessageId
											emoji: string
											userId: UserId
										},
								})

								yield* messageReactionPolicy.canDelete(id)
								yield* messageReactionRepo.deleteById(id)

								if (deletedSyncPayload !== null && Option.isSome(existing)) {
									yield* outboxRepo.insert({
										eventType: "reaction_deleted",
										aggregateId: existing.value.id,
										channelId: existing.value.channelId,
										payload: deletedSyncPayload,
									})
								}

								const txid = yield* generateTransactionId()

								return { transactionId: txid, deletedSyncPayload }
							}),
						)
						.pipe(withRemapDbErrors("MessageReaction", "delete"))

					return { transactionId: txResult.transactionId }
				}),
		}
	}),
)
