/**
 * The pulls: one `run_sql` aggregate per page, walking the window **one UTC day at a time**, and
 * within a day the activity phase before the metric one.
 *
 * | Phase | Groups by | Writes |
 * |---|---|---|
 * | `activity` | day × `GroupId` × `UserId` | an account reference and a contact's day of activity |
 * | `metrics` | day × `GroupId` × metric key | an account reference and a day's count per mapped metric |
 * | `queries` | the user's SQL, per Maple query metric | an account reference and the day's `value` |
 *
 * **Why a day at a time.** Maple's `run_sql` hands back at most {@link RUN_SQL_ROW_CAP} rows of a
 * result whatever the query matched (`../maple/wire.ts`), so a page has to be small enough to fit
 * and the walk has to be able to ask for the rest. A day is the natural unit: it is what the ops
 * are keyed by, and its rows stop changing once it is over. Within a day the page is
 * `LIMIT <cap + 1> OFFSET <rows read>` over a total order (`account, contact` / `account, metric`):
 * Maple renders the first {@link RUN_SQL_ROW_CAP} and says `truncated` when it fetched more, which
 * is what tells the walk another page follows. So an organization with more than a page of active
 * users a day is read over several pages instead of being cut, and a page cut shorter than the cap
 * is still followed.
 *
 * **Why Maple aggregates and Hazel does not.** Both phases are `GROUP BY` queries: a page reads
 * one day's counts, never its events. The busiest Maple event alone is about 12k rows a day, and
 * `product_events` is the whole organization's; pulling rows to count them in a Durable Object
 * would read thousands of times more data for the same two numbers. The metric phase groups by the
 * metric key rather than the event (`transform` maps each event to its key in the query), so two
 * events mapped to one key are one row: ingest replaces a day's value, and a key split across two
 * pages would otherwise land as the second page's part only.
 *
 * **Window.** A backfill (`since: null`) starts `lookbackDays` back, a scheduled pull at the day
 * `since` falls in — core passes `lastSuccessAt` minus an overlap, so an hourly pull re-reads today
 * and, around midnight, yesterday. Re-reading is free: ingest keeps a day's highest activity and
 * replaces a day's metric value, so no day is ever counted twice. The last day of the walk is
 * fixed when it starts (`until` on the cursor), so a backfill that runs past midnight finishes
 * where it began and the next pull picks up the new day.
 *
 * **User metrics** (`docs/customers/overview-layouts.md`). The metric phase's map is the config's
 * mappings plus each `product_event` metric's events (under its own key, no `maple.` prefix). The
 * `queries` phase runs each `maple_query` metric's SQL (in key order) with the day's window and the
 * page clause appended; a query Maple cannot run is recorded on its definition (`metricRuns`) and
 * the walk goes on to the next, so one bad query does not stall the pull. A metric's backfill walks
 * `lookbackDays` of that metric's phase only (`only`, `backfillCursor`).
 *
 * **No sweeps.** Maple is authoritative for nothing: what it did not see is not gone.
 */
import {
	type ConnectionConfig,
	type Day,
	type IsoTimestamp,
	type SyncProgress,
} from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage, UserMetric } from "../providers"
import { addDays, dayOf } from "../time"
import type { MapleApi } from "./http"
import { activityOps, type MetricMap, metricDefinitionOps, metricMapOf, metricOps, queryOps } from "./map"
import {
	isEventName,
	isMetricKey,
	MapleActivityRow,
	MapleMetricRow,
	MapleQueryRow,
	RUN_SQL_ROW_CAP,
} from "./wire"

/** The two Maple columns that carry identity (`maple/docs/product-events-catalog.md`). */
const ACCOUNT_COLUMN = "GroupId"
const CONTACT_COLUMN = "UserId"

/**
 * Maple's webhooks do not exist for product events, so the walk is the only signal; a day's counts
 * are only interesting once, and an hour is soon enough for a usage drop.
 */
export const MAPLE_PULL_INTERVAL_MS = 60 * 60_000

const MaplePhase = Schema.Literals(["activity", "metrics", "queries"])
type MaplePhase = typeof MaplePhase.Type

/** A day's phases in the order they are read. */
const PHASES: ReadonlyArray<MaplePhase> = ["activity", "metrics", "queries"]

/** Where the walk is; carried on the run as JSON so an evicted object resumes the same day. */
const MapleCursor = Schema.Struct({
	/** The UTC day being read. */
	day: Schema.String,
	phase: MaplePhase,
	/** Rows of this day and phase already read; the page's `OFFSET`. */
	offset: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	/** Rows read since the walk started, for the progress the data-sources page shows. */
	done: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
	/** The walk's last day, fixed when it started: a backfill past midnight still ends here. */
	until: Schema.String,
	/** In the `queries` phase: the key of the Maple query metric being read (they go in key order). */
	query: Schema.optionalKey(Schema.String),
	/** A user metric's backfill: only that metric's phase is read, each day. */
	only: Schema.optionalKey(Schema.String),
})
type MapleCursor = typeof MapleCursor.Type

const decodeDocument = Schema.decodeUnknownOption(Schema.fromJsonString(MapleCursor))

/** The run's cursor; `None` for one Hazel cannot read (a format change between deploys). */
export const decodeCursor = (cursor: string): Option.Option<MapleCursor> => decodeDocument(cursor)

export const encodeCursor = (cursor: MapleCursor): string => JSON.stringify(cursor)

/** A SQL string literal: the only values Hazel interpolates are names its config checked. */
const quoted = (values: Iterable<string>) => [...values].map((value) => `'${value}'`).join(", ")

/** One past the rendered cap, so Maple's `truncated` says whether another page follows. */
const PAGE_LIMIT = RUN_SQL_ROW_CAP + 1

const activitySql = (events: ReadonlyArray<string>, offset: number) => `
SELECT toDate(Timestamp) AS day,
       ${ACCOUNT_COLUMN} AS account,
       ${CONTACT_COLUMN} AS contact,
       count() AS events,
       uniqExactIf(SessionId, SessionId != '') AS sessions
FROM product_events
WHERE $__orgFilter
  AND Timestamp >= $__startTime AND Timestamp < $__endTime
  AND ${ACCOUNT_COLUMN} != '' AND ${CONTACT_COLUMN} != ''${
		events.length === 0 ? "" : `\n  AND EventName IN (${quoted(events)})`
  }
GROUP BY day, account, contact
ORDER BY account, contact
LIMIT ${PAGE_LIMIT} OFFSET ${offset}`

/** Counts per metric key: `transform` maps each mapped event to its (namespaced) key. */
export const metricsSql = (map: MetricMap, offset: number) => `
SELECT toDate(Timestamp) AS day,
       ${ACCOUNT_COLUMN} AS account,
       transform(EventName, [${quoted(map.keys())}], [${quoted(map.values())}]) AS metric,
       count() AS events
FROM product_events
WHERE $__orgFilter
  AND Timestamp >= $__startTime AND Timestamp < $__endTime
  AND ${ACCOUNT_COLUMN} != ''
  AND EventName IN (${quoted(map.keys())})
GROUP BY day, account, metric
ORDER BY account, metric
LIMIT ${PAGE_LIMIT} OFFSET ${offset}`

/**
 * A Maple query metric's statement as a page runs it: its rows in a total order, one page of them.
 * Appended, not wrapped: `checkMapleSql` holds it to one plain SELECT ending in `GROUP BY account`,
 * and Maple wants `$__orgFilter` top-level, which a wrapping subquery would hide.
 */
export const querySql = (sql: string, offset: number) =>
	`${sql.trim().replace(/;\s*$/, "")}\nORDER BY account\nLIMIT ${PAGE_LIMIT} OFFSET ${offset}`

/** The longest statement Maple's `run_sql` takes. */
const MAX_SQL_LENGTH = 32_768

/**
 * Why the config cannot be saved, or `null`. A pull drops an event name or metric key it may not
 * put in a query, so one is refused here instead of silently left out; and the queries spell out
 * the allowlist and the mappings, so they must fit `run_sql` (measured at an offset longer than any
 * page reaches).
 */
export const configProblem = (config: Extract<ConnectionConfig, { _tag: "maple" }>): string | null => {
	const listed = (values: ReadonlyArray<string>) => values.map((value) => JSON.stringify(value)).join(", ")
	const events = config.activityEvents.filter((event) => !isEventName(event.trim()))
	if (events.length > 0) {
		return `Maple event names are 1–120 letters, digits or _ $ . : / -; fix or remove ${listed(events)}`
	}
	const mappings = config.metricMappings.filter(
		(mapping) => !isEventName(mapping.event.trim()) || !isMetricKey(mapping.metricKey.trim()),
	)
	if (mappings.length > 0) {
		return `Mapped events are 1–120 letters, digits or _ $ . : / -, metric keys 1–80 letters, digits or _ . -; fix or remove ${listed(mappings.map((mapping) => `${mapping.event} → ${mapping.metricKey}`))}`
	}
	const offset = Number.MAX_SAFE_INTEGER
	const fits =
		activitySql(activityEventsOf(config), offset).length < MAX_SQL_LENGTH &&
		metricsSql(metricMapOf(config.metricMappings), offset).length < MAX_SQL_LENGTH
	return fits ? null : "The activity events and metric mappings are too long for a Maple query; remove some"
}

/** One UTC day, half-open, as Maple takes a window. */
export const windowOf = (day: Day) => ({ start: `${day} 00:00:00`, end: `${addDays(day, 1)} 00:00:00` })

/**
 * The configured activity allowlist Hazel can act on; empty means every identified event counts, so
 * a config naming an unusable event is refused when it is saved rather than read with it dropped.
 */
const activityEventsOf = (config: Extract<ConnectionConfig, { _tag: "maple" }>) =>
	config.activityEvents.map((event) => event.trim()).filter(isEventName)

/**
 * The first day of a walk: `lookbackDays` back for a backfill, else the day `since` falls in. Never
 * past the walk's last day, so a clock running ahead reads one day rather than nothing.
 */
export const firstDayOf = (input: {
	readonly since: Date | null
	readonly lookbackDays: number
	readonly until: Day
}): Day => {
	const start = input.since === null ? addDays(input.until, -(input.lookbackDays - 1)) : dayOf(input.since)
	return start > input.until ? input.until : start
}

/** One step of a day's walk: a phase, and in the `queries` phase the metric's key. */
interface Step {
	readonly phase: MaplePhase
	readonly query?: string
}

/** `a` comes after `b` in a day's walk. */
const isAfter = (a: Step, b: Step) => {
	const byPhase = PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase)
	return byPhase !== 0 ? byPhase > 0 : (a.query ?? "") > (b.query ?? "")
}

/**
 * Where the walk goes after this page: on in this day and step, to the day's next step, the next
 * day's first, or done. `steps` are the day's, in order; `at` the step this page read.
 */
const nextCursor = (
	cursor: MapleCursor,
	page: { readonly rows: number; readonly more: boolean; readonly done: number },
	steps: ReadonlyArray<Step>,
	at: Step,
): MapleCursor | null => {
	const carried = {
		until: cursor.until,
		done: page.done,
		only: cursor.only,
	}
	const stepOf = (step: Step) => ({
		phase: step.phase,
		query: step.query,
	})
	// Maple fetched more than it rendered: the rest of this day and step is behind this page.
	if (page.more)
		return { ...carried, ...stepOf(at), day: cursor.day, offset: (cursor.offset ?? 0) + page.rows }
	const next = steps.find((step) => isAfter(step, at))
	if (next !== undefined) return { ...carried, ...stepOf(next), day: cursor.day }
	const [first] = steps
	if (cursor.day >= cursor.until || first === undefined) return null
	return { ...carried, ...stepOf(first), day: addDays(cursor.day, 1) }
}

/**
 * The cursor of a user metric's backfill: `lookbackDays` up to today of that metric's phase only
 * (its query, or the metric phase with its events). `None` for a formula, which Maple does not hold.
 */
export const backfillCursor = (
	metric: UserMetric,
	lookbackDays: number,
	today: Day,
): Option.Option<string> => {
	if (metric.source._tag === "formula") return Option.none()
	const day = firstDayOf({ since: null, lookbackDays, until: today })
	return Option.some(
		encodeCursor(
			metric.source._tag === "maple_query"
				? { day, phase: "queries", query: metric.key, until: today, only: metric.key }
				: { day, phase: "metrics", until: today, only: metric.key },
		),
	)
}

/** The user metric a run's cursor backfills alone (`backfillCursor`); undefined for a full walk. */
export const metricBackfillKey = (cursor: string | null): string | undefined =>
	cursor === null ? undefined : Option.getOrUndefined(decodeCursor(cursor))?.only

interface PageInput {
	readonly api: MapleApi
	readonly config: Extract<ConnectionConfig, { _tag: "maple" }>
	readonly observedAt: IsoTimestamp
}

/** Recorded on a Maple query metric whose SQL Maple did not run (Maple's own reason is logged). */
const QUERY_FAILED = "Maple could not run this query; check it with Preview in the metric's editor"

const activityPage = Effect.fnUntraced(function* (input: PageInput, cursor: MapleCursor) {
	const result = yield* input.api.runSql({
		step: "activity",
		sql: activitySql(activityEventsOf(input.config), cursor.offset ?? 0),
		window: windowOf(cursor.day),
		row: MapleActivityRow,
	})
	return {
		rows: result.rows.length,
		more: result.truncated || result.rows.length >= PAGE_LIMIT,
		...activityOps(result.rows, cursor.day, input.observedAt),
	}
})

const metricsPage = Effect.fnUntraced(function* (
	input: PageInput,
	cursor: MapleCursor,
	map: MetricMap,
	configured: MetricMap,
) {
	const result = yield* input.api.runSql({
		step: "metrics",
		sql: metricsSql(map, cursor.offset ?? 0),
		window: windowOf(cursor.day),
		row: MapleMetricRow,
	})
	const mapped = metricOps(result.rows, map, cursor.day, input.observedAt)
	// The definitions are idempotent and cheap, and the first page of a walk is the only place a
	// newly mapped key would otherwise go unnamed until a chart asked for it. Only the config's: a
	// user metric is defined by the person who made it.
	const ops = (cursor.offset ?? 0) === 0 ? [...metricDefinitionOps(configured), ...mapped.ops] : mapped.ops
	return {
		rows: result.rows.length,
		more: result.truncated || result.rows.length >= PAGE_LIMIT,
		ops,
		skipped: mapped.skipped,
	}
})

/**
 * One page of a Maple query metric. Maple's tool refusing the statement (inside a 200: no HTTP
 * status, a retryable refusal) is the query's failure, recorded on it, and the walk moves on;
 * anything else (auth, rate limit, network, a 5xx, an answer Hazel cannot read) is the pull's, and
 * the run retries its days.
 */
const queryPage = Effect.fnUntraced(function* (
	input: PageInput,
	cursor: MapleCursor,
	query: { readonly key: string; readonly sql: string },
) {
	return yield* input.api
		.runSql({
			step: "metric query",
			sql: querySql(query.sql, cursor.offset ?? 0),
			window: windowOf(cursor.day),
			row: MapleQueryRow,
		})
		.pipe(
			Effect.map((result) => ({
				rows: result.rows.length,
				more: result.truncated || result.rows.length >= PAGE_LIMIT,
				...queryOps(result.rows, query.key, cursor.day),
				metricRuns: [{ key: query.key, error: null }],
			})),
			Effect.catchTag("CustomerProviderError", (error) =>
				error.code === "provider" && error.httpStatus === null && error.retryable !== false
					? Effect.succeed({
							...NO_ROWS,
							metricRuns: [{ key: query.key, error: QUERY_FAILED }],
						})
					: Effect.fail(error),
			),
		)
})

/** A step with nothing (left) to read: its mappings or metric were removed since the walk started. */
const NO_ROWS = { rows: 0, more: false, ops: [], skipped: 0 }

/**
 * The metric phase's map: the config's mappings, then each product event metric's events under its
 * own key (an event already mapped keeps its first key).
 */
const metricMapWith = (configured: MetricMap, metrics: ReadonlyArray<UserMetric>): MetricMap => {
	const map = new Map(configured)
	for (const metric of metrics) {
		if (metric.source._tag !== "product_event") continue
		for (const event of metric.source.events) {
			const name = event.trim()
			if (isEventName(name) && !map.has(name)) map.set(name, metric.key)
		}
	}
	return map
}

export const pullPage = Effect.fn("Maple.pullPage")(function* (input: {
	readonly api: MapleApi
	readonly config: Extract<ConnectionConfig, { _tag: "maple" }>
	readonly cursor: string | null
	readonly since: Date | null
	/** The org's user-defined metrics: product events join the metric phase, queries run in theirs. */
	readonly metrics: ReadonlyArray<UserMetric>
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before the request: what the day's counts were read as of (`../providers.ts`).
	const observedAt = new Date(nowMs).toISOString()
	const today = dayOf(new Date(nowMs))
	const decoded = input.cursor === null ? Option.none() : decodeCursor(input.cursor)
	if (input.cursor !== null && Option.isNone(decoded)) {
		yield* Effect.logWarning("Maple pull cursor unreadable: the pull starts over")
	}
	const read = Option.getOrElse(decoded, (): MapleCursor => ({
		day: firstDayOf({
			since: input.since,
			lookbackDays: input.config.lookbackDays,
			until: today,
		}),
		phase: "activity",
		until: today,
	}))
	// A backfill reads its one metric; a walk the config's mappings and every user metric.
	const metrics = input.metrics.filter((metric) => read.only === undefined || metric.key === read.only)
	const configured = read.only === undefined ? metricMapOf(input.config.metricMappings) : new Map()
	const map = metricMapWith(configured, metrics)
	const queries = metrics
		.flatMap((metric) =>
			metric.source._tag === "maple_query" ? [{ key: metric.key, sql: metric.source.sql }] : [],
		)
		.sort((a, b) => (a.key < b.key ? -1 : 1))
	const steps: ReadonlyArray<Step> = [
		...(read.only === undefined ? [{ phase: "activity" as const }] : []),
		...(map.size > 0 ? [{ phase: "metrics" as const }] : []),
		...queries.map((query) => ({ phase: "queries" as const, query: query.key })),
	]
	// The cursor's query, or the next one when it was deleted meanwhile (from its first row).
	const query =
		read.phase === "queries" ? queries.find((entry) => entry.key >= (read.query ?? "")) : undefined
	const cursor: MapleCursor =
		query === undefined || query.key === read.query
			? read
			: { ...read, query: query.key, offset: undefined }
	const pageInput: PageInput = { api: input.api, config: input.config, observedAt }
	const queried = query === undefined ? undefined : yield* queryPage(pageInput, cursor, query)
	const page =
		cursor.phase === "activity"
			? yield* activityPage(pageInput, cursor)
			: cursor.phase === "metrics"
				? map.size === 0
					? NO_ROWS
					: yield* metricsPage(pageInput, cursor, map, configured)
				: (queried ?? NO_ROWS)
	const done = (cursor.done ?? 0) + page.rows
	const at: Step =
		cursor.phase === "queries"
			? { phase: "queries", query: query?.key ?? "\uffff" }
			: { phase: cursor.phase }
	const onward = nextCursor(cursor, { rows: page.rows, more: page.more, done }, steps, at)
	const progress: SyncProgress = { step: cursor.phase, done, total: null }
	yield* Effect.annotateCurrentSpan({
		"maple.phase": cursor.phase,
		"maple.day": cursor.day,
		"maple.query": query?.key,
		"maple.received": page.rows,
		"maple.ops": page.ops.length,
		"maple.skipped": page.skipped,
	})
	if (page.skipped > 0) {
		yield* Effect.logWarning("Maple rows Hazel cannot use skipped", {
			phase: cursor.phase,
			skipped: page.skipped,
		})
	}
	// Nothing Maple reports is authoritative for a record's existence, so no page ever sweeps.
	return {
		ops: page.ops,
		nextCursor: onward === null ? null : encodeCursor(onward),
		progress,
		metricRuns: queried?.metricRuns,
	} satisfies PullPage
})
