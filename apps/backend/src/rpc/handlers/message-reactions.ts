import { MessageReactionRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { MessageReactionResponse, MessageReactionRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { MessageReactionPolicy } from "../../policies/message-reaction-policy"
import { ChannelViewers } from "../../services/channel-viewers"
import { emitMessageEvent } from "../../worker/objects/channel/message-events"

/**
 * Message reaction RPC handlers. Run in the message's `ChannelObject` (`rpc/routing.ts`):
 * authorized against its `channel_viewers` (`MessageReactionPolicy`), the Connect conversation
 * from the channel's own facts, and chat-sync told through `emitMessageEvent`.
 */
export const MessageReactionRpcLive = MessageReactionRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelViewers = yield* ChannelViewers
		const messageReactionPolicy = yield* MessageReactionPolicy
		const messageReactionRepo = yield* MessageReactionRepo

		return {
			"messageReaction.toggle": ({ messageId, channelId, emoji }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							const existing = yield* messageReactionRepo.findByMessageUserEmoji(
								messageId,
								user.id,
								emoji,
							)

							if (Option.isSome(existing)) {
								yield* messageReactionPolicy.canDelete(existing.value.id)
								yield* messageReactionRepo.deleteById(existing.value.id)
								yield* emitMessageEvent({ _tag: "ReactionDeleted", reaction: existing.value })
								const txid = yield* generateTransactionId()
								return { wasCreated: false, data: undefined, transactionId: txid }
							}

							yield* messageReactionPolicy.canCreate(messageId)
							const created = yield* messageReactionRepo
								.insert({
									messageId,
									channelId,
									conversationId: yield* channelViewers.conversationId,
									emoji,
									userId: user.id,
								})
								.pipe(Effect.map((res) => res[0]!))
							yield* emitMessageEvent({ _tag: "ReactionCreated", reaction: created })
							const txid = yield* generateTransactionId()
							return { wasCreated: true, data: created, transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("MessageReaction", "create")),

			"messageReaction.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							yield* messageReactionPolicy.canCreate(payload.messageId)
							const created = yield* messageReactionRepo
								.insert({
									...payload,
									conversationId: yield* channelViewers.conversationId,
									userId: user.id,
								})
								.pipe(Effect.map((res) => res[0]!))
							yield* emitMessageEvent({ _tag: "ReactionCreated", reaction: created })
							const txid = yield* generateTransactionId()
							return new MessageReactionResponse({ data: created, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("MessageReaction", "create")),

			"messageReaction.update": ({ id, channelId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* messageReactionPolicy.canUpdate(id)
							const updated = yield* messageReactionRepo.update({ id, ...payload })
							const txid = yield* generateTransactionId()
							return new MessageReactionResponse({ data: updated, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("MessageReaction", "update")),

			"messageReaction.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* messageReactionPolicy.canDelete(id)
							const existing = yield* messageReactionRepo.findById(id)
							yield* messageReactionRepo.deleteById(id)
							if (Option.isSome(existing)) {
								yield* emitMessageEvent({ _tag: "ReactionDeleted", reaction: existing.value })
							}
							const txid = yield* generateTransactionId()
							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("MessageReaction", "delete")),
		}
	}),
)
