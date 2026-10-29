/**
 * Runs in the caller's `UserObject`, which owns their `user_presence_status` row
 * (`worker/objects/user/presence.ts`): each change is projected to the user's orgs through the
 * outbox in the same transaction.
 */
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import { UserPresenceStatusResponse, UserPresenceStatusRpcs } from "@hazel/domain/rpc"
import { DateTime, Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { UserPresenceStatusPolicy } from "../../policies/user-presence-status-policy"
import { defaultPresence, findPresence, markActive, savePresence } from "../../worker/objects/user/presence"

const toDate = (value: Date | DateTime.Utc | null) =>
	value === null || value instanceof Date ? value : DateTime.toDateUtc(value)

export const UserPresenceStatusRpcLive = UserPresenceStatusRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPresenceStatusPolicy = yield* UserPresenceStatusPolicy

		return {
			"userPresenceStatus.update": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							yield* userPresenceStatusPolicy.canUpdate(user.id)
							const now = new Date()
							const existing = Option.match(yield* findPresence(user.id), {
								onNone: () => defaultPresence(now),
								onSome: ({ id: _id, userId: _userId, ...fields }) => fields,
							})
							const pick = <K extends keyof typeof payload & keyof typeof existing>(key: K) =>
								payload[key] !== undefined ? payload[key] : existing[key]
							const updated = yield* savePresence(user.id, {
								status: pick("status"),
								customMessage: pick("customMessage"),
								statusEmoji: pick("statusEmoji"),
								statusExpiresAt: toDate(pick("statusExpiresAt")),
								activeChannelId: pick("activeChannelId"),
								suppressNotifications: pick("suppressNotifications"),
								updatedAt: now,
								// Any status change counts as a heartbeat.
								lastSeenAt: now,
							})
							const txid = yield* generateTransactionId()
							return new UserPresenceStatusResponse({ data: updated, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			"userPresenceStatus.heartbeat": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							yield* userPresenceStatusPolicy.canUpdate(user.id)
							const row = yield* markActive(user.id)
							return { lastSeenAt: row.lastSeenAt }
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),

			"userPresenceStatus.clearStatus": () =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							yield* userPresenceStatusPolicy.canUpdate(user.id)
							const now = new Date()
							const existing = Option.getOrUndefined(yield* findPresence(user.id))
							const updated = yield* savePresence(user.id, {
								status: existing?.status ?? "online",
								customMessage: null,
								statusEmoji: null,
								statusExpiresAt: null,
								activeChannelId: existing?.activeChannelId ?? null,
								suppressNotifications: false,
								updatedAt: now,
								lastSeenAt: now,
							})
							const txid = yield* generateTransactionId()
							return new UserPresenceStatusResponse({ data: updated, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update")),
		}
	}),
)
