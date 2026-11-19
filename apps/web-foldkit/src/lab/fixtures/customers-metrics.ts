import {
	BUILT_IN_METRICS,
	DEFAULT_LAYOUT_WIDGETS,
	EMPTY_LAYOUT_RULE,
	type MetricPreviewResult,
	type MetricSource,
	mapleBuilderSql,
} from "@hazel/domain/customers"
import { CustomerMetricDefinitionId, CustomerOverviewLayoutId } from "@hazel/schema"
import { Schema } from "effect"
import type { LayoutRow } from "../../customers/overview/rows"
import type { CoverageRow, MetricRow } from "../../page/customers/settings/metrics/model"
import { SUGGESTED_METRICS } from "../../customers/suggested-metrics"
import { ACCOUNTS, ACCOUNTS_BY_KEY, dayOf, NOW } from "./customers"

/**
 * The metrics settings lab's data: a catalog with every kind of metric (Maple queries, product
 * events, a formula, a source's own, built-ins), two layouts naming some of them, the coverage
 * read, and a `customers.metric.preview` answer for any source.
 */

const HOUR = 3_600_000

const metricId = (n: number) =>
	Schema.decodeSync(CustomerMetricDefinitionId)(`00000031-0000-4000-8000-${String(n).padStart(12, "0")}`)
const layoutId = (n: number) =>
	Schema.decodeSync(CustomerOverviewLayoutId)(`00000032-0000-4000-8000-${String(n).padStart(12, "0")}`)

const base = {
	description: null,
	unit: null,
	provider: null,
	builtIn: false,
	group: null,
	format: "number",
	aggregation: "sum",
	source: null,
	lastRunAtMs: null,
	lastError: null,
} as const satisfies Omit<MetricRow, "id" | "key" | "name">

/** A suggested metric, saved: its draft as the store keeps it. */
const saved = (n: number, key: string, lastRunAgoMs: number | null): MetricRow => {
	const suggested = SUGGESTED_METRICS.find((metric) => metric.key === key)
	if (suggested === undefined) throw new Error(`No suggested metric ${key}`)
	const { draft } = suggested
	return {
		...base,
		id: metricId(n),
		key,
		name: draft.name,
		description: draft.description,
		unit: draft.unit,
		group: draft.group,
		format: draft.format,
		aggregation: draft.aggregation,
		source: draft.source,
		lastRunAtMs:
			draft.source?._tag === "maple_query" && lastRunAgoMs !== null
				? NOW.getTime() - lastRunAgoMs
				: null,
	}
}

const SQL_ONLY: MetricSource = {
	_tag: "maple_query",
	sql: [
		"SELECT Attributes['org_id'] AS account, uniqExact(ServiceName) AS value",
		"FROM traces",
		"WHERE $__orgFilter",
		"  AND $__timeFilter(Timestamp)",
		"  AND Attributes['org_id'] != ''",
		"GROUP BY account",
	].join("\n"),
	builder: null,
}

export const METRICS: ReadonlyArray<MetricRow> = [
	saved(1, "spans_ingested", 14 * 60_000),
	saved(2, "logs_ingested_bytes", 14 * 60_000),
	saved(3, "traces_ingested_bytes", 14 * 60_000),
	{
		...base,
		id: metricId(4),
		key: "services_reporting",
		name: "Services reporting",
		group: "Ingest",
		aggregation: "max",
		source: SQL_ONLY,
		lastRunAtMs: NOW.getTime() - 14 * 60_000,
	},
	saved(5, "bytes_per_span", null),
	saved(6, "mcp_tool_calls", null),
	saved(7, "dashboards_created", null),
	{
		...base,
		id: metricId(8),
		key: "autumn.api_calls",
		name: "API calls",
		description: "Metered by Autumn",
		unit: "calls",
		provider: "autumn",
	},
	// The built-ins as the store seeds them: MRR reads as money (minor units), the rest as numbers.
	...BUILT_IN_METRICS.map((metric, index): MetricRow => ({
		...base,
		id: metricId(9 + index),
		key: metric.key,
		name: metric.name,
		unit: metric.unit,
		builtIn: true,
		format: metric.format,
		aggregation: metric.aggregation,
	})),
]

/** The same catalog with the services query's last run failed. */
export const METRICS_WITH_FAILURE: ReadonlyArray<MetricRow> = METRICS.map((metric) =>
	metric.key === "services_reporting"
		? {
				...metric,
				lastRunAtMs: NOW.getTime() - 3 * HOUR,
				lastError: "Maple refused the query: unknown column ServiceName in traces. Check the SQL.",
			}
		: metric,
)

/** Only what an org has before it defines any: a source's own and the built-ins. */
export const METRICS_EMPTY: ReadonlyArray<MetricRow> = METRICS.filter((metric) => metric.source === null)

const layout = {
	rule: EMPTY_LAYOUT_RULE,
	accountCount: 0,
	updatedBy: null,
	updatedAtMs: NOW.getTime() - 24 * HOUR,
} as const

export const LAYOUTS: ReadonlyArray<LayoutRow> = [
	{
		...layout,
		id: layoutId(1),
		name: "Observability",
		position: 0,
		isDefault: false,
		accountCount: 96,
		widgets: [
			{
				_tag: "stat",
				id: "spans",
				span: 1,
				metricKey: "spans_ingested",
				label: null,
				windowDays: 30,
				compare: "previous",
				goodDirection: "up",
				hideWhenEmpty: false,
			},
			{
				_tag: "chart",
				id: "ingest",
				span: 3,
				title: "Data ingested",
				metricKeys: ["logs_ingested_bytes", "traces_ingested_bytes"],
				style: "stacked",
				range: "30d",
			},
			{
				_tag: "metric_table",
				id: "features",
				span: 4,
				title: "Feature usage",
				rows: { _tag: "group", group: "Feature usage" },
				windowDays: 30,
				usedAtLeast: 1,
				unused: "show",
				order: "value",
				columns: { trend: true, lastUsed: true },
				exclude: [],
			},
		],
	},
	{
		...layout,
		id: layoutId(2),
		name: "Default",
		position: 1,
		isDefault: true,
		accountCount: 118,
		widgets: DEFAULT_LAYOUT_WIDGETS,
	},
]

export const COVERAGE: ReadonlyArray<CoverageRow> = METRICS.flatMap((metric, index) =>
	metric.source?._tag === "formula"
		? []
		: [{ metricKey: metric.key, accountsWithData: 380 - index * 37, lastDay: dayOf(1) }],
)

/** What `customers.metric.preview` answers for `source` over the lab's accounts. */
export const previewOf = (source: MetricSource, days: number): MetricPreviewResult => {
	const sample = ACCOUNTS_BY_KEY.acme
	const accounts = [sample, ...ACCOUNTS.filter((account) => account.id !== sample.id).slice(0, 4)]
	const scale = source._tag === "maple_query" ? 4.2e9 : source._tag === "product_event" ? 40 : 1800
	return {
		error: null,
		days,
		accountsWithData: 168,
		totalAccounts: ACCOUNTS.length,
		unmatchedRows: source._tag === "maple_query" ? 9 : 0,
		top: accounts.map((account, index) => ({
			accountId: account.id,
			name: account.name,
			value: Math.round(scale * days * (1 - index * 0.17)),
		})),
		sample: {
			accountId: sample.id,
			name: sample.name,
			points: Array.from({ length: days }, (_, index) => ({
				day: dayOf(days - index),
				value: Math.round(scale * (0.8 + 0.4 * Math.sin(index * 1.3) ** 2)),
			})),
		},
	}
}

/** A preview whose query Maple refused. */
export const PREVIEW_REFUSED: MetricPreviewResult = {
	error: "Maple refused the query: unknown table metric_sum. Did you mean metrics_sum?",
	days: 7,
	accountsWithData: 0,
	totalAccounts: ACCOUNTS.length,
	unmatchedRows: 0,
	top: [],
	sample: null,
}

/** The builder SQL of the suggested logs metric, for the SQL-mode lab state's broken edit. */
export const LOGS_SQL = mapleBuilderSql({
	table: "metrics_sum",
	filters: [{ field: "MetricName", op: "eq", value: "maple_ingest_org_bytes_total" }],
	value: "sum",
	customerField: "Attributes.org_id",
})
