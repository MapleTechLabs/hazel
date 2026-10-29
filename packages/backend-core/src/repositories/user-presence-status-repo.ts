import { Database, SQLite, Repository, schema } from "@hazel/db"

import type { ChannelId, UserId } from "@hazel/schema"
import { UserPresenceStatus } from "@hazel/domain/models"
import { Context, DateTime, Effect, Layer, type Schema } from "effect"

/** Timestamp columns take a `Date`; domain models carry `Date | DateTime.Utc`. */
const toDate = (value: Date | DateTime.Utc): Date =>
	DateTime.isDateTime(value) ? DateTime.toDate(value) : value
const toNullableDate = (value: Date | DateTime.Utc | null): Date | null =>
	value === null ? null : toDate(value)

export class UserPresenceStatusRepo extends Context.Service<UserPresenceStatusRepo>()(
	"UserPresenceStatusRepo",
	{
		make: Effect.gen(function* () {
			const db = yield* Database.Database
			const baseRepo = yield* Repository.makeRepository(
				schema.userPresenceStatusTable,
				{ insert: UserPresenceStatus.Insert, update: UserPresenceStatus.Update },
				{
					idColumn: "id",
					name: "UserPresenceStatus",
				},
			)

			// Find status by user ID
			const findByUserId = (userId: UserId) =>
				db.first(
					SQLite.from(schema.userPresenceStatusTable)
						.select()
						.where(($) => [$.userId.eq(userId)])
						.limit(1),
				)

			// Upsert user presence status
			const upsertByUserId = (data: Schema.Schema.Type<typeof UserPresenceStatus.Insert>) =>
				db
					.run(
						SQLite.insertInto(schema.userPresenceStatusTable)
							.values({
								userId: data.userId,
								status: data.status,
								customMessage: data.customMessage,
								statusEmoji: data.statusEmoji,
								statusExpiresAt: toNullableDate(data.statusExpiresAt),
								activeChannelId: data.activeChannelId,
								suppressNotifications: data.suppressNotifications,
								updatedAt: toDate(data.updatedAt),
								lastSeenAt: toDate(data.lastSeenAt),
							})
							.onConflictDoUpdate({
								target: ["userId"],
								set: {
									status: data.status,
									customMessage: data.customMessage,
									statusEmoji: data.statusEmoji,
									statusExpiresAt: toNullableDate(data.statusExpiresAt),
									activeChannelId: data.activeChannelId,
									updatedAt: new Date(),
									lastSeenAt: new Date(),
								},
							})
							.returning(),
					)
					.pipe(Effect.map((results) => results[0]))

			// Update active channel for user
			const updateActiveChannel = (params: { userId: UserId; activeChannelId: ChannelId | null }) =>
				db.run(
					SQLite.update(schema.userPresenceStatusTable)
						.set({
							activeChannelId: params.activeChannelId,
							updatedAt: new Date(),
						})
						.where(($) => [$.userId.eq(params.userId)])
						.returning(),
				)

			// Update user status
			const updateStatus = (params: {
				userId: UserId
				status: "online" | "away" | "busy" | "dnd" | "offline"
				customMessage?: string | null
			}) =>
				db.run(
					SQLite.update(schema.userPresenceStatusTable)
						.set({
							status: params.status,
							customMessage: params.customMessage,
							updatedAt: new Date(),
						})
						.where(($) => [$.userId.eq(params.userId)])
						.returning(),
				)

			// Update heartbeat timestamp (lightweight operation for presence tracking)
			const updateHeartbeat = (userId: UserId) =>
				db.first(
					SQLite.update(schema.userPresenceStatusTable)
						.set({
							lastSeenAt: new Date(),
						})
						.where(($) => [$.userId.eq(userId)])
						.returning(),
				)

			// Find users with stale heartbeats (for cron job cleanup)
			const findStaleUsers = (timeout: Date) =>
				db.run(
					SQLite.from(schema.userPresenceStatusTable)
						.select("userId", "status", "lastSeenAt")
						.where(($) => [$.lastSeenAt.lt(timeout), $.status.neq("offline")]),
				)

			// Batch update users to offline status
			const markUsersOffline = (userIds: UserId[]) =>
				db.run(
					SQLite.update(schema.userPresenceStatusTable)
						.set({
							status: "offline",
							updatedAt: new Date(),
						})
						.where(($) => [$.userId.in_(...userIds)])
						.returning(),
				)

			return {
				...baseRepo,
				findByUserId,
				upsertByUserId,
				updateActiveChannel,
				updateStatus,
				updateHeartbeat,
				findStaleUsers,
				markUsersOffline,
			}
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make)
}
