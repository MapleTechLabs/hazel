/**
 * Abandoned uploads fail inside their `ChannelObject` (the cluster's `CleanupUploadsWorkflow` and
 * its cron, rehomed): an attachment still `uploading` `UPLOAD_TTL_MS` after it was presigned is
 * marked `failed` by the object's alarm, which this deadline wakes.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Clock, Effect } from "effect"

export const UPLOAD_TTL_MS = 10 * 60_000

/** When the oldest pending upload goes stale, for the object's one alarm. */
export const uploadDeadlines = Effect.gen(function* () {
	const db = yield* Database.Database
	const oldest = yield* db.first(
		SQLite.from(schema.attachmentsTable)
			.select("uploadedAt")
			.where(($) => [$.status.eq("uploading"), $.deletedAt.isNull()])
			.orderBy(($) => [[$.uploadedAt, "asc"]])
			.limit(1),
	)
	return oldest._tag === "Some" ? [oldest.value.uploadedAt.getTime() + UPLOAD_TTL_MS] : []
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Upload deadline lookup failed", { error: error.message }).pipe(Effect.as([])),
	),
)

/** Mark stale uploads failed; returns how many. */
export const failStaleUploads = Effect.gen(function* () {
	const db = yield* Database.Database
	const now = yield* Clock.currentTimeMillis
	const failed = yield* db.run(
		SQLite.update(schema.attachmentsTable)
			.set({ status: "failed" })
			.where(($) => [
				$.status.eq("uploading"),
				$.uploadedAt.lte(new Date(now - UPLOAD_TTL_MS)),
				$.deletedAt.isNull(),
			])
			.returning("id"),
	)
	yield* Effect.annotateCurrentSpan({ "uploads.failed": failed.length })
	return failed.length
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Stale upload cleanup failed", { error: error.message }).pipe(Effect.as(0)),
	),
	Effect.withSpan("ChannelObject.failStaleUploads"),
)
