/**
 * Maple rows → `IngestOp`s (`docs/customers/tech-design.md` §3). Pure, so the mapping is tested
 * once and the pull only has to decide which day to ask for.
 *
 * The shape of the mapping:
 *
 * - **Identity is Clerk's.** A Maple product event names its customer in `GroupId` (the Clerk
 *   organization id) and its person in `UserId` (the Clerk user id,
 *   `maple/docs/product-events-catalog.md`). So Maple is not an identity source: it records
 *   **activity on contacts Clerk already created**, naming them by their Clerk ref directly. It
 *   emits no contact op of its own — `UpsertContact` has no `sameAs`, and Maple knows no email, so
 *   a contact op would create a second contact beside the Clerk one it means.
 * - **Account refs, not accounts.** Each page declares the accounts it touched
 *   (`onNoMatch: "unmatched"`, `sameAs` the Clerk organization, no domain matching), which is what
 *   puts a Maple chip on the account and attributes its unmatched records to the Maple connection.
 *   An account Clerk does not hold waits in the unmatched list; Maple never creates one.
 * - **A day of events → `customer_activity_daily`.** One op per (day, account, contact) with the
 *   day's `eventCount` and its distinct `sessionCount`. Ingest keeps the highest value it has seen
 *   for a day, so re-reading a day — which every overlapping pull does — cannot double count, and
 *   a day read while it was still filling in is corrected by the next pull.
 * - **A mapped event → a per-account daily metric** under `maple.<key>` (namespaced: ingest
 *   refuses a key another provider owns). Several events mapped to one key are summed by the query
 *   itself, so a (day, account, key) is one row and never split across pages: ingest replaces a
 *   day's metric value, which makes a re-read idempotent but would let a later page's partial sum
 *   overwrite an earlier one's.
 * - **No events, no sweeps.** Maple is authoritative for nothing: no account, contact or
 *   subscription is ever removed from what a Maple pull did or did not see.
 */
import type {
	DefineMetric,
	IngestOp,
	IsoTimestamp,
	ProviderRef,
	RecordActivity,
	RecordMetric,
	UpsertAccount,
} from "@hazel/domain/customers"
import {
	isEventName,
	isMetricKey,
	type MapleActivityRow,
	type MapleMetricRow,
	METRIC_PREFIX,
	metricKeyOf,
	type WireCount,
} from "./wire"

export const mapleRef = (externalId: string): ProviderRef => ({ provider: "maple", externalId })

const clerkRef = (externalId: string): ProviderRef => ({ provider: "clerk", externalId })

/** A count as a non-negative integer; `null` for one Hazel cannot read as a number. */
export const countOf = (value: WireCount): number | null => {
	if (typeof value === "string" && value.trim() === "") return null
	const count = typeof value === "number" ? value : Number(value)
	return Number.isFinite(count) && count >= 0 ? Math.round(count) : null
}

/**
 * The account a Maple group is: a reference and nothing else. Maple carries no name, no domain and
 * no logo in an aggregate, and it is not the identity source, so the op writes no field — it only
 * ties the Maple id to the Clerk organization of the same id.
 */
export const accountRefOp = (groupId: string, observedAt: IsoTimestamp): UpsertAccount => ({
	_tag: "account",
	externalId: groupId,
	sameAs: [clerkRef(groupId)],
	onNoMatch: "unmatched",
	observedAt,
})

/** Rows Hazel could not use, counted on the run so a quiet page is not mistaken for an empty one. */
export interface Mapped {
	readonly ops: ReadonlyArray<IngestOp>
	readonly skipped: number
}

/** A row of the day the page asked for, with a group: anything else is a Maple change. */
const usable = (row: { readonly day: string; readonly account: string }, day: string): boolean =>
	row.day === day && row.account.trim() !== ""

/**
 * A page of activity rows: each account declared once, then a day of activity per contact. The
 * account comes first because ingest resolves a metric's or an activity's account through the refs
 * an earlier op in the same apply established.
 *
 * A row of another day than `day` (the one the page read), or without a group or a user, is skipped:
 * the query asks for that day's identified rows only, so one is a Maple change, not a customer with
 * no account.
 */
export const activityOps = (
	rows: ReadonlyArray<MapleActivityRow>,
	day: string,
	observedAt: IsoTimestamp,
): Mapped => {
	const accounts = new Set<string>()
	const ops: Array<IngestOp> = []
	let skipped = 0
	for (const row of rows) {
		const events = countOf(row.events)
		const sessions = countOf(row.sessions)
		if (!usable(row, day) || row.contact.trim() === "" || events === null || sessions === null) {
			skipped += 1
			continue
		}
		if (!accounts.has(row.account)) {
			accounts.add(row.account)
			ops.push(accountRefOp(row.account, observedAt))
		}
		ops.push({
			_tag: "activity",
			contact: clerkRef(row.contact),
			account: mapleRef(row.account),
			day: row.day,
			eventCount: events,
			sessionCount: sessions,
		} satisfies RecordActivity)
	}
	return { ops, skipped }
}

/** Event name → the metric key it counts into, with the key already namespaced. */
export type MetricMap = ReadonlyMap<string, string>

/**
 * The configured mappings Hazel can act on: an event name it may put in a `WHERE … IN (…)` list
 * mapped to a key it may write. Two events may share a key (their counts add up); an event named
 * twice keeps its first key.
 */
export const metricMapOf = (
	mappings: ReadonlyArray<{ readonly event: string; readonly metricKey: string }>,
): MetricMap => {
	const map = new Map<string, string>()
	for (const { event, metricKey } of mappings) {
		const name = event.trim()
		const key = metricKey.trim()
		if (!isEventName(name) || !isMetricKey(key) || map.has(name)) continue
		map.set(name, metricKeyOf(key))
	}
	return map
}

/** One metric definition per key, so a chart and a signal are named after the key, not its id. */
export const metricDefinitionOps = (map: MetricMap): Array<DefineMetric> =>
	[...new Set(map.values())].sort().map((key) => ({
		_tag: "metric_definition",
		key,
		name: key.slice(METRIC_PREFIX.length),
		unit: "events",
		// A day's count is one day's worth: a span of days adds them up.
		aggregation: "sum",
		description: null,
	}))

/**
 * A page of metric rows: each account declared once, then one op per row. The query already summed
 * every mapped event of a key, so a row is the whole (day, account, key) count; a row of another
 * day or of a key nothing maps to is skipped.
 */
export const metricOps = (
	rows: ReadonlyArray<MapleMetricRow>,
	map: MetricMap,
	day: string,
	observedAt: IsoTimestamp,
): Mapped => {
	const keys = new Set(map.values())
	const accounts = new Set<string>()
	const ops: Array<IngestOp> = []
	let skipped = 0
	for (const row of rows) {
		const events = countOf(row.events)
		if (!usable(row, day) || !keys.has(row.metric) || events === null) {
			skipped += 1
			continue
		}
		if (!accounts.has(row.account)) {
			accounts.add(row.account)
			ops.push(accountRefOp(row.account, observedAt))
		}
		ops.push({
			_tag: "metric",
			account: mapleRef(row.account),
			metricKey: row.metric,
			day: row.day,
			value: events,
		} satisfies RecordMetric)
	}
	return { ops, skipped }
}
