/**
 * TODO(do-sync): runs in the ChannelObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - authorize with `ChannelViewers`; memberId is an OrgObject row: trust the viewer instead
 * - expiry is the ChannelObject alarm (`worker/objects/channel/typing.ts`)
 */
import { TypingIndicatorRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { withRemapDbErrors } from "@hazel/domain"
import { TypingIndicatorNotFoundError, TypingIndicatorResponse, TypingIndicatorRpcs } from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { TypingIndicatorPolicy } from "../../policies/typing-indicator-policy"

/**
 * Typing Indicator RPC Handlers
 *
 * Implements the business logic for all typing indicator-related RPC methods.
 * Each handler receives the payload and has access to CurrentUser via Effect context
 * (provided by AuthMiddleware).
 *
 * All handlers use:
 * - Database transactions for atomicity
 * - Policy checks for authorization
 * - Transaction IDs for optimistic updates
 * - Error remapping for consistent error handling
 *
 * Note: Typing indicators use upsert logic for creation to handle concurrent
 * typing events from the same user in the same channel.
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
							const startedAt = Date.now()
							yield* Effect.logDebug("typingIndicator.create received", {
								channelId: payload.channelId,
								memberId: payload.memberId,
							})

							// Use upsert to create or update typing indicator
							yield* typingIndicatorPolicy.canCreate(payload.channelId)
							const result = yield* typingIndicatorRepo.upsertByChannelAndMember({
								channelId: payload.channelId,
								memberId: payload.memberId,
								lastTyped: payload.lastTyped ?? Date.now(),
							})

							const typingIndicator = result[0]!

							const txid = yield* generateTransactionId()
							yield* Effect.logDebug("typingIndicator.create succeeded", {
								channelId: payload.channelId,
								memberId: payload.memberId,
								typingIndicatorId: typingIndicator.id,
								durationMs: Date.now() - startedAt,
							})

							return new TypingIndicatorResponse({
								data: typingIndicator,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("TypingIndicator", "create")),

			"typingIndicator.update": ({ id, channelId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const startedAt = Date.now()
							yield* Effect.logDebug("typingIndicator.update received", {
								typingIndicatorId: id,
							})

							yield* typingIndicatorPolicy.canUpdate(id)
							const typingIndicator = yield* typingIndicatorRepo.update({
								...payload,
								id,
								lastTyped: Date.now(),
							})

							const txid = yield* generateTransactionId()
							yield* Effect.logDebug("typingIndicator.update succeeded", {
								typingIndicatorId: id,
								durationMs: Date.now() - startedAt,
							})

							return new TypingIndicatorResponse({
								data: typingIndicator,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("TypingIndicator", "update")),

			"typingIndicator.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const startedAt = Date.now()
							yield* Effect.logDebug("typingIndicator.delete received", {
								typingIndicatorId: id,
							})

							// First find the typing indicator to return it
							yield* typingIndicatorPolicy.canRead(id)
							const existingOption = yield* typingIndicatorRepo.findById(id)

							if (Option.isNone(existingOption)) {
								return yield* Effect.fail(
									new TypingIndicatorNotFoundError({ typingIndicatorId: id }),
								)
							}

							const existing = existingOption.value

							yield* typingIndicatorPolicy.canDelete({ id })
							yield* typingIndicatorRepo.deleteById(id)

							const txid = yield* generateTransactionId()
							yield* Effect.logDebug("typingIndicator.delete succeeded", {
								typingIndicatorId: id,
								memberId: existing.memberId,
								channelId: existing.channelId,
								durationMs: Date.now() - startedAt,
							})

							return new TypingIndicatorResponse({ data: existing, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("TypingIndicator", "delete")),
		}
	}),
)
