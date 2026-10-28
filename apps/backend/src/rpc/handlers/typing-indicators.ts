import { TypingIndicatorRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { withRemapDbErrors } from "@hazel/domain"
import { TypingIndicatorNotFoundError, TypingIndicatorResponse, TypingIndicatorRpcs } from "@hazel/domain/rpc"
import { Clock, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { TypingIndicatorPolicy } from "../../policies/typing-indicator-policy"

/**
 * Typing indicator RPC handlers. Run in the channel's `ChannelObject` (`rpc/routing.ts`),
 * authorized against its `channel_viewers`. Creation upserts on (channel, member), so concurrent
 * typing events from one member keep one row. `lastTyped` is the object's clock (a client's could
 * keep a row alive); the object's alarm deletes rows 10 s after it (`worker/objects/channel/typing.ts`).
 */
export const TypingIndicatorRpcLive = TypingIndicatorRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const typingIndicatorPolicy = yield* TypingIndicatorPolicy
		const typingIndicatorRepo = yield* TypingIndicatorRepo

		return {
			"typingIndicator.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* typingIndicatorPolicy.canCreate(payload.channelId)
							const result = yield* typingIndicatorRepo.upsertByChannelAndMember({
								channelId: payload.channelId,
								memberId: payload.memberId,
								lastTyped: yield* Clock.currentTimeMillis,
							})
							const txid = yield* generateTransactionId()
							return new TypingIndicatorResponse({ data: result[0]!, transactionId: txid })
						}),
					)
					.pipe(
						withRemapDbErrors("TypingIndicator", "create"),
						Effect.withSpan("TypingIndicator.create", {
							attributes: { "channel.id": payload.channelId },
						}),
					),

			"typingIndicator.update": ({ id, channelId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* typingIndicatorPolicy.canUpdate(id)
							const typingIndicator = yield* typingIndicatorRepo.update({
								...payload,
								id,
								lastTyped: yield* Clock.currentTimeMillis,
							})
							const txid = yield* generateTransactionId()
							return new TypingIndicatorResponse({ data: typingIndicator, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("TypingIndicator", "update")),

			"typingIndicator.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const existing = yield* typingIndicatorRepo.findById(id)
							if (Option.isNone(existing)) {
								return yield* new TypingIndicatorNotFoundError({ typingIndicatorId: id })
							}
							yield* typingIndicatorPolicy.canDelete(id)
							yield* typingIndicatorRepo.deleteById(id)
							const txid = yield* generateTransactionId()
							return new TypingIndicatorResponse({ data: existing.value, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("TypingIndicator", "delete")),
		}
	}),
)
