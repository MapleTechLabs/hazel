/**
 * TODO(do-sync): runs in the ChannelObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - authorize with `ChannelViewers` (PinnedMessagePolicy reads org tables)
 */
import { MessageRepo, PinnedMessageRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { PinnedMessageResponse, PinnedMessageRpcs } from "@hazel/domain/rpc"
import { Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { MessagePolicy } from "../../policies/message-policy"
import { PinnedMessagePolicy } from "../../policies/pinned-message-policy"

/**
 * Pinned Message RPC Handlers
 *
 * Implements the business logic for all pinned message-related RPC methods.
 * Each handler receives the payload and has access to CurrentUser via Effect context
 * (provided by AuthMiddleware).
 *
 * All handlers use:
 * - Database transactions for atomicity
 * - Policy checks for authorization
 * - Transaction IDs for optimistic updates
 * - Error remapping for consistent error handling
 */
export const PinnedMessageRpcLive = PinnedMessageRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const messagePolicy = yield* MessagePolicy
		const messageRepo = yield* MessageRepo
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
