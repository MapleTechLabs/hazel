import * as Customers from "@hazel/domain/customers"

/**
 * Starting points for a new layout (the "New layout" dialog) and the editor's blocks: small groups of
 * widgets added at once. Metric keys are `SUGGESTED_METRICS`' (`../suggested-metrics.ts`) and the
 * built-ins; a widget naming one the org lacks shows "Metric not set up" with a link to create it.
 */

type Widget = Customers.OverviewWidget

const stat = (
	id: string,
	metricKey: string,
	label: string | null,
	options: Partial<Pick<Customers.StatWidget, "windowDays" | "compare" | "hideWhenEmpty" | "span">> = {},
): Widget => ({
	_tag: "stat",
	id,
	span: options.span ?? 1,
	metricKey,
	label,
	windowDays: options.windowDays ?? 30,
	compare: options.compare ?? "previous",
	goodDirection: "up",
	hideWhenEmpty: options.hideWhenEmpty ?? false,
})

const chart = (
	id: string,
	title: string,
	metricKeys: ReadonlyArray<string>,
	style: Customers.ChartWidget["style"],
	span: Customers.WidgetSpan = 4,
): Widget => ({ _tag: "chart", id, span, title, metricKeys, style, range: "30d" })

const table = (
	id: string,
	title: string,
	rows: Customers.MetricTableRows,
	order: Customers.MetricTableWidget["order"] = "value",
): Widget => ({
	_tag: "metric_table",
	id,
	span: 4,
	title,
	rows,
	windowDays: 30,
	usedAtLeast: 1,
	unused: "show",
	order,
	columns: { trend: true, lastUsed: true },
	exclude: [],
})

const builtIn = (id: string, kind: Customers.BuiltInWidgetKind, span: Customers.WidgetSpan): Widget => ({
	_tag: "built_in",
	id,
	span,
	kind,
})

const FEATURE_USAGE = table("feature-adoption", "Feature adoption", { _tag: "group", group: "Feature usage" })

export interface Starter {
	readonly key: string
	readonly name: string
	readonly description: string
	readonly widgets: ReadonlyArray<Widget>
}

export const STARTERS: ReadonlyArray<Starter> = [
	{
		key: "observability",
		name: "Observability",
		description: "Ingest stats, ingest volume by signal, feature adoption, health and signals.",
		widgets: [
			stat("spans", "spans_ingested", null),
			stat("logs", "logs_ingested_bytes", null, { hideWhenEmpty: true }),
			stat("metric-points", "metric_points_ingested", null),
			builtIn("last-active", "last_active", 1),
			chart(
				"ingest-volume",
				"Ingest volume",
				["traces_ingested_bytes", "logs_ingested_bytes"],
				"stacked",
			),
			FEATURE_USAGE,
			builtIn("health", "health", 2),
			builtIn("signals", "signals", 2),
		],
	},
	{
		key: "trial_onboarding",
		name: "Trial onboarding",
		description: "First data received, API keys, integrations and the onboarding steps taken.",
		widgets: [
			stat("data", "ingest_bytes", "Data ingested · {window}", { windowDays: 7, compare: "none" }),
			stat("api-keys", "api_keys_created", null, { compare: "none" }),
			stat("integrations", "integrations_connected", null, { compare: "none" }),
			builtIn("last-active", "last_active", 1),
			table(
				"onboarding",
				"Onboarding steps",
				{
					_tag: "metrics",
					metricKeys: [
						"api_keys_created",
						"integrations_connected",
						"dashboards_created",
						"mcp_tool_calls",
					],
				},
				"last_used",
			),
			builtIn("activity", "activity", 4),
		],
	},
	{
		key: "feature_adoption",
		name: "Feature adoption",
		description: "One table of every feature metric with its change and last used day.",
		widgets: [
			FEATURE_USAGE,
			chart("feature-usage", "Feature usage", ["mcp_tool_calls", "dashboards_created"], "bars"),
			builtIn("activity", "activity", 4),
		],
	},
	{
		key: "seats_revenue",
		name: "Seats and revenue",
		description: "MRR, active users and the subscription, for seat-based plans.",
		widgets: [
			stat("mrr", "mrr", "MRR"),
			stat("active-users", "active_users_30d", "Active users", { compare: "none" }),
			builtIn("last-active", "last_active", 2),
			chart("usage", "Daily active users", ["active_users"], "bars", 2),
			builtIn("subscription", "subscription", 2),
		],
	},
]

export const starterOf = (key: string): Starter | undefined => STARTERS.find((starter) => starter.key === key)

/** The metrics a starter names that are not Hazel's built-ins. */
export const starterMetricCount = (starter: Starter): number =>
	[
		...new Set(
			starter.widgets.flatMap((widget) =>
				widget._tag === "stat"
					? [widget.metricKey]
					: widget._tag === "chart"
						? widget.metricKeys
						: widget._tag === "metric_table" && widget.rows._tag === "metrics"
							? widget.rows.metricKeys
							: [],
			),
		),
	].filter((key) => !Customers.isBuiltInMetric(key)).length

/** A block: widgets the editor's library adds together. */
export interface Block {
	readonly key: string
	readonly name: string
	readonly description: string
	readonly widgets: ReadonlyArray<Widget>
}

export const BLOCKS: ReadonlyArray<Block> = [
	{
		key: "ingest",
		name: "Ingest overview",
		description: "Ingest stats, last active and ingest volume by signal",
		widgets: [
			stat("spans", "spans_ingested", null),
			stat("logs", "logs_ingested_bytes", null, { hideWhenEmpty: true }),
			stat("metric-points", "metric_points_ingested", null),
			builtIn("last-active", "last_active", 1),
			chart(
				"ingest-volume",
				"Ingest volume",
				["traces_ingested_bytes", "logs_ingested_bytes"],
				"stacked",
			),
		],
	},
	{
		key: "feature_adoption",
		name: "Feature adoption",
		description: "Table of every Feature usage metric",
		widgets: [FEATURE_USAGE],
	},
	{
		key: "context",
		name: "Customer context",
		description: "Health, open signals, notes, activity",
		widgets: [
			builtIn("health", "health", 2),
			builtIn("signals", "signals", 2),
			builtIn("notes", "notes", 2),
			builtIn("activity", "activity", 2),
		],
	},
]

/** New widgets of each kind, as the library adds them. */
export const newWidget = (kind: "stat" | "chart" | "metric_table", id: string): Widget =>
	kind === "stat"
		? stat(id, "active_users_30d", null, { compare: "none" })
		: kind === "chart"
			? chart(id, "", ["active_users"], "bars")
			: table(id, "", { _tag: "group", group: "Feature usage" })

export const newBuiltIn = (kind: Customers.BuiltInWidgetKind, id: string): Widget =>
	builtIn(id, kind, kind === "last_active" ? 1 : kind === "activity" || kind === "support" ? 4 : 2)

/** `stat-3`: the first id of that prefix the layout does not use. */
export const freshId = (taken: ReadonlySet<string>, prefix: string): string => {
	let n = 1
	while (taken.has(`${prefix}-${n}`)) n++
	return `${prefix}-${n}`
}

/** The widgets with ids none of `existing` use (a block added twice, a copy). */
export const withFreshIds = (
	widgets: ReadonlyArray<Widget>,
	existing: ReadonlyArray<Widget>,
): ReadonlyArray<Widget> => {
	const taken = new Set(existing.map((widget) => widget.id))
	return widgets.map((widget) => {
		const id = taken.has(widget.id) ? freshId(taken, widget.id.replace(/-\d+$/, "")) : widget.id
		taken.add(id)
		return { ...widget, id }
	})
}
