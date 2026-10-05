import * as ClusterCron from "effect/cluster/ClusterCron"
import { and, Database, isNotNull, lt, schema } from "@hazel/db"
import * as Cron from "effect/Cron"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

// Run every minute
const everyMinute = Cron.parseUnsafe("* * * * *")

/**
 * Cron job that clears expired custom statuses.
 * Runs every minute and clears statusEmoji, customMessage, and statusExpiresAt
 * for any user whose statusExpiresAt has passed.
 */
export const StatusExpirationCronLayer = ClusterCron.make({
	name: "StatusExpiration",
	cron: everyMinute,
	execute: Effect.gen(function* () {
		const db = yield* Database.Database
		const now = new Date()

		// Find users with expired statuses
		const expiredStatuses = yield* db.execute((client) =>
			client
				.select({
					userId: schema.userPresenceStatusTable.userId,
					statusEmoji: schema.userPresenceStatusTable.statusEmoji,
					customMessage: schema.userPresenceStatusTable.customMessage,
					statusExpiresAt: schema.userPresenceStatusTable.statusExpiresAt,
				})
				.from(schema.userPresenceStatusTable)
				.where(
					and(
						isNotNull(schema.userPresenceStatusTable.statusExpiresAt),
						lt(schema.userPresenceStatusTable.statusExpiresAt, now),
					),
				),
		)

		yield* Effect.annotateCurrentSpan("cron.expired_count", expiredStatuses.length)

		if (expiredStatuses.length === 0) {
			return
		}

		yield* Effect.logInfo(`Found ${expiredStatuses.length} expired statuses to clear`)

		// Clear expired statuses by setting emoji, message, and expiration to null
		const userIds = expiredStatuses.map((s) => s.userId)
		yield* db.execute((client) =>
			client
				.update(schema.userPresenceStatusTable)
				.set({
					statusEmoji: null,
					customMessage: null,
					statusExpiresAt: null,
					updatedAt: new Date(),
				})
				.where(
					and(
						isNotNull(schema.userPresenceStatusTable.statusExpiresAt),
						lt(schema.userPresenceStatusTable.statusExpiresAt, now),
					),
				),
		)

		yield* Effect.logInfo(`Cleared ${expiredStatuses.length} expired statuses`, {
			userIds: userIds.slice(0, 10), // Log first 10 for debugging
		})
	}).pipe(Effect.withSpan("cron.StatusExpiration")),
	skipIfOlderThan: Duration.minutes(2),
})
