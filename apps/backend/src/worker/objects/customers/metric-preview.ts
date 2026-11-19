/**
 * `customers.metric.preview`: a metric source tried over the last days without saving it
 * (`docs/customers/overview-layouts.md`). A Maple query or product event count runs through the
 * Maple connection's key, one `run_sql` per UTC day and its first page only (the pull's paging is
 * not needed to show the shape), with the pull's own statements; a formula evaluates over stored
 * values and the built-ins. What it cannot run is the
 * result's `error` (Hazel's own words), never a failure of the call.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	checkMapleSql,
	type Day,
	evaluateFormula,
	type MetricAggregation,
	type MetricPreviewResult,
	type MetricSource,
	parseFormula,
} from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { HttpClient } from "effect/http"
import { loadCredentials } from "./credentials"
import { regionOfAccountId } from "./maple/adapter"
import { makeMapleApi } from "./maple/http"
import type { MapleApi } from "./maple/http"
import { countOf, queryRowOf, UNREADABLE_QUERY_ROWS } from "./maple/map"
import { metricsSql, querySql, windowOf } from "./maple/pull"
import { MapleMetricRow, MapleQueryRow } from "./maple/wire"
import { DERIVED_METRICS } from "./facts"
import { aggregate, type Definitions, metricSourceProblem } from "./metric-values"
import { CustomerProviderError } from "./providers"
import { inList } from "./sql"
import { dayOf, dayRange } from "./time"

const TOP = 5

const STEP = "metric preview"

/** One day's rows of a source, as `account` (a Clerk organization id) and its value. */
type DayRows = (
	api: MapleApi,
	day: Day,
) => Effect.Effect<ReadonlyArray<{ readonly account: string; readonly value: number }>, CustomerProviderError>

/** A Maple query's first page of a day, as the pull runs it; not one row readable is its error. */
const queryRows =
	(sql: string): DayRows =>
	(api, day) =>
		Effect.flatMap(
			api.runSql({ step: STEP, sql: querySql(sql, 0), window: windowOf(day), row: MapleQueryRow }),
			(result) => {
				const rows = result.rows.flatMap((row) => {
					const read = queryRowOf(row)
					return read === null ? [] : [read]
				})
				return result.rows.length > 0 && rows.length === 0
					? Effect.fail(
							new CustomerProviderError({
								code: "provider",
								message: UNREADABLE_QUERY_ROWS,
								httpStatus: null,
								retryAfterMs: null,
							}),
						)
					: Effect.succeed(rows)
			},
		)

/** A day's counts of the events, as the pull's metric phase reads them (under one key). */
const eventRows = (events: ReadonlyArray<string>): DayRows => {
	const map = new Map(events.map((event) => [event.trim(), "preview"]))
	return (api, day) =>
		Effect.map(
			api.runSql({ step: STEP, sql: metricsSql(map, 0), window: windowOf(day), row: MapleMetricRow }),
			(result) =>
				result.rows.flatMap((row) => {
					const value = countOf(row.events)
					return row.account.trim() === "" || value === null
						? []
						: [{ account: row.account, value }]
				}),
		)
}

/** Daily values per Hazel account, plus the rows that named no customer. */
interface Daily {
	readonly values: ReadonlyMap<CustomerAccountId, ReadonlyMap<Day, number>>
	readonly unmatchedRows: number
}

/** Maple's rows for each day, through the connection's key; `string`: why they cannot be read. */
const mapleDaily = (rowsOf: DayRows, days: ReadonlyArray<Day>, client: HttpClient.HttpClient) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const connection = yield* db.first(
			SQLite.from(schema.customerConnectionsTable)
				.select()
				.where(($) => [$.provider.eq("maple"), $.status.eq("active")])
				.limit(1),
		)
		if (Option.isNone(connection) || connection.value.config._tag !== "maple")
			return "Connect Maple to preview this metric"
		const region = regionOfAccountId(connection.value.externalAccountId)
		const credentials = yield* loadCredentials(connection.value)
		if (region === null || Option.isNone(credentials)) return "The Maple connection needs reconnecting"
		const api = makeMapleApi(client, credentials.value.apiKey, region)
		const rows: Array<{ readonly day: Day; readonly account: string; readonly value: number }> = []
		for (const day of days) {
			for (const row of yield* rowsOf(api, day)) rows.push({ day, ...row })
		}
		// Maple names a customer by its Clerk organization id, which its Maple ref shares.
		const ids = [...new Set(rows.map((row) => row.account))]
		const refs = yield* db.run(
			SQLite.from(schema.customerExternalRefsTable)
				.select("externalId", "accountId")
				.where(($) => [
					$.entityType.eq("account"),
					$.provider.in_("clerk", "maple"),
					$.staleAt.isNull(),
					inList($.externalId, ids),
				]),
		)
		const accountOf = new Map(refs.map((ref) => [ref.externalId, ref.accountId]))
		const values = new Map<CustomerAccountId, Map<Day, number>>()
		let unmatchedRows = 0
		for (const row of rows) {
			const accountId = accountOf.get(row.account)
			if (accountId === undefined) {
				unmatchedRows += 1
				continue
			}
			const own = values.get(accountId) ?? new Map<Day, number>()
			own.set(row.day, row.value)
			values.set(accountId, own)
		}
		return { values, unmatchedRows } satisfies Daily
	}).pipe(
		Effect.catchTags({
			CustomerProviderError: (error) =>
				Effect.succeed(
					error.code === "provider" &&
						error.httpStatus === null &&
						error.message !== UNREADABLE_QUERY_ROWS
						? "Maple could not run this query; check that it keeps the contract above"
						: error.message,
				),
			IntegrationEncryptionError: () => Effect.succeed("The Maple connection needs reconnecting"),
			KeyVersionNotFoundError: () => Effect.succeed("The Maple connection needs reconnecting"),
		}),
	)

const ACTIVE = Database.sql`("eventCount" > 0 OR "sessionCount" > 0 OR "signedIn" = 1)`

/**
 * Every account's daily values of `keys` from `from` on: stored metrics as stored, and the
 * built-ins as reads derive them (daily active users per day, scored health per day; MRR and 30-day
 * active users at their current level, which is what a short preview shows of them).
 */
const operandDays = (
	keys: ReadonlyArray<string>,
	accounts: ReadonlyArray<Pick<schema.CustomerAccount, "id" | "mrrMinor" | "activeUsers30d">>,
	days: ReadonlyArray<Day>,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const from = days[0] ?? ""
		const operands = new Map<CustomerAccountId, Map<string, Map<Day, number>>>()
		const set = (accountId: CustomerAccountId, key: string, day: Day, value: number) => {
			const own = operands.get(accountId) ?? new Map<string, Map<Day, number>>()
			const points = own.get(key) ?? new Map<Day, number>()
			points.set(day, value)
			own.set(key, points)
			operands.set(accountId, own)
		}
		const stored = keys.filter((key) => !DERIVED_METRICS.has(key))
		if (stored.length > 0) {
			const rows = yield* db.run(
				SQLite.from(schema.customerMetricDailyTable)
					.select("accountId", "metricKey", "day", "value")
					.where(($) => [inList($.metricKey, stored), $.day.gte(from)]),
			)
			for (const row of rows) set(row.accountId, row.metricKey, row.day, row.value)
		}
		if (keys.includes("active_users")) {
			const rows = (yield* db.query(
				Database.sql`SELECT "accountId", "day", count(*) AS "users" FROM "customer_activity_daily"
					WHERE "day" >= ${from} AND ${ACTIVE} GROUP BY "accountId", "day"`,
			)) as ReadonlyArray<{ accountId: CustomerAccountId; day: Day; users: number }>
			for (const row of rows) set(row.accountId, "active_users", row.day, Number(row.users))
		}
		if (keys.includes("health_score")) {
			const rows = yield* db.run(
				SQLite.from(schema.customerHealthDailyTable)
					.select("accountId", "day", "score")
					.where(($) => [$.day.gte(from)]),
			)
			for (const row of rows)
				if (row.score !== null) set(row.accountId, "health_score", row.day, row.score)
		}
		for (const account of accounts) {
			for (const day of days) {
				if (keys.includes("mrr")) set(account.id, "mrr", day, account.mrrMinor)
				if (keys.includes("active_users_30d"))
					set(account.id, "active_users_30d", day, account.activeUsers30d)
			}
		}
		return operands
	})

export const previewMetric = Effect.fn("Customers.previewMetric")(function* (
	input: {
		readonly source: MetricSource
		readonly aggregation: MetricAggregation
		readonly days: number
	},
	definitions: Definitions,
	client: HttpClient.HttpClient,
	now: Date,
) {
	const db = yield* Database.Database
	const days = dayRange(dayOf(now), input.days)
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "name", "mrrMinor", "activeUsers30d")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const names = new Map(accounts.map((account) => [account.id, account.name]))
	const result = (daily: Daily | string, valueOf: (accountId: CustomerAccountId) => number | null) => {
		if (typeof daily === "string")
			return {
				error: daily,
				days: input.days,
				accountsWithData: 0,
				totalAccounts: accounts.length,
				unmatchedRows: 0,
				top: [],
				sample: null,
			} satisfies MetricPreviewResult
		const top = [...daily.values.keys()]
			.flatMap((accountId) => {
				const value = valueOf(accountId)
				const name = names.get(accountId)
				return value === null || name === undefined ? [] : [{ accountId, name, value }]
			})
			.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
			.slice(0, TOP)
		const sample = top[0]
		return {
			error: null,
			days: input.days,
			accountsWithData: [...daily.values.keys()].filter((accountId) => names.has(accountId)).length,
			totalAccounts: accounts.length,
			unmatchedRows: daily.unmatchedRows,
			top,
			sample:
				sample === undefined
					? null
					: {
							accountId: sample.accountId,
							name: sample.name,
							points: days.map((day) => ({
								day,
								value: daily.values.get(sample.accountId)?.get(day) ?? 0,
							})),
						},
		} satisfies MetricPreviewResult
	}
	const source = input.source
	if (source._tag !== "formula") {
		const problem =
			source._tag === "maple_query"
				? checkMapleSql(source.sql)
				: metricSourceProblem("", source, definitions)
		const daily =
			problem ??
			(yield* mapleDaily(
				source._tag === "maple_query" ? queryRows(source.sql) : eventRows(source.events),
				days,
				client,
			))
		return result(daily, (accountId) =>
			typeof daily === "string"
				? null
				: aggregate(
						days.flatMap((day) => {
							const value = daily.values.get(accountId)?.get(day)
							return value === undefined ? [] : [value]
						}),
						input.aggregation,
					),
		)
	}
	// A formula: each operand over the days by its own aggregation, then the formula; the sample
	// applies it day by day.
	const problem = metricSourceProblem("", source, definitions)
	const parsed = parseFormula(source.expression)
	if (problem !== null || !parsed.ok) return result(problem ?? "The formula cannot be read", () => null)
	const operands = yield* operandDays(parsed.keys, accounts, days)
	const valueOn = (accountId: CustomerAccountId, day: Day) =>
		evaluateFormula(parsed.node, (key) => operands.get(accountId)?.get(key)?.get(day) ?? null)
	const values = new Map<CustomerAccountId, Map<Day, number>>()
	for (const accountId of operands.keys()) {
		const own = new Map<Day, number>()
		for (const day of days) {
			const value = valueOn(accountId, day)
			if (value !== null) own.set(day, value)
		}
		if (own.size > 0) values.set(accountId, own)
	}
	return result({ values, unmatchedRows: 0 }, (accountId) =>
		evaluateFormula(parsed.node, (key) =>
			aggregate(
				days.flatMap((day) => {
					const value = operands.get(accountId)?.get(key)?.get(day)
					return value === undefined ? [] : [value]
				}),
				definitions.get(key)?.aggregation ?? "sum",
			),
		),
	)
})
