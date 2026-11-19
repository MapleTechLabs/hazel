/**
 * `customers.metric.preview`: a metric source tried over the last days without saving it
 * (`docs/customers/overview-layouts.md`). A Maple query or product event count runs through the
 * Maple connection's key, one `run_sql` per UTC day and its first page only (the pull's paging is
 * not needed to show the shape); a formula evaluates over stored values. What it cannot run is the
 * result's `error` (Hazel's own words), never a failure of the call.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
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
import { metricValueOf } from "./maple/map"
import { mapleQueryProblem } from "./maple/pull"
import { MapleQueryRow, RUN_SQL_ROW_CAP } from "./maple/wire"
import { aggregate, type Definitions, metricSourceProblem } from "./metric-values"
import { inList } from "./sql"
import { addDays, dayOf, dayRange } from "./time"

const TOP = 5

/** Each day's rows of a product event count: the pull's metric phase, by account alone. */
const productEventSql = (events: ReadonlyArray<string>) => `
SELECT GroupId AS account, count() AS value
FROM product_events
WHERE $__orgFilter
  AND Timestamp >= $__startTime AND Timestamp < $__endTime
  AND GroupId != ''
  AND EventName IN (${events.map((event) => `'${event.trim()}'`).join(", ")})
GROUP BY account`

/** Daily values per Hazel account, plus the rows that named no customer. */
interface Daily {
	readonly values: ReadonlyMap<CustomerAccountId, ReadonlyMap<Day, number>>
	readonly unmatchedRows: number
}

/** Maple's rows for each day, through the connection's key; `string`: why they cannot be read. */
const mapleDaily = (sql: string, days: ReadonlyArray<Day>, client: HttpClient.HttpClient) =>
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
			const result = yield* api.runSql({
				step: "metric preview",
				sql: `${sql.trim().replace(/;\s*$/, "")}\nORDER BY account\nLIMIT ${RUN_SQL_ROW_CAP}`,
				window: { start: `${day} 00:00:00`, end: `${addDays(day, 1)} 00:00:00` },
				row: MapleQueryRow,
			})
			for (const row of result.rows) {
				const value = metricValueOf(row.value)
				if (row.account.trim() !== "" && value !== null)
					rows.push({ day, account: row.account, value })
			}
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
					error.code === "provider"
						? "Maple could not run this query; check that it keeps the contract above"
						: error.message,
				),
			IntegrationEncryptionError: () => Effect.succeed("The Maple connection needs reconnecting"),
			KeyVersionNotFoundError: () => Effect.succeed("The Maple connection needs reconnecting"),
		}),
	)

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
			.select("id", "name")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const names = new Map(accounts.map((account) => [account.id, account.name]))
	const result = (daily: Daily | string, windowOf: (accountId: CustomerAccountId) => number | null) => {
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
				const value = windowOf(accountId)
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
				? mapleQueryProblem(source.sql)
				: metricSourceProblem("", source, definitions)
		const daily =
			problem ??
			(yield* mapleDaily(
				source._tag === "maple_query" ? source.sql : productEventSql(source.events),
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
	// A formula over stored values: each operand over the days by its own aggregation, then the
	// formula; the sample applies it day by day.
	const problem = metricSourceProblem("", source, definitions)
	const parsed = parseFormula(source.expression)
	if (problem !== null || !parsed.ok) return result(problem ?? "The formula cannot be read", () => null)
	const rows = yield* db.run(
		SQLite.from(schema.customerMetricDailyTable)
			.select("accountId", "metricKey", "day", "value")
			.where(($) => [
				inList($.metricKey, parsed.keys),
				$.day.gte(addDays(dayOf(now), -(input.days - 1))),
			]),
	)
	const operands = new Map<CustomerAccountId, Map<string, Map<Day, number>>>()
	for (const row of rows) {
		const own = operands.get(row.accountId) ?? new Map<string, Map<Day, number>>()
		const points = own.get(row.metricKey) ?? new Map<Day, number>()
		points.set(row.day, row.value)
		own.set(row.metricKey, points)
		operands.set(row.accountId, own)
	}
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
