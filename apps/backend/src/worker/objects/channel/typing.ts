/**
 * Typing indicators expire inside the `ChannelObject`: its alarm deletes rows older than
 * `TYPING_TTL_MS` (the cleanup cron goes away), and the deletes stream as row deletes.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Clock, Effect } from "effect"

export const TYPING_TTL_MS = 10_000

/** When the oldest indicator expires, for the object's one alarm (`./timers.ts`). */
export const typingDeadlines = Effect.gen(function* () {
	const db = yield* Database.Database
	const oldest = yield* db.first(
		SQLite.from(schema.typingIndicatorsTable)
			.select("lastTyped")
			.orderBy(($) => [[$.lastTyped, "asc"]])
			.limit(1),
	)
	return oldest._tag === "Some" ? [Number(oldest.value.lastTyped) + TYPING_TTL_MS] : []
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Typing deadline lookup failed", { error: error.message }).pipe(Effect.as([])),
	),
)

/** Delete expired indicators (due at their deadline, inclusive); returns how many. */
export const expireTypingIndicators = Effect.gen(function* () {
	const db = yield* Database.Database
	const now = yield* Clock.currentTimeMillis
	const deleted = yield* db.run(
		SQLite.deleteFrom(schema.typingIndicatorsTable)
			.where(($) => [$.lastTyped.lte(now - TYPING_TTL_MS)])
			.returning("id"),
	)
	return deleted.length
}).pipe(
	Effect.catchTag("DatabaseError", (error) =>
		Effect.logWarning("Typing indicator expiry failed", { error: error.message }).pipe(Effect.as(0)),
	),
	Effect.withSpan("ChannelObject.expireTyping"),
)
