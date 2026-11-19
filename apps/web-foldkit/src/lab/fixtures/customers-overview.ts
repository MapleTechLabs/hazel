import * as Customers from "@hazel/domain/customers"
import { CustomerOverviewLayoutId } from "@hazel/schema"
import { Schema } from "effect"
import type { ChartRange } from "../../customers/overview/data"
import type { LayoutRow, MetricDef } from "../../customers/overview/rows"
import { STARTERS } from "../../customers/overview/starters"
import { ACCOUNTS_BY_KEY, JONAS, MAYA, NOW, dayOf } from "./customers"

/**
 * Overview layouts and metrics (`docs/customers/overview-layouts.md`): the org's metric definitions,
 * four layouts (Observability, Trial onboarding, Self-serve, the default) and the metric windows and
 * series a customer's widgets read. `WITHOUT_LOGS` names accounts that sent no logs (a stat hidden for
 * them).
 */

const DAY = 86_400_000
const uuid = (n: number) => `00000041-0000-4000-8000-${String(n).padStart(12, "0")}`

const metric = (
	key: string,
	name: string,
	format: Customers.MetricFormat,
	group: string | null,
	unit: string | null = null,
	builtIn = false,
): MetricDef => ({ key, name, unit, format, group, provider: builtIn ? null : "maple", builtIn })

export const METRIC_DEFS: ReadonlyArray<MetricDef> = [
	metric("active_users", "Active users", "number", null, null, true),
	metric("active_users_30d", "Active users (30d)", "number", null, null, true),
	metric("mrr", "MRR", "money", null, "minor", true),
	metric("health_score", "Health score", "number", null, null, true),
	metric("spans_ingested", "Spans ingested", "number", "Ingest", "spans"),
	metric("logs_ingested_bytes", "Logs ingested", "bytes", "Ingest"),
	metric("metric_points_ingested", "Metric points", "number", "Ingest", "points"),
	metric("traces_ingested_bytes", "Traces ingested", "bytes", "Ingest"),
	metric("ingest_bytes", "Data ingested", "bytes", "Ingest"),
	metric("browser_sessions", "Browser sessions", "number", "Feature usage", "sessions"),
	metric("mcp_tool_calls", "MCP tool calls", "number", "Feature usage", "calls"),
	metric("dashboards_created", "Dashboards created", "number", "Feature usage"),
	metric("api_keys_created", "API keys created", "number", "Feature usage", "keys"),
	metric("alert_incidents_acknowledged", "Alerts acknowledged", "number", "Feature usage"),
	metric("investigations_started", "Investigations", "number", "Feature usage"),
	metric("error_issues_triaged", "Error issues triaged", "number", "Feature usage"),
]

const layoutId = (n: number) => Schema.decodeSync(CustomerOverviewLayoutId)(uuid(n))

const starter = (key: string) => STARTERS.find((each) => each.key === key)?.widgets ?? []

/** Observability, with a hand-picked table naming one metric the org never set up. */
const OBSERVABILITY_WIDGETS: ReadonlyArray<Customers.OverviewWidget> = [
	...starter("observability").filter((widget) => widget._tag !== "metric_table"),
	{
		_tag: "metric_table",
		id: "features",
		span: 4,
		title: "Feature adoption",
		rows: {
			_tag: "metrics",
			metricKeys: [
				"browser_sessions",
				"mcp_tool_calls",
				"dashboards_created",
				"api_keys_created",
				"error_issues_triaged",
				"status_pages_created",
			],
		},
		windowDays: 30,
		usedAtLeast: 1,
		unused: "show",
		order: "value",
		columns: { trend: true, lastUsed: true },
		exclude: [],
	},
]

const layout = (
	n: number,
	name: string,
	fields: Partial<Omit<LayoutRow, "id" | "name">> & Pick<LayoutRow, "widgets">,
): LayoutRow => ({
	id: layoutId(n),
	name,
	position: n,
	isDefault: false,
	rule: Customers.EMPTY_LAYOUT_RULE,
	accountCount: 0,
	updatedBy: MAYA.id,
	updatedAtMs: NOW.getTime() - n * 3 * DAY,
	...fields,
})

export const OBSERVABILITY = layout(1, "Observability", {
	widgets: OBSERVABILITY_WIDGETS,
	rule: { match: "all", conditions: [{ _tag: "plan", planNames: ["Scale", "Enterprise"] }] },
	accountCount: 31,
})
export const TRIAL_ONBOARDING = layout(2, "Trial onboarding", {
	widgets: starter("trial_onboarding"),
	rule: { match: "all", conditions: [{ _tag: "stage", stages: ["trialing"] }] },
	accountCount: 42,
	updatedBy: JONAS.id,
})
export const SELF_SERVE = layout(3, "Self-serve", {
	widgets: starter("seats_revenue"),
	rule: {
		match: "all",
		conditions: [
			{ _tag: "plan", planNames: ["Starter", "Growth"] },
			{ _tag: "metric", metricKey: "spans_ingested", windowDays: 30, op: "lt", value: 5_000_000 },
		],
	},
	accountCount: 124,
})
export const DEFAULT_LAYOUT = layout(4, "Default", {
	widgets: Customers.DEFAULT_LAYOUT_WIDGETS,
	isDefault: true,
	position: 1_000,
	accountCount: 17,
	updatedBy: null,
})

export const LAYOUTS: ReadonlyArray<LayoutRow> = [OBSERVABILITY, TRIAL_ONBOARDING, SELF_SERVE, DEFAULT_LAYOUT]

// WHAT THE WIDGETS READ

/** A stable number per key and account, so every load shows the same customer. */
const seed = (text: string): number => {
	let hash = 2166136261
	for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
	return (hash >>> 0) / 4294967296
}

const DAILY = new Map<string, number>([
	["active_users", 9],
	["mrr", 215_000],
	["health_score", 54],
	["spans_ingested", 6_100_000],
	["logs_ingested_bytes", 1_290_000_000],
	["metric_points_ingested", 77_000_000],
	["traces_ingested_bytes", 2_100_000_000],
	["ingest_bytes", 3_400_000_000],
	["browser_sessions", 410],
	["mcp_tool_calls", 64],
	["dashboards_created", 0.6],
	["api_keys_created", 0.2],
	["alert_incidents_acknowledged", 0.5],
])

/** Gauges read their last value over a window; the rest sum. */
const GAUGES = new Set(["mrr", "health_score", "active_users_30d"])

/** No logs at all from Acme (US) and Kestrel: their "Logs ingested" stat hides. */
export const WITHOUT_LOGS: ReadonlySet<string> = new Set([
	ACCOUNTS_BY_KEY.acme.id,
	ACCOUNTS_BY_KEY.kestrel.id,
])

const dayValue = (key: string, accountId: string, day: number): number => {
	if (key === "logs_ingested_bytes" && WITHOUT_LOGS.has(accountId)) return 0
	const base = DAILY.get(key) ?? 0
	const wobble = 0.75 + 0.5 * seed(`${key}:${accountId}:${day}`)
	return GAUGES.has(key) ? base : base * wobble
}

export const metricWindowsFor = (
	accountId: string,
	asks: ReadonlyArray<Readonly<{ metricKey: string; days: number }>>,
): ReadonlyArray<Customers.MetricWindow> =>
	asks.map(({ metricKey, days }) => {
		const known = metricKey === "active_users_30d" || DAILY.has(metricKey)
		const over = (from: number) => {
			if (metricKey === "active_users_30d") return 14
			const values = Array.from({ length: days }, (_, index) =>
				dayValue(metricKey, accountId, from + index),
			)
			const total = GAUGES.has(metricKey)
				? (values[0] ?? 0)
				: values.reduce((sum, value) => sum + value, 0)
			return total === 0 ? null : Math.round(total)
		}
		const value = known ? over(0) : null
		return {
			metricKey,
			days,
			value,
			previous: known ? over(days) : null,
			lastSeenDay: value === null ? null : dayOf(Math.floor(seed(`${metricKey}:${accountId}`) * 4)),
		}
	})

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90 } as const satisfies Record<ChartRange, number>

export const seriesFor = (
	accountId: string,
	metricKeys: ReadonlyArray<string>,
	range: ChartRange,
): ReadonlyArray<Customers.MetricSeries> =>
	metricKeys
		.filter((key) => DAILY.has(key))
		.map((key) => ({
			metricKey: key,
			name: METRIC_DEFS.find((each) => each.key === key)?.name ?? key,
			unit: null,
			limit: null,
			points: Array.from({ length: RANGE_DAYS[range] }, (_, index) => {
				const day = RANGE_DAYS[range] - 1 - index
				return { day: dayOf(day), value: Math.round(dayValue(key, accountId, day)) }
			}),
		}))
