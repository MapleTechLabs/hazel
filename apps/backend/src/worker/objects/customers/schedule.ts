/**
 * When a `CustomersObject` works on its own (`docs/customers/tech-design.md` §4.1). Its one alarm
 * (`runtime.ts`) folds these deadlines:
 *
 * - `computeDueAt` (meta): hourly, sooner when a done signal's `reopenAfter` comes first,
 *   ≤ 2 minutes after a person's change (rule, settings, a signal's status: `requestCompute`, a
 *   debounce that only moves the deadline earlier), and after ingest no sooner than
 *   `MIN_COMPUTE_GAP_MS` after the last compute (`requestComputeAfterIngest`), so steady webhooks
 *   do not recompute everything every few minutes. A compute takes a lease first (`COMPUTE_LEASE_MS`)
 *   and a failed one backs off exponentially (`./jobs.ts`), so nothing past due keeps the alarm
 *   firing, not even a run the runtime killed;
 * - the earliest `snoozedUntil` (wake);
 * - each active connection's `nextSyncAt` (scheduled pulls).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Clock, Effect, Option } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { deleteObjectMeta, readObjectMeta, writeObjectMeta } from "../meta"

export const COMPUTE_INTERVAL_MS = 60 * 60_000
export const COMPUTE_DEBOUNCE_MS = 2 * 60_000
/** Ingest never brings a compute closer than this after the last one. */
const MIN_COMPUTE_GAP_MS = 15 * 60_000
/** A run (compute, a pull) moves its own deadline this far first: killed mid-way, it retries then. */
export const LEASE_MS = 5 * 60_000
const MAX_COMPUTE_BACKOFF_MS = 6 * 60 * 60_000

/** Meta reads and writes fail as the store's `DatabaseError`. */
const meta = <A, R>(effect: Effect.Effect<A, SqlError, R>) =>
	effect.pipe(Effect.mapError(Database.toDatabaseError))

const COMPUTE_DUE_KEY = "computeDueAt"
const COMPUTE_FAILURES_KEY = "computeFailures"
const BASELINE_KEY = "baselineFor"
const REBUILD_KEY = "rebuildHistory"

export const computeDueAt = meta(Effect.map(readObjectMeta(COMPUTE_DUE_KEY), Option.map(Number)))

/** Move the deadline to `at` when that is earlier. */
const computeBy = (at: number) =>
	Effect.gen(function* () {
		const due = yield* computeDueAt
		if (Option.isNone(due) || due.value > at) yield* meta(writeObjectMeta(COMPUTE_DUE_KEY, String(at)))
	})

/** Compute soon (≤ 2 minutes): a person changed something it reads. */
export const requestCompute = Effect.flatMap(Clock.currentTimeMillis, (now) =>
	computeBy(now + COMPUTE_DEBOUNCE_MS),
)

/** Provider data changed: compute soon, but not sooner than `MIN_COMPUTE_GAP_MS` after the last run. */
export const requestComputeAfterIngest = Effect.gen(function* () {
	const db = yield* Database.Database
	const now = yield* Clock.currentTimeMillis
	const settings = yield* db.first(
		SQLite.from(schema.customerSettingsTable).select("lastComputedAt").limit(1),
	)
	const last = Option.getOrUndefined(settings)?.lastComputedAt?.getTime() ?? 0
	yield* computeBy(Math.max(now + COMPUTE_DEBOUNCE_MS, last + MIN_COMPUTE_GAP_MS))
})

/** A compute failed: retry after an exponential backoff (5 minutes, doubling, ≤ 6 hours). */
export const backOffCompute = (now: number) =>
	Effect.gen(function* () {
		const failures = Option.getOrElse(
			Option.map(yield* meta(readObjectMeta(COMPUTE_FAILURES_KEY)), Number),
			() => 0,
		)
		yield* meta(writeObjectMeta(COMPUTE_FAILURES_KEY, String(failures + 1)))
		yield* scheduleComputeAt(now + Math.min(MAX_COMPUTE_BACKOFF_MS, LEASE_MS * 2 ** failures))
	})

export const resetComputeFailures = meta(deleteObjectMeta(COMPUTE_FAILURES_KEY))

/** Compute at `at` (the end of a compute: the next hourly run). */
export const scheduleComputeAt = (at: number) => meta(writeObjectMeta(COMPUTE_DUE_KEY, String(at)))

/** Never compute again (the org was deleted). */
export const stopComputing = meta(deleteObjectMeta(COMPUTE_DUE_KEY))

/** The connections whose backfill finished since the last compute (comma-separated ids). */
export const baselineConnections = meta(
	Effect.map(readObjectMeta(BASELINE_KEY), (value) =>
		Option.match(value, { onNone: (): ReadonlyArray<string> => [], onSome: (ids) => ids.split(",") }),
	),
)

/** The next compute evaluates this connection's templates in baseline mode (§4.7): its backfill finished. */
export const setBaselineFor = (connectionId: string) =>
	Effect.gen(function* () {
		const ids = yield* baselineConnections
		if (!ids.includes(connectionId))
			yield* meta(writeObjectMeta(BASELINE_KEY, [...ids, connectionId].join(",")))
	})

export const clearBaseline = meta(deleteObjectMeta(BASELINE_KEY))

/** The next compute rebuilds the daily history (a backfill or the demo seed brought old data). */
export const requestHistoryRebuild = meta(writeObjectMeta(REBUILD_KEY, "1"))
export const historyRebuildPending = meta(Effect.map(readObjectMeta(REBUILD_KEY), Option.isSome))
export const clearHistoryRebuild = meta(deleteObjectMeta(REBUILD_KEY))

/**
 * The earliest `reopenAfter` of a done signal still unclosed, on a live account (a deleted account's
 * signals are closed by the next compute, never reopened).
 */
export const nextReopenAt = Effect.gen(function* () {
	const db = yield* Database.Database
	const row = yield* db.first(
		SQLite.from(schema.customerSignalsTable, "s")
			.innerJoin(schema.customerAccountsTable, "a", (s, a) =>
				SQLite.and(a.id.eq(s.accountId), a.deletedAt.isNull()),
			)
			.select(($) => ({ reopenAfter: $.reopenAfter }))
			.where(($) => [$.status.eq("done"), $.closedAt.isNull(), $.reopenAfter.isNotNull()])
			.orderBy(($) => [[$.reopenAfter, "asc"]])
			.limit(1),
	)
	return Option.flatMap(row, (signal) => Option.fromNullishOr(signal.reopenAfter?.getTime()))
})

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
