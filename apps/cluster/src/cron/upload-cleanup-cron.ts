import * as ClusterCron from "effect/cluster/ClusterCron"
import { Database, SQLite, schema } from "@hazel/db"
import * as Cron from "effect/Cron"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

// Run daily at 3 AM
const dailyAt3AM = Cron.parseUnsafe("0 3 * * *")

// Max age for uploads to be considered stale (1 hour)
const MAX_AGE_MINUTES = 60

/**
 * Cron job that marks stale uploads as failed.
 * Attachments stuck in "uploading" status for longer than MAX_AGE_MINUTES
 * are marked as "failed" to prevent orphaned records.
 * Runs daily at 3 AM.
 */
export const UploadCleanupCronLayer = ClusterCron.make({
	name: "UploadCleanup",
	cron: dailyAt3AM,
	execute: Effect.gen(function* () {
		const db = yield* Database.Database
		const cutoffTime = new Date(Date.now() - MAX_AGE_MINUTES * 60 * 1000)

		// Find and mark stale uploads as failed
		const result = yield* db.run(
			SQLite.update(schema.attachmentsTable)
				.set({ status: "failed" })
				.where(($) => [$.status.eq("uploading"), $.uploadedAt.lt(cutoffTime), $.deletedAt.isNull()])
				.returning("id"),
		)

		yield* Effect.annotateCurrentSpan("cron.marked_count", result.length)

		if (result.length > 0) {
			yield* Effect.logInfo(`UploadCleanup: Marked ${result.length} stale uploads as failed`)
		}
	}).pipe(Effect.withSpan("cron.UploadCleanup")),
	skipIfOlderThan: Duration.hours(2),
})
