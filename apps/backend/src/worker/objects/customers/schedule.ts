/**
 * When a `CustomersObject` works on its own (`docs/customers/tech-design.md` §4.1). Its one alarm
 * (`runtime.ts`) folds these deadlines:
 *
 * - `computeDueAt` (meta): hourly, and ≤ 2 minutes after ingest, rule or settings changes
 *   (`requestCompute`, a debounce: it only ever moves the deadline earlier);
 * - the earliest `snoozedUntil` (wake) and `reopenAfter` (done but still true);
 * - each active connection's `nextSyncAt` (scheduled pulls).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Clock, Effect, Option } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { deleteObjectMeta, readObjectMeta, writeObjectMeta } from "../meta"

export const COMPUTE_INTERVAL_MS = 60 * 60_000
export const COMPUTE_DEBOUNCE_MS = 2 * 60_000

/** Meta reads and writes fail as the store's `DatabaseError`. */
const meta = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
	effect.pipe(Effect.mapError(Database.toDatabaseError))

const COMPUTE_DUE_KEY = "computeDueAt"
const BASELINE_KEY = "baselineFor"
const REBUILD_KEY = "rebuildHistory"

export const computeDueAt = meta(Effect.map(readObjectMeta(COMPUTE_DUE_KEY), Option.map(Number)))

/** Compute soon (≤ 2 minutes): something it reads changed. */
export const requestCompute = Effect.gen(function* () {
	const now = yield* Clock.currentTimeMillis
	const due = yield* computeDueAt
	const soon = now + COMPUTE_DEBOUNCE_MS
	if (Option.isNone(due) || due.value > soon) yield* meta(writeObjectMeta(COMPUTE_DUE_KEY, String(soon)))
})

/** Compute at `at` (the end of a compute: the next hourly run). */
export const scheduleComputeAt = (at: number) => meta(writeObjectMeta(COMPUTE_DUE_KEY, String(at)))

/** The next compute evaluates its rules in baseline mode (§4.7): a backfill just finished. */
export const setBaselineFor = (connectionId: string) =>
	meta(Effect.andThen(writeObjectMeta(BASELINE_KEY, connectionId), writeObjectMeta(REBUILD_KEY, "1")))

export const baselinePending = meta(Effect.map(readObjectMeta(BASELINE_KEY), Option.isSome))
export const clearBaseline = meta(deleteObjectMeta(BASELINE_KEY))

/** The next compute rebuilds the daily history (a backfill or the demo seed brought old data). */
export const requestHistoryRebuild = meta(writeObjectMeta(REBUILD_KEY, "1"))
export const historyRebuildPending = meta(Effect.map(readObjectMeta(REBUILD_KEY), Option.isSome))
export const clearHistoryRebuild = meta(deleteObjectMeta(REBUILD_KEY))

/** Every deadline of the object's own work, for its one alarm. */
export const customersDeadlines = Effect.gen(function* () {
	const db = yield* Database.Database
	const compute = yield* computeDueAt
	const snoozed = yield* db.first(
		SQLite.from(schema.customerSignalsTable)
			.select("snoozedUntil")
			.where(($) => [$.status.eq("snoozed"), $.closedAt.isNull(), $.snoozedUntil.isNotNull()])
			.orderBy(($) => [[$.snoozedUntil, "asc"]])
			.limit(1),
	)
	const reopen = yield* db.first(
		SQLite.from(schema.customerSignalsTable)
			.select("reopenAfter")
			.where(($) => [$.status.eq("done"), $.closedAt.isNull(), $.reopenAfter.isNotNull()])
			.orderBy(($) => [[$.reopenAfter, "asc"]])
			.limit(1),
	)
	const pull = yield* db.first(
		SQLite.from(schema.customerConnectionsTable)
			.select("nextSyncAt")
			.where(($) => [$.status.eq("active"), $.nextSyncAt.isNotNull()])
			.orderBy(($) => [[$.nextSyncAt, "asc"]])
			.limit(1),
	)
	return [
		Option.getOrUndefined(compute),
		Option.getOrUndefined(
			Option.flatMap(snoozed, (row) => Option.fromNullishOr(row.snoozedUntil?.getTime())),
		),
		Option.getOrUndefined(
			Option.flatMap(reopen, (row) => Option.fromNullishOr(row.reopenAfter?.getTime())),
		),
		Option.getOrUndefined(Option.flatMap(pull, (row) => Option.fromNullishOr(row.nextSyncAt?.getTime()))),
	]
}).pipe(
	Effect.catchTags({
		DatabaseError: (error) =>
			Effect.logWarning("Customers deadline lookup failed", { error: error.message }).pipe(
				Effect.as([]),
			),
	}),
)
