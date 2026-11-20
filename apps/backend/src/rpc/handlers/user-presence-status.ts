/**
 * Runs in the caller's `UserObject`, which owns their presence (`worker/objects/user/presence.ts`):
 * each change is recomputed there and projected to the user's orgs through the outbox in the same
 * transaction.
 */
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import {
	UserPresenceSettingsResponse,
	UserPresenceStatusResponse,
	UserPresenceStatusRpcs,
} from "@hazel/domain/rpc"
import { DateTime, Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { UserPresenceStatusPolicy } from "../../policies/user-presence-status-policy"
import {
	applyLegacyUpdate,
	legacyHeartbeat,
	type PresencePatch,
	reconcile,
	setPreferredStatus,
} from "../../worker/objects/user/presence"

const toDate = (value: Date | DateTime.Utc | null) =>
	value === null || value instanceof Date ? value : DateTime.toDateUtc(value)

export const UserPresenceStatusRpcLive = UserPresenceStatusRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPresenceStatusPolicy = yield* UserPresenceStatusPolicy

		const authorized = Effect.gen(function* () {
			const user = yield* CurrentUser.Context
			yield* userPresenceStatusPolicy.canUpdate(user.id)
			return user
		})

		return {
			"userPresenceStatus.setStatus": ({ status, expiresAt }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* authorized
							const statusExpiresAt = toDate(expiresAt)
							yield* setPreferredStatus(user.id, status, statusExpiresAt)
							const txid = yield* generateTransactionId()
							return new UserPresenceSettingsResponse({
								status,
								statusExpiresAt,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			// The custom status and "pause notifications"; `status` and `activeChannelId` are what
			// older clients send instead of `setStatus` and `Presence` frames.
			"userPresenceStatus.update": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* authorized
							yield* applyLegacyUpdate(user.id, payload)
							const patch: PresencePatch = {}
							if (payload.customMessage !== undefined)
								patch.customMessage = payload.customMessage
							if (payload.statusEmoji !== undefined) patch.statusEmoji = payload.statusEmoji
							if (payload.statusExpiresAt !== undefined) {
								patch.statusExpiresAt = toDate(payload.statusExpiresAt)
							}
							if (payload.suppressNotifications !== undefined) {
								patch.suppressNotifications = payload.suppressNotifications
							}
							const { row } = yield* reconcile(user.id, { patch })
							const txid = yield* generateTransactionId()
							return new UserPresenceStatusResponse({ data: row, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			// Older clients only: newer ones keep their session alive with the sync socket's pings.
			"userPresenceStatus.heartbeat": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* authorized
							const { row } = yield* legacyHeartbeat(user.id)
							return { lastSeenAt: row.lastSeenAt }
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			"userPresenceStatus.clearStatus": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* authorized
							const { row } = yield* reconcile(user.id, {
								patch: {
									customMessage: null,
									statusEmoji: null,
									statusExpiresAt: null,
									suppressNotifications: false,
								},
							})
							const txid = yield* generateTransactionId()
							return new UserPresenceStatusResponse({ data: row, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),
		}
	}),
)
