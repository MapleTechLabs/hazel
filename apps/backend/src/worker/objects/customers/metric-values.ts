/**
 * Metric values the Overview and its layouts read (`docs/customers/overview-layouts.md`), for any
 * kind of metric: a built-in derives from its source (`./facts.ts`), a stored metric reads
 * `customer_metric_daily`, a formula evaluates over its operands. Over a window each operand is
 * aggregated by its own aggregation first, then the formula applies (a ratio of sums).
 *
 * - `ruleWindowValues`: every live account's values for the windows layout rules read, in a query
 *   per window length (plus one for daily active users), not per account.
 * - `metricCoverage`: per stored key, accounts with data in the last 30 days and the latest day.
 * - `metricSourceProblem`: why a user's metric source cannot be saved.
 *
 * One account's windows and daily series are `./read.ts`'s (`accountMetricWindows`, `accountSeries`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	builderProblem,
	checkMapleSql,
	type Day,
	evaluateFormula,
	type FormulaNode,
	type MetricAggregation,
	type MetricSource,
	metricWindowKey,
	parseFormula,
} from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect } from "effect"
import { DERIVED_METRICS } from "./facts"
import { isEventName } from "./maple/wire"
import { addDays, dayOf } from "./time"

export type Definitions = ReadonlyMap<string, schema.CustomerMetricDefinition>

export const loadDefinitions = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.run(SQLite.from(schema.customerMetricDefinitionsTable).select())
	return new Map(rows.map((row) => [row.key, row])) as Definitions
})

export interface Formula {
	readonly node: FormulaNode
	readonly keys: ReadonlyArray<string>
}

/** A formula metric's parsed expression; undefined for any other metric. */
export const formulaOf = (definition: schema.CustomerMetricDefinition | undefined): Formula | undefined => {
	if (definition?.source?._tag !== "formula") return undefined
	const parsed = parseFormula(definition.source.expression)
	return parsed.ok ? parsed : undefined
}

/** The keys holding data that `keys` read: a formula's operands in its place, unknown keys left out. */
export const dataKeysOf = (keys: Iterable<string>, definitions: Definitions): Array<string> => [
	...new Set(
		[...keys]
			.flatMap((key) => formulaOf(definitions.get(key))?.keys ?? [key])
			.filter((key) => definitions.has(key) && formulaOf(definitions.get(key)) === undefined),
	),
]

/** Days' values (in day order) combined by the metric's aggregation; null without any. */
export const aggregate = (values: ReadonlyArray<number>, aggregation: MetricAggregation): number | null => {
	if (values.length === 0) return null
	if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0)
	if (aggregation === "max") return Math.max(...values)
	return values.at(-1) ?? null
}

/**
 * A metric's value over a window from its operands' values over the same window: a formula
 * evaluated over them, any other metric its own; null for a key Hazel does not know.
 */
export const windowValue = (
	key: string,
	definitions: Definitions,
	valueOf: (key: string, aggregation: MetricAggregation) => number | null,
): number | null => {
	const definition = definitions.get(key)
	if (definition === undefined) return null
	const formula = formulaOf(definition)
	if (definition.source?._tag === "formula" && formula === undefined) return null
	if (formula === undefined) return valueOf(key, definition.aggregation)
	return evaluateFormula(formula.node, (operand) => {
		const own = definitions.get(operand)
		return own === undefined ? null : valueOf(operand, own.aggregation)
	})
}

/** The account fields the `last`-level built-ins read for a window ending today. */
export type BuiltInAccount = Pick<schema.CustomerAccount, "id" | "activeUsers30d" | "mrrMinor">

/** A window's aggregates of one account's days, the latest riding on its day (`YYYY-MM-DD` orders as text). */
type StoredWindowRow = {
	accountId: CustomerAccountId
	total: number
	high: number
	latest: string
}

interface StoredWindow {
	readonly sum: number
	readonly max: number
	readonly last: number
}

const windowOfRow = (row: StoredWindowRow): StoredWindow => ({
	sum: Number(row.total),
	max: Number(row.high),
	last: Number(row.latest.slice(row.latest.indexOf("|") + 1)),
})

const ACTIVE = Database.sql`("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`

/**
 * Every account's value of each `(metricKey, windowDays)` window ending today, keyed
 * `metricWindowKey`. Stored metrics and the health score (its scored days) aggregate in SQL per
 * window length; `active_users` is the window's highest daily count; MRR and 30-day active users
 * are `last` levels, so the account's current value. Formulas evaluate over their operands' windows.
 */
export const ruleWindowValues = Effect.fn("Customers.ruleWindowValues")(function* (
	windows: ReadonlyArray<{ readonly metricKey: string; readonly windowDays: number }>,
	accounts: ReadonlyArray<BuiltInAccount>,
	today: Day,
) {
	const result = new Map<CustomerAccountId, Map<string, number | null>>()
	if (windows.length === 0) return result
	const db = yield* Database.Database
	const definitions = yield* loadDefinitions
	const lengths = [...new Set(windows.map((window) => window.windowDays))]
	/** Window length → account → key → that window's sum, max and last. */
	const stored = new Map<number, Map<string, StoredWindow>>()
	const dau = new Map<number, Map<CustomerAccountId, number>>()
	for (const days of lengths) {
		const keys = dataKeysOf(
			windows.filter((window) => window.windowDays === days).map((window) => window.metricKey),
			definitions,
		)
		const from = addDays(today, -(days - 1))
		const plain = keys.filter((key) => !DERIVED_METRICS.has(key))
		if (plain.length > 0) {
			// The latest day's value rides on its day: `YYYY-MM-DD` orders as text.
			const rows = (yield* db.query(
				Database.sql`SELECT "accountId", "metricKey", sum("value") AS "total", max("value") AS "high",
					max("day" || '|' || "value") AS "latest" FROM "customer_metric_daily"
					WHERE "metricKey" IN (SELECT value FROM json_each(${JSON.stringify(plain)}))
					AND "day" >= ${from} AND "day" <= ${today} GROUP BY "accountId", "metricKey"`,
			)) as ReadonlyArray<StoredWindowRow & { metricKey: string }>
			stored.set(
				days,
				new Map(rows.map((row) => [`${row.accountId}:${row.metricKey}`, windowOfRow(row)])),
			)
		}
		// Health as the Overview reads it: the scored days only (an unscored day is no data).
		if (keys.includes("health_score")) {
			const rows = (yield* db.query(
				Database.sql`SELECT "accountId", sum("score") AS "total", max("score") AS "high",
					max("day" || '|' || "score") AS "latest" FROM "customer_health_daily"
					WHERE "score" IS NOT NULL AND "day" >= ${from} AND "day" <= ${today} GROUP BY "accountId"`,
			)) as ReadonlyArray<StoredWindowRow>
			const own = stored.get(days) ?? new Map<string, StoredWindow>()
			for (const row of rows) own.set(`${row.accountId}:health_score`, windowOfRow(row))
			stored.set(days, own)
		}
		if (keys.includes("active_users")) {
			const rows = (yield* db.query(
				Database.sql`SELECT "accountId", max("users") AS "users" FROM (
					SELECT "accountId", "day", count(*) AS "users" FROM "customer_activity_daily"
					WHERE "day" >= ${from} AND "day" <= ${today} AND ${ACTIVE} GROUP BY "accountId", "day"
				) GROUP BY "accountId"`,
			)) as ReadonlyArray<{ accountId: CustomerAccountId; users: number }>
			dau.set(days, new Map(rows.map((row) => [row.accountId, Number(row.users)])))
		}
	}
	for (const account of accounts) {
		const values = new Map<string, number | null>()
		for (const { metricKey, windowDays } of windows) {
			values.set(
				metricWindowKey(metricKey, windowDays),
				windowValue(metricKey, definitions, (key, aggregation) => {
					switch (key) {
						case "active_users":
							return dau.get(windowDays)?.get(account.id) ?? 0
						case "active_users_30d":
							return account.activeUsers30d
						case "mrr":
							return account.mrrMinor
					}
					const row = stored.get(windowDays)?.get(`${account.id}:${key}`)
					return row === undefined ? null : row[aggregation]
				}),
			)
		}
		result.set(account.id, values)
	}
	return result
})

/** Per stored metric key: accounts with a value above 0 in the last 30 days, and its latest day. */
export const metricCoverage = Effect.fn("Customers.metricCoverage")(function* (now: Date) {
	const db = yield* Database.Database
	const from = addDays(dayOf(now), -29)
	const rows = (yield* db.query(
		Database.sql`SELECT "metricKey",
			count(DISTINCT CASE WHEN "value" > 0 AND "day" >= ${from} THEN "accountId" END) AS "accounts",
			max("day") AS "lastDay"
			FROM "customer_metric_daily" GROUP BY "metricKey" ORDER BY "metricKey"`,
	)) as ReadonlyArray<{ metricKey: string; accounts: number; lastDay: string | null }>
	return rows.map((row) => ({
		metricKey: row.metricKey,
		accountsWithData: Number(row.accounts),
		lastDay: row.lastDay,
	}))
})

/**
 * Why a user metric's source cannot be saved under `key`, or null: a Maple query must keep the
 * pull's contract and fit Maple's statement limit, product events must be names Hazel may put in a
 * query, and a formula must parse and read only existing metrics that are not formulas themselves.
 */
export const metricSourceProblem = (
	key: string,
	source: MetricSource,
	definitions: Definitions,
): string | null => {
	switch (source._tag) {
		case "maple_query":
			return (
				(source.builder === null ? null : builderProblem(source.builder)) ?? checkMapleSql(source.sql)
			)
		case "product_event": {
			const bad = source.events.filter((event) => !isEventName(event.trim()))
			return bad.length === 0
				? null
				: `Maple event names are 1–120 letters, digits or _ $ . : / -; fix ${bad.map((event) => JSON.stringify(event)).join(", ")}`
		}
		case "formula": {
			const parsed = parseFormula(source.expression)
			if (!parsed.ok) return parsed.error
			if (parsed.keys.includes(key)) return "A formula cannot use itself"
			const unknown = parsed.keys.filter((operand) => !definitions.has(operand))
			if (unknown.length > 0) return `No metric ${unknown.map((operand) => `{${operand}}`).join(", ")}`
			const formulas = parsed.keys.filter(
				(operand) => definitions.get(operand)?.source?._tag === "formula",
			)
			return formulas.length === 0
				? null
				: `${formulas.map((operand) => `{${operand}}`).join(", ")} is a formula; formulas cannot use formulas`
		}
	}
}

/** SQL with its whitespace collapsed outside string literals: `'a  b'` stays a different value. */
const collapsedSql = (sql: string): string =>
	sql
		.trim()
		.replace(/;\s*$/, "")
		.split(/('(?:[^'\\]|\\.)*')/)
		.map((part, index) => (index % 2 === 1 ? part : part.replace(/\s+/g, " ")))
		.join("")

/** A source as the data it makes: SQL and formulas whitespace-collapsed, events trimmed and sorted. */
const dataOf = (source: MetricSource): string => {
	switch (source._tag) {
		case "maple_query":
			return `maple_query\n${collapsedSql(source.sql)}`
		case "product_event":
			return `product_event\n${[...new Set(source.events.map((event) => event.trim()))].sort().join("\n")}`
		case "formula":
			return `formula\n${source.expression.replace(/\s+/g, "")}`
	}
}

/**
 * Two sources make the same daily values: the one rule for both a save (the same data keeps its
 * stored days and backfill) and a pull (a page read under the same data still lands).
 */
export const sameMetricData = (a: MetricSource | null, b: MetricSource | null): boolean =>
	a !== null && b !== null && dataOf(a) === dataOf(b)
