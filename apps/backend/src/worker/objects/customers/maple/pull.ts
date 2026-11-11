/**
 * The pulls: one `run_sql` aggregate per page, walking the window **one UTC day at a time**, and
 * within a day the activity phase before the metric one.
 *
 * | Phase | Groups by | Writes |
 * |---|---|---|
 * | `activity` | day × `GroupId` × `UserId` | an account reference and a contact's day of activity |
 * | `metrics` | day × `GroupId` × metric key | an account reference and a day's count per mapped metric |
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
 * **No sweeps.** Maple is authoritative for nothing: what it did not see is not gone.
 */
import type { ConnectionConfig, Day, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../providers"
import { addDays, dayOf } from "../time"
import type { MapleApi } from "./http"
import { activityOps, type MetricMap, metricDefinitionOps, metricMapOf, metricOps } from "./map"
import { isEventName, isMetricKey, MapleActivityRow, MapleMetricRow, RUN_SQL_ROW_CAP } from "./wire"

/** The two Maple columns that carry identity (`maple/docs/product-events-catalog.md`). */
export const ACCOUNT_COLUMN = "GroupId"
export const CONTACT_COLUMN = "UserId"

/**
 * Maple's webhooks do not exist for product events, so the walk is the only signal; a day's counts
 * are only interesting once, and an hour is soon enough for a usage drop.
 */
export const MAPLE_PULL_INTERVAL_MS = 60 * 60_000

const MaplePhase = Schema.Literals(["activity", "metrics"])
type MaplePhase = typeof MaplePhase.Type

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
const metricsSql = (map: MetricMap, offset: number) => `
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
const windowOf = (day: Day) => ({ start: `${day} 00:00:00`, end: `${addDays(day, 1)} 00:00:00` })

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

/** Where the walk goes after this page: on in this day, into the next phase, the next day, or done. */
const nextCursor = (
	cursor: MapleCursor,
	page: { readonly rows: number; readonly more: boolean; readonly done: number },
	hasMetrics: boolean,
): MapleCursor | null => {
	const carried = { until: cursor.until, done: page.done }
	// Maple fetched more than it rendered: the rest of this day and phase is behind this page.
	if (page.more)
		return { ...carried, day: cursor.day, phase: cursor.phase, offset: (cursor.offset ?? 0) + page.rows }
	if (cursor.phase === "activity" && hasMetrics) return { ...carried, day: cursor.day, phase: "metrics" }
	if (cursor.day >= cursor.until) return null
	return { ...carried, day: addDays(cursor.day, 1), phase: "activity" }
}

interface PageInput {
	readonly api: MapleApi
	readonly config: Extract<ConnectionConfig, { _tag: "maple" }>
	readonly observedAt: IsoTimestamp
}

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

const metricsPage = Effect.fnUntraced(function* (input: PageInput, cursor: MapleCursor, map: MetricMap) {
	const result = yield* input.api.runSql({
		step: "metrics",
		sql: metricsSql(map, cursor.offset ?? 0),
		window: windowOf(cursor.day),
		row: MapleMetricRow,
	})
	const mapped = metricOps(result.rows, map, cursor.day, input.observedAt)
	// The definitions are idempotent and cheap, and the first page of a walk is the only place a
	// newly mapped key would otherwise go unnamed until a chart asked for it.
	const ops = (cursor.offset ?? 0) === 0 ? [...metricDefinitionOps(map), ...mapped.ops] : mapped.ops
	return {
		rows: result.rows.length,
		more: result.truncated || result.rows.length >= PAGE_LIMIT,
		ops,
		skipped: mapped.skipped,
	}
})

/** A metric phase with nothing (left) to map: the mappings were cleared since the walk started. */
const NO_METRICS = { rows: 0, more: false, ops: [], skipped: 0 }

export const pullPage = Effect.fn("Maple.pullPage")(function* (input: {
	readonly api: MapleApi
	readonly config: Extract<ConnectionConfig, { _tag: "maple" }>
	readonly cursor: string | null
	readonly since: Date | null
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before the request: what the day's counts were read as of (`../providers.ts`).
	const observedAt = new Date(nowMs).toISOString()
	const today = dayOf(new Date(nowMs))
	const map = metricMapOf(input.config.metricMappings)
	const decoded = input.cursor === null ? Option.none() : decodeCursor(input.cursor)
	if (input.cursor !== null && Option.isNone(decoded)) {
		yield* Effect.logWarning("Maple pull cursor unreadable: the pull starts over")
	}
	const cursor = Option.getOrElse(decoded, (): MapleCursor => ({
		day: firstDayOf({
			since: input.since,
			lookbackDays: input.config.lookbackDays,
			until: today,
		}),
		phase: "activity",
		until: today,
	}))
	const pageInput: PageInput = { api: input.api, config: input.config, observedAt }
	const page =
		cursor.phase === "activity"
			? yield* activityPage(pageInput, cursor)
			: map.size === 0
				? NO_METRICS
				: yield* metricsPage(pageInput, cursor, map)
	const done = (cursor.done ?? 0) + page.rows
	const onward = nextCursor(cursor, { rows: page.rows, more: page.more, done }, map.size > 0)
	const progress: SyncProgress = { step: cursor.phase, done, total: null }
	yield* Effect.annotateCurrentSpan({
		"maple.phase": cursor.phase,
		"maple.day": cursor.day,
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
	} satisfies PullPage
})
