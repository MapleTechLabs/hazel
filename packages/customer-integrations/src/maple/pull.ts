/**
 * The pulls: one `run_sql` aggregate per page, walking the window **one UTC day at a time**, and
 * within a day the activity phase before the metric one.
 *
 * | Phase | Groups by | Writes |
 * |---|---|---|
 * | `activity` | day × `GroupId` × `UserId` | an account reference and a contact's day of activity |
 * | `metrics` | day × `GroupId` × metric key | an account reference and a day's count per mapped metric |
 *
 * **Why a day at a time.** Maple's `run_sql` hands back at most `RUN_SQL_ROW_CAP` rows of a
 * result whatever the query matched (`./wire.ts`), so a page has to be small enough to fit
 * and the walk has to be able to ask for the rest. A day is the natural unit: it is what the ops
 * are keyed by, and its rows stop changing once it is over. Within a day the page is
 * `LIMIT <cap + 1> OFFSET <rows read>` over a total order (`account, contact` / `account, metric`):
 * Maple renders the first `RUN_SQL_ROW_CAP` and says `truncated` when it fetched more, which
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
import type { Day, IsoTimestamp, SyncProgress } from "@hazel/domain/customers"
import { Clock, Effect, Option, Schema } from "effect"
import type { PullPage } from "../kit/contract"
import { addDays, dayOf } from "../kit/time"
import type { MapleConnectionConfig } from "./config"
import type { MapleApi } from "./http"
import { activityOps, type MetricMap, metricDefinitionOps, metricMapOf, metricOps } from "./map"
import { activityEventsOf, activitySql, metricsSql, PAGE_LIMIT } from "./query"
import { MapleActivityRow, MapleMetricRow } from "./wire"

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

/** One UTC day, half-open, as Maple takes a window. */
const windowOf = (day: Day) => ({ start: `${day} 00:00:00`, end: `${addDays(day, 1)} 00:00:00` })

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
	readonly config: MapleConnectionConfig
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
	readonly config: MapleConnectionConfig
	readonly cursor: string | null
	readonly since: Date | null
}) {
	const nowMs = yield* Clock.currentTimeMillis
	// Taken before the request: what the day's counts were read as of (`../kit/contract.ts`).
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
