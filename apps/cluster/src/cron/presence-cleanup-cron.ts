import * as ClusterCron from "effect/cluster/ClusterCron"
import { Database, SQLite, schema } from "@hazel/db"
import * as Cron from "effect/Cron"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

// Run every 15 seconds (6-field cron: seconds minutes hours day month weekday)
const every15Seconds = Cron.parseUnsafe("*/15 * * * * *")

// Timeout: 45 seconds (3x heartbeat interval of 15s)
const HEARTBEAT_TIMEOUT_MS = 45_000

/**
 * Cron job that marks users as offline if they haven't sent a heartbeat within the timeout period.
 * This provides reliable offline detection even when beforeunload/sendBeacon fails
 * (browser crashes, network loss, mobile backgrounding, etc.)
 */
export const PresenceCleanupCronLayer = ClusterCron.make({
	name: "PresenceCleanup",
	cron: every15Seconds,
	execute: Effect.gen(function* () {
		const db = yield* Database.Database
		const timeoutThreshold = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS)

		// Find users with stale heartbeats who aren't already offline
		const staleUsers = yield* db.run(
			SQLite.from(schema.userPresenceStatusTable)
				.select("userId", "status", "lastSeenAt")
				.where(($) => [$.lastSeenAt.lt(timeoutThreshold), $.status.neq("offline")]),
		)

		yield* Effect.annotateCurrentSpan("cron.stale_count", staleUsers.length)

		if (staleUsers.length === 0) {
			return
		}

		yield* Effect.logInfo(`Found ${staleUsers.length} stale users to mark offline`)

		// Batch update all stale users to offline
		const userIds = staleUsers.map((u) => u.userId)
		yield* db.run(
			SQLite.update(schema.userPresenceStatusTable)
				.set({
					status: "offline",
					updatedAt: new Date(),
				})
				.where(($) => [$.userId.in_(...userIds)]),
		)

		yield* Effect.logInfo(`Marked ${staleUsers.length} users as offline`, {
			userIds: userIds.slice(0, 10), // Log first 10 for debugging
		})
	}).pipe(Effect.withSpan("cron.PresenceCleanup")),
	skipIfOlderThan: Duration.minutes(2),
})
