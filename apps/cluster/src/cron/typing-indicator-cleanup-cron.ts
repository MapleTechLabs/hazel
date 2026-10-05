import * as ClusterCron from "effect/cluster/ClusterCron"
import { Database, lt, schema } from "@hazel/db"
import * as Cron from "effect/Cron"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"

const every5Seconds = Cron.parseUnsafe("*/5 * * * * *")
const TYPING_INDICATOR_STALE_MS = 12_000

/**
 * Cron job that hard-deletes stale typing indicators.
 * This is a server-side safety net for abandoned indicators (tab crash, network drop, etc.).
 */
export const TypingIndicatorCleanupCronLayer = ClusterCron.make({
	name: "TypingIndicatorCleanup",
	cron: every5Seconds,
	execute: Effect.gen(function* () {
		const db = yield* Database.Database
		const staleThreshold = Date.now() - TYPING_INDICATOR_STALE_MS

		const deleted = yield* db.execute((client) =>
			client
				.delete(schema.typingIndicatorsTable)
				.where(lt(schema.typingIndicatorsTable.lastTyped, staleThreshold))
				.returning({
					id: schema.typingIndicatorsTable.id,
				}),
		)

		yield* Effect.annotateCurrentSpan("cron.deleted_count", deleted.length)

		if (deleted.length > 0) {
			yield* Effect.logDebug("Deleted stale typing indicators", {
				count: deleted.length,
				thresholdMs: TYPING_INDICATOR_STALE_MS,
			})
		}
	}).pipe(Effect.withSpan("cron.TypingIndicatorCleanup")),
	skipIfOlderThan: Duration.minutes(1),
})
