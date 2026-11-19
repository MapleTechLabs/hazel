import type * as Customers from "@hazel/domain/customers"
import { mapleBuilderSql } from "@hazel/domain/customers"

/**
 * Metrics the layout starters name, with a draft to create each from (`docs/customers/overview-layouts.md`).
 * A widget whose metric the org does not have links to `/settings/metrics/new?key=<key>`, and the
 * metric editor prefills from here when the key is one of these.
 */
export interface SuggestedMetric {
	readonly key: string
	readonly draft: Customers.MetricDraft
}

const ingest = (
	key: string,
	name: string,
	metricName: "maple_ingest_org_bytes_total" | "maple_ingest_org_items_total",
	signal: "traces" | "logs" | "metrics" | null,
	format: Customers.MetricFormat,
	unit: string | null,
): SuggestedMetric => {
	const builder: Customers.MapleQueryBuilder = {
		table: "metrics_sum",
		filters: [
			{ field: "MetricName", op: "eq", value: metricName },
			...(signal === null ? [] : [{ field: "Attributes.signal", op: "eq" as const, value: signal }]),
		],
		value: "sum",
		customerField: "Attributes.org_id",
	}
	return {
		key,
		draft: {
			name,
			description: null,
			group: "Ingest",
			unit,
			format,
			aggregation: "sum",
			source: { _tag: "maple_query", sql: mapleBuilderSql(builder), builder },
		},
	}
}

const event = (key: string, name: string, events: ReadonlyArray<string>): SuggestedMetric => ({
	key,
	draft: {
		name,
		description: null,
		group: "Feature usage",
		unit: null,
		format: "number",
		aggregation: "sum",
		source: { _tag: "product_event", events },
	},
})

export const SUGGESTED_METRICS: ReadonlyArray<SuggestedMetric> = [
	ingest("spans_ingested", "Spans ingested", "maple_ingest_org_items_total", "traces", "number", "spans"),
	ingest("logs_ingested_bytes", "Logs ingested", "maple_ingest_org_bytes_total", "logs", "bytes", null),
	ingest("metric_points_ingested", "Metric points", "maple_ingest_org_items_total", "metrics", "number", "points"),
	ingest("traces_ingested_bytes", "Traces ingested", "maple_ingest_org_bytes_total", "traces", "bytes", null),
	ingest("ingest_bytes", "Data ingested", "maple_ingest_org_bytes_total", null, "bytes", null),
	event("mcp_tool_calls", "MCP tool calls", ["mcp_tool_called"]),
	event("api_keys_created", "API keys created", ["api_key_created"]),
	event("dashboards_created", "Dashboards created", ["dashboard_created"]),
	event("integrations_connected", "Integrations connected", ["integration_connected"]),
	event("alert_incidents_acknowledged", "Alerts acknowledged", ["alert_incident_acknowledged"]),
	event("investigations_started", "Investigations", ["investigation_started"]),
	{
		key: "bytes_per_span",
		draft: {
			name: "Bytes per span",
			description: "Trace bytes over spans ingested",
			group: "Ingest",
			unit: null,
			format: "bytes",
			aggregation: "sum",
			source: { _tag: "formula", expression: "{traces_ingested_bytes} / {spans_ingested}" },
		},
	},
]

export const suggestedMetricOf = (key: string): SuggestedMetric | undefined =>
	SUGGESTED_METRICS.find((metric) => metric.key === key)
