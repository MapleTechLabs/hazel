/**
 * Runs in the caller's `UserObject`, which holds only their notifications
 * (`NotificationPolicy`). Message notifications are created by the channel's `OrgObject` through
 * `user.createNotification` (`worker/objects/user/message-notifications.ts`), not here.
 */
import { NotificationRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { withRemapDbErrors } from "@hazel/domain"
import { NotificationResponse, NotificationRpcs } from "@hazel/domain/rpc"
import { DateTime, Effect } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { NotificationPolicy } from "../../policies/notification-policy"

const toDate = (value: Date | DateTime.Utc | null | undefined) =>
	value === null || value === undefined || value instanceof Date
		? (value ?? null)
		: DateTime.toDateUtc(value)

export const NotificationRpcLive = NotificationRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const notificationPolicy = yield* NotificationPolicy
		const notificationRepo = yield* NotificationRepo

		return {
			"notification.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* notificationPolicy.canCreate()
							const [created] = yield* notificationRepo.insert({ ...payload })
							const txid = yield* generateTransactionId()
							return new NotificationResponse({ data: created!, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("Notification", "create")),

			"notification.update": ({ id, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* notificationPolicy.canUpdate(id)
							// `readAt` is the only mutable field; written directly (the repo's Update codec
							// expects encoded dates).
							const [updated] = yield* db.run(
								SQLite.update(schema.notificationsTable)
									.set({ readAt: toDate(payload.readAt) })
									.where(($) => [$.id.eq(id)])
									.returning(),
							)
							const txid = yield* generateTransactionId()
							return new NotificationResponse({ data: updated!, transactionId: txid })
						}),
					)
					.pipe(withRemapDbErrors("Notification", "update")),

			"notification.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* notificationPolicy.canDelete(id)
							yield* notificationRepo.deleteById(id)
							const txid = yield* generateTransactionId()
							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Notification", "delete")),

			// Messages scrolled into view: drop their notifications. Every row here is the caller's.
			"notification.deleteByMessageIds": ({ messageIds }) =>
				db
					.transaction(
						Effect.gen(function* () {
							yield* notificationPolicy.canMarkAllAsRead()
							const deleted =
								messageIds.length === 0
									? []
									: yield* db.run(
											SQLite.deleteFrom(schema.notificationsTable)
												.where(($) => [
													$.resourceId.in_(...messageIds),
													$.resourceType.eq("message"),
												])
												.returning("id"),
										)
							const txid = yield* generateTransactionId()
							return { deletedCount: deleted.length, transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("Notification", "delete")),
		}
	}),
)
