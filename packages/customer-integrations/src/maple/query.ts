/**
 * The statements a pull runs, and the check a config passes to fit them. Pure, so the definition can
 * refuse a config without loading the adapter.
 */
import type { MapleConnectionConfig } from "./config"
import { type MetricMap, metricMapOf } from "./map"
import { isEventName, isMetricKey, RUN_SQL_ROW_CAP } from "./wire"

/** The two Maple columns that carry identity (`maple/docs/product-events-catalog.md`). */
const ACCOUNT_COLUMN = "GroupId"
const CONTACT_COLUMN = "UserId"

/** A SQL string literal: the only values Hazel interpolates are names its config checked. */
const quoted = (values: Iterable<string>) => [...values].map((value) => `'${value}'`).join(", ")

/** One past the rendered cap, so Maple's `truncated` says whether another page follows. */
export const PAGE_LIMIT = RUN_SQL_ROW_CAP + 1

export const activitySql = (events: ReadonlyArray<string>, offset: number) => `
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

/** The longest statement Maple's `run_sql` takes. */
const MAX_SQL_LENGTH = 32_768

/**
 * Why the config cannot be saved, or `null`. A pull drops an event name or metric key it may not
 * put in a query, so one is refused here instead of silently left out; and the queries spell out
 * the allowlist and the mappings, so they must fit `run_sql` (measured at an offset longer than any
 * page reaches).
 */
export const configProblem = (config: MapleConnectionConfig): string | null => {
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

/**
 * The configured activity allowlist Hazel can act on; empty means every identified event counts, so
 * a config naming an unusable event is refused when it is saved rather than read with it dropped.
 */
export const activityEventsOf = (config: MapleConnectionConfig) =>
	config.activityEvents.map((event) => event.trim()).filter(isEventName)
