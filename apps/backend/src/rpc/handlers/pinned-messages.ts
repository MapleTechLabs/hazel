import { PinnedMessageRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { PinnedMessageResponse, PinnedMessageRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { PinnedMessagePolicy } from "../../policies/pinned-message-policy"

/**
 * Pinned message RPC handlers. Run in the channel's `ChannelObject` (`rpc/routing.ts`), authorized
 * against its `channel_viewers` (`PinnedMessagePolicy`).
 */
export const PinnedMessageRpcLive = PinnedMessageRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const pinnedMessagePolicy = yield* PinnedMessagePolicy
		const pinnedMessageRepo = yield* PinnedMessageRepo

		return {
			"pinnedMessage.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							yield* pinnedMessagePolicy.canCreate(payload.channelId)
							const createdPinnedMessage = yield* pinnedMessageRepo
								.insert({
									channelId: payload.channelId,
									messageId: payload.messageId,
									pinnedBy: user.id,
									pinnedAt: new Date(),
								})
								.pipe(Effect.map((res) => res[0]!))

							const txid = yield* generateTransactionId()

							return new PinnedMessageResponse({
								data: createdPinnedMessage,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("PinnedMessage", "create")),

			"pinnedMessage.update": ({ id, channelId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* pinnedMessagePolicy.canUpdate(id)
							const updatedPinnedMessage = yield* pinnedMessageRepo.update({
								id,
								...payload,
							})

							const txid = yield* generateTransactionId()

							return new PinnedMessageResponse({
								data: updatedPinnedMessage,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("PinnedMessage", "update")),

			"pinnedMessage.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* pinnedMessagePolicy.canDelete(id)
							yield* pinnedMessageRepo.deleteById(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("PinnedMessage", "delete")),
		}
	}),
)
