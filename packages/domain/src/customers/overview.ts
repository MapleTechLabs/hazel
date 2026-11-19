/**
 * The customer page's Overview, made of data (`docs/customers/overview-layouts.md`):
 *
 * - **Metrics** are daily values per account (`customer_metric_daily`). Besides the ones sources
 *   write and Hazel's built-ins, an admin defines their own: a **Maple query** (one SQL statement
 *   that answers `account, value` for a day), a **product event** count, or a **formula** over
 *   other metrics. `MetricSource` is how each is made; `MetricFormat` how it reads.
 * - **Widgets** show metrics: a stat, a chart, a metric table, or one of the page's built-in
 *   sections. `OverviewWidget`.
 * - **Layouts** are ordered lists of widgets plus a rule saying which customers get them
 *   (`LayoutRule`). The first layout whose rule matches wins; the default layout is the fallback,
 *   and a customer can be pinned to one.
 */
import { CustomerAccountId, CustomerOverviewLayoutId } from "@hazel/schema"
import { Schema } from "effect"
import { HealthStatus, LifecycleStage } from "./enums"

const Text = (max: number) => Schema.String.check(Schema.isMaxLength(max))
const NonEmptyText = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/** A metric key a user creates: lower-case words joined by `_`, `.` or `-`. */
export const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/
export const UserMetricKey = Schema.String.check(
	Schema.isPattern(METRIC_KEY_PATTERN, {
		message: "Lower-case letters, digits, `_`, `.` and `-`, at most 80, starting with a letter",
	}),
)

/** How a metric's value reads: `1.2M`, `38.6 GB`, `42%`, `$1,200`, `1.4 s`. */
export const MetricFormat = Schema.Literals(["number", "bytes", "percent", "money", "duration_ms"])
export type MetricFormat = typeof MetricFormat.Type

/** The Maple warehouse tables the query builder offers. */
export const MapleQueryTable = Schema.Literals([
	"metrics_sum",
	"metrics_gauge",
	"traces",
	"logs",
	"product_events",
])
export type MapleQueryTable = typeof MapleQueryTable.Type

/** A builder filter: `<column or Attributes['key']> <op> '<value>'`. */
export const MapleQueryFilter = Schema.Struct({
	/** A column (`MetricName`, `ServiceName`, `EventName`) or `Attributes.<key>` / `ResourceAttributes.<key>`. */
	field: NonEmptyText(120),
	op: Schema.Literals(["eq", "neq", "in"]),
	/** For `in`, comma-separated. */
	value: Text(500),
})
export type MapleQueryFilter = typeof MapleQueryFilter.Type

/**
 * What the query builder was set to, kept so the editor reopens the builder rather than the SQL.
 * The SQL it generated (`mapleBuilderSql`) is what runs.
 */
export const MapleQueryBuilder = Schema.Struct({
	table: MapleQueryTable,
	filters: Schema.Array(MapleQueryFilter).check(Schema.isMaxLength(10)),
	/** `sum(Value)`, `count()`, or distinct values of a column. */
	value: Schema.Literals(["sum", "count", "uniq"]),
	/** The column `uniq` counts. */
	valueField: Schema.optionalKey(Text(120)),
	/** The column naming the customer (its Clerk organization id), e.g. `Attributes.org_id`. */
	customerField: NonEmptyText(120),
})
export type MapleQueryBuilder = typeof MapleQueryBuilder.Type

/**
 * One SQL statement over Maple's warehouse, run once per UTC day by the Maple pull. It must AND in
 * `$__orgFilter` and `$__timeFilter(<time column>)`, select `account` (the Clerk organization id)
 * and `value`, group by account, and carry no `ORDER BY`, `LIMIT` or `SETTINGS`: the pull appends
 * its own page clause (`checkMapleSql`).
 */
export const MapleQuerySource = Schema.TaggedStruct("maple_query", {
	sql: NonEmptyText(8000),
	builder: Schema.NullOr(MapleQueryBuilder),
})

/** How often these Maple product events fired per account and day. */
export const ProductEventSource = Schema.TaggedStruct("product_event", {
	events: Schema.Array(NonEmptyText(120)).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
})

/** Arithmetic over other metrics' values, e.g. `{maple.log_bytes} / {maple.spans}` (`parseFormula`). */
export const FormulaSource = Schema.TaggedStruct("formula", {
	expression: NonEmptyText(500),
})

export const MetricSource = Schema.Union([MapleQuerySource, ProductEventSource, FormulaSource])
export type MetricSource = typeof MetricSource.Type

/**
 * Why a Maple query metric's SQL cannot run as the pull runs it, or `null`. The pull appends
 * `ORDER BY account LIMIT … OFFSET …` to it, so it must be one plain SELECT (no subquery or UNION,
 * whose `$__orgFilter` Maple would not see as top-level, and no comment the clause could fall
 * into) ending in its `GROUP BY account` (a `HAVING` may follow).
 */
export const checkMapleSql = (sql: string): string | null => {
	// Clauses are looked for outside string literals.
	const code = sql
		.trim()
		.replace(/;\s*$/, "")
		.replace(/'(?:[^'\\]|\\.)*'/g, "''")
	if (!/^select\b/i.test(code)) return "Start with SELECT"
	if (code.includes(";")) return "One statement only"
	if (/--|\/\*|#/.test(code)) return "Leave out comments"
	if ((code.match(/\bselect\b/gi) ?? []).length > 1 || /\bunion\b/i.test(code))
		return "One SELECT only: no subqueries or UNION"
	if (!code.includes("$__orgFilter")) return "AND in $__orgFilter"
	if (!/\$__timeFilter\(|\$__startTime/.test(code)) return "Filter time with $__timeFilter(<column>)"
	if (!/\baccount\b/i.test(code) || !/\bvalue\b/i.test(code)) return "Select `account` and `value`"
	if (/\b(order\s+by|limit|settings)\b/i.test(code))
		return "Leave out ORDER BY, LIMIT and SETTINGS: Hazel pages the result itself"
	if (!/\bgroup\s+by\s+account\s*(\bhaving\b[\s\S]*)?$/i.test(code))
		return "End with GROUP BY account (a HAVING may follow)"
	return null
}

/** `Attributes.org_id` → `Attributes['org_id']`; a plain column as is. Names were validated. */
const columnOf = (field: string): string => {
	const dot = field.indexOf(".")
	if (dot === -1) return field
	return `${field.slice(0, dot)}['${field.slice(dot + 1).replace(/'/g, "")}']`
}

/** A builder field Hazel will put in SQL: a column, or a map column and a key. */
export const isBuilderField = (field: string): boolean =>
	/^[A-Za-z][A-Za-z0-9_]{0,60}(\.[A-Za-z0-9_.:/-]{1,100})?$/.test(field)

const TIME_COLUMN = {
	metrics_sum: "TimeUnix",
	metrics_gauge: "TimeUnix",
	traces: "Timestamp",
	logs: "Timestamp",
	product_events: "Timestamp",
} satisfies Record<MapleQueryTable, string>

const literal = (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`

/** The SQL a builder stands for (`MapleQuerySource.sql`). */
export const mapleBuilderSql = (builder: MapleQueryBuilder): string => {
	const value =
		builder.value === "sum"
			? "sum(Value)"
			: builder.value === "count"
				? "count()"
				: `uniqExact(${columnOf(builder.valueField ?? "TraceId")})`
	const filters = builder.filters.map((filter) => {
		const column = columnOf(filter.field)
		if (filter.op === "in") {
			const values = filter.value
				.split(",")
				.map((part) => part.trim())
				.filter((part) => part !== "")
			return `${column} IN (${values.map(literal).join(", ")})`
		}
		return `${column} ${filter.op === "eq" ? "=" : "!="} ${literal(filter.value)}`
	})
	const customer = columnOf(builder.customerField)
	return [
		`SELECT ${customer} AS account, ${value} AS value`,
		`FROM ${builder.table}`,
		`WHERE $__orgFilter`,
		`  AND $__timeFilter(${TIME_COLUMN[builder.table]})`,
		`  AND ${customer} != ''`,
		...filters.map((filter) => `  AND ${filter}`),
		`GROUP BY account`,
	].join("\n")
}

// ---------------------------------------------------------------------------
// Formulas
// ---------------------------------------------------------------------------

export type FormulaNode =
	| { readonly _tag: "number"; readonly value: number }
	| { readonly _tag: "metric"; readonly key: string }
	| {
			readonly _tag: "binary"
			readonly op: "+" | "-" | "*" | "/"
			readonly left: FormulaNode
			readonly right: FormulaNode
	  }
	| { readonly _tag: "negate"; readonly operand: FormulaNode }

export type FormulaParse =
	| { readonly ok: true; readonly node: FormulaNode; readonly keys: ReadonlyArray<string> }
	| { readonly ok: false; readonly error: string }

/**
 * `{metric.key}`, numbers, `+ - * /` and parentheses. Metric keys are braced so they may hold dots
 * and dashes.
 */
export const parseFormula = (expression: string): FormulaParse => {
	type Token =
		| { readonly kind: "number"; readonly value: number }
		| { readonly kind: "metric"; readonly key: string }
		| { readonly kind: "op"; readonly op: "+" | "-" | "*" | "/" | "(" | ")" }
	const tokens: Array<Token> = []
	let index = 0
	for (let char = expression.charAt(index); index < expression.length; char = expression.charAt(index)) {
		if (/\s/.test(char)) {
			index++
		} else if (char === "{") {
			const end = expression.indexOf("}", index)
			if (end === -1) return { ok: false, error: "A `{` is never closed" }
			const key = expression.slice(index + 1, end).trim()
			if (key === "") return { ok: false, error: "Empty metric `{}`" }
			tokens.push({ kind: "metric", key })
			index = end + 1
		} else if (/[0-9.]/.test(char)) {
			const match = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(expression.slice(index))
			if (match === null) return { ok: false, error: `Not a number at ${index + 1}` }
			tokens.push({ kind: "number", value: Number(match[0]) })
			index += match[0].length
		} else if ("+-*/()".includes(char)) {
			tokens.push({ kind: "op", op: char as "+" })
			index++
		} else {
			return { ok: false, error: `Unexpected \`${char}\`; wrap metric keys in braces: {key}` }
		}
	}
	let position = 0
	const keys = new Set<string>()
	const peek = () => tokens[position]
	const isOp = (token: Token | undefined, ...ops: ReadonlyArray<string>) =>
		token?.kind === "op" && ops.includes(token.op)
	// Recursive descent: expression = term (('+'|'-') term)*, term = unary (('*'|'/') unary)*.
	const parseExpression = (): FormulaNode | string => {
		let left = parseTerm()
		while (typeof left !== "string" && isOp(peek(), "+", "-")) {
			const op = (tokens[position++] as { op: "+" | "-" }).op
			const right = parseTerm()
			if (typeof right === "string") return right
			left = { _tag: "binary", op, left, right }
		}
		return left
	}
	const parseTerm = (): FormulaNode | string => {
		let left = parseUnary()
		while (typeof left !== "string" && isOp(peek(), "*", "/")) {
			const op = (tokens[position++] as { op: "*" | "/" }).op
			const right = parseUnary()
			if (typeof right === "string") return right
			left = { _tag: "binary", op, left, right }
		}
		return left
	}
	const parseUnary = (): FormulaNode | string => {
		const token = peek()
		if (token === undefined) return "The formula ends early"
		position++
		if (token.kind === "number") return { _tag: "number", value: token.value }
		if (token.kind === "metric") {
			keys.add(token.key)
			return { _tag: "metric", key: token.key }
		}
		if (token.op === "-") {
			const operand = parseUnary()
			return typeof operand === "string" ? operand : { _tag: "negate", operand }
		}
		if (token.op === "(") {
			const inner = parseExpression()
			if (typeof inner === "string") return inner
			if (!isOp(peek(), ")")) return "A `(` is never closed"
			position++
			return inner
		}
		return `Unexpected \`${token.op}\``
	}
	if (tokens.length === 0) return { ok: false, error: "Empty formula" }
	const node = parseExpression()
	if (typeof node === "string") return { ok: false, error: node }
	if (position < tokens.length) return { ok: false, error: "Unexpected text after the formula" }
	if (keys.size === 0) return { ok: false, error: "Use at least one metric, e.g. {maple.spans}" }
	return { ok: true, node, keys: [...keys] }
}

/** The formula's value; `null` when a metric has no value or it divides by zero. */
export const evaluateFormula = (
	node: FormulaNode,
	valueOf: (key: string) => number | null,
): number | null => {
	switch (node._tag) {
		case "number":
			return node.value
		case "metric":
			return valueOf(node.key)
		case "negate": {
			const value = evaluateFormula(node.operand, valueOf)
			return value === null ? null : -value
		}
		case "binary": {
			const left = evaluateFormula(node.left, valueOf)
			const right = evaluateFormula(node.right, valueOf)
			if (left === null || right === null) return null
			if (node.op === "+") return left + right
			if (node.op === "-") return left - right
			if (node.op === "*") return left * right
			return right === 0 ? null : left / right
		}
	}
}

// ---------------------------------------------------------------------------
// Widgets
// ---------------------------------------------------------------------------

/** Client-generated, unique within its layout. */
const WidgetId = NonEmptyText(40)
/** Columns of the Overview's 4-column grid. */
export const WidgetSpan = Schema.Literals([1, 2, 3, 4])
export type WidgetSpan = typeof WidgetSpan.Type
/** A window of days a value sums, takes the max or last of (the metric's `aggregation`). */
export const WindowDays = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 }))

/**
 * One number over a window, optionally against the window before. `label` is a template:
 * `{window}` reads `30d`, `{metric}` the metric's name; null is `{metric} · {window}`.
 */
export const StatWidget = Schema.TaggedStruct("stat", {
	id: WidgetId,
	span: WidgetSpan,
	metricKey: NonEmptyText(200),
	label: Schema.NullOr(Text(120)),
	windowDays: WindowDays,
	compare: Schema.Literals(["previous", "none"]),
	/** Which way of the change is good: green up, green down, or neither. */
	goodDirection: Schema.Literals(["up", "down", "neutral"]),
	/** Leave the widget out for a customer with no value in the window. */
	hideWhenEmpty: Schema.Boolean,
})
export type StatWidget = typeof StatWidget.Type

export const ChartWidget = Schema.TaggedStruct("chart", {
	id: WidgetId,
	span: WidgetSpan,
	title: Text(120),
	metricKeys: Schema.Array(NonEmptyText(200)).check(Schema.isMinLength(1), Schema.isMaxLength(6)),
	style: Schema.Literals(["bars", "stacked", "line"]),
	/** The range it opens at; the viewer can change it. */
	range: Schema.Literals(["7d", "30d", "90d"]),
})
export type ChartWidget = typeof ChartWidget.Type

/** A table of metrics: every metric of a group (`group`, today's and tomorrow's) or a hand-picked list. */
export const MetricTableRows = Schema.Union([
	Schema.TaggedStruct("group", { group: NonEmptyText(80) }),
	Schema.TaggedStruct("metrics", {
		metricKeys: Schema.Array(NonEmptyText(200)).check(Schema.isMinLength(1), Schema.isMaxLength(30)),
	}),
])
export type MetricTableRows = typeof MetricTableRows.Type

export const MetricTableWidget = Schema.TaggedStruct("metric_table", {
	id: WidgetId,
	span: WidgetSpan,
	title: Text(120),
	rows: MetricTableRows,
	windowDays: WindowDays,
	/** A metric counts as used in the window when its value is at least this. */
	usedAtLeast: Schema.Number,
	/** Unused metrics: listed last and dimmed, or left out. */
	unused: Schema.Literals(["show", "hide"]),
	order: Schema.Literals(["value", "name", "last_used"]),
	columns: Schema.Struct({ trend: Schema.Boolean, lastUsed: Schema.Boolean }),
	/** Keys a group brings that this table leaves out. */
	exclude: Schema.Array(NonEmptyText(200)).check(Schema.isMaxLength(50)),
})
export type MetricTableWidget = typeof MetricTableWidget.Type

/** The page's own sections, placed like any widget. */
export const BuiltInWidgetKind = Schema.Literals([
	"health",
	"signals",
	"subscription",
	"notes",
	"activity",
	"last_active",
])
export type BuiltInWidgetKind = typeof BuiltInWidgetKind.Type

export const BuiltInWidget = Schema.TaggedStruct("built_in", {
	id: WidgetId,
	span: WidgetSpan,
	kind: BuiltInWidgetKind,
})
export type BuiltInWidget = typeof BuiltInWidget.Type

export const OverviewWidget = Schema.Union([StatWidget, ChartWidget, MetricTableWidget, BuiltInWidget])
export type OverviewWidget = typeof OverviewWidget.Type

export const MAX_WIDGETS = 40
export const OverviewWidgets = Schema.Array(OverviewWidget).check(Schema.isMaxLength(MAX_WIDGETS))

/** The metric keys a widget reads (a table's group expands on the client and the server alike). */
export const widgetMetricKeys = (
	widget: OverviewWidget,
	groupKeys: (group: string) => ReadonlyArray<string>,
): ReadonlyArray<string> => {
	switch (widget._tag) {
		case "stat":
			return [widget.metricKey]
		case "chart":
			return widget.metricKeys
		case "metric_table":
			return (
				widget.rows._tag === "group" ? groupKeys(widget.rows.group) : widget.rows.metricKeys
			).filter((key) => !widget.exclude.includes(key))
		case "built_in":
			return []
	}
}

/** `{window}` → `30d`, `{metric}` → the metric's name. */
export const statLabel = (widget: StatWidget, metricName: string): string =>
	(widget.label ?? "{metric} · {window}")
		.replaceAll("{window}", `${widget.windowDays}d`)
		.replaceAll("{metric}", metricName)
		.replace(/\s+/g, " ")
		.trim()

/** Metric keys Hazel computes (sources may not write them), with how their definitions read. */
export const BUILT_IN_METRICS = [
	{ key: "active_users", name: "Daily active users", unit: "users", format: "number", aggregation: "max" },
	{
		key: "active_users_30d",
		name: "Active users (30 days)",
		unit: "users",
		format: "number",
		aggregation: "last",
	},
	{ key: "mrr", name: "MRR", unit: "minor", format: "money", aggregation: "last" },
	{ key: "health_score", name: "Health score", unit: "points", format: "number", aggregation: "last" },
] as const satisfies ReadonlyArray<{
	readonly key: string
	readonly name: string
	readonly unit: string
	readonly format: MetricFormat
	readonly aggregation: "sum" | "max" | "last"
}>

export const isBuiltInMetric = (key: string): boolean => BUILT_IN_METRICS.some((metric) => metric.key === key)

/**
 * Keys a user metric may not take: the built-ins, `new` (the editor's own path), and the prefixes
 * sources namespace their own keys under (`maple.`, `autumn.`).
 */
export const isReservedMetricKey = (key: string): boolean =>
	key === "new" || isBuiltInMetric(key) || /^(maple|autumn)\./.test(key)

/** What a new organization's default layout shows: what the Overview showed before layouts. */
export const DEFAULT_LAYOUT_WIDGETS: ReadonlyArray<OverviewWidget> = [
	{
		_tag: "stat",
		id: "active-users",
		span: 1,
		metricKey: "active_users_30d",
		label: "Active users",
		windowDays: 30,
		compare: "none",
		goodDirection: "up",
		hideWhenEmpty: false,
	},
	{
		_tag: "stat",
		id: "mrr",
		span: 1,
		metricKey: "mrr",
		label: "MRR",
		windowDays: 30,
		compare: "previous",
		goodDirection: "up",
		hideWhenEmpty: false,
	},
	{
		_tag: "stat",
		id: "health",
		span: 1,
		metricKey: "health_score",
		label: "Health score",
		windowDays: 7,
		compare: "previous",
		goodDirection: "up",
		hideWhenEmpty: true,
	},
	{ _tag: "built_in", id: "last-active", span: 1, kind: "last_active" },
	{
		_tag: "chart",
		id: "usage",
		span: 4,
		title: "Daily active users",
		metricKeys: ["active_users"],
		style: "bars",
		range: "30d",
	},
	{ _tag: "built_in", id: "health-breakdown", span: 2, kind: "health" },
	{ _tag: "built_in", id: "signals", span: 2, kind: "signals" },
	{ _tag: "built_in", id: "subscription", span: 2, kind: "subscription" },
	{ _tag: "built_in", id: "notes", span: 2, kind: "notes" },
	{ _tag: "built_in", id: "activity", span: 4, kind: "activity" },
]

// ---------------------------------------------------------------------------
// Layout rules
// ---------------------------------------------------------------------------

export const LayoutCondition = Schema.Union([
	Schema.TaggedStruct("stage", { stages: Schema.Array(LifecycleStage).check(Schema.isMinLength(1)) }),
	Schema.TaggedStruct("plan", {
		planNames: Schema.Array(NonEmptyText(100)).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
	}),
	/** Has any of these tags. */
	Schema.TaggedStruct("tag", {
		tags: Schema.Array(NonEmptyText(50)).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
	}),
	Schema.TaggedStruct("health", { statuses: Schema.Array(HealthStatus).check(Schema.isMinLength(1)) }),
	Schema.TaggedStruct("mrr", { op: Schema.Literals(["gte", "lt"]), valueMinor: Schema.Int }),
	/** An attribute's value, compared as text; `exists` ignores `value`. */
	Schema.TaggedStruct("attribute", {
		key: NonEmptyText(100),
		op: Schema.Literals(["eq", "neq", "exists"]),
		value: Text(200),
	}),
	/** The metric over the last `windowDays` (its own aggregation) against `value`. */
	Schema.TaggedStruct("metric", {
		metricKey: NonEmptyText(200),
		windowDays: WindowDays,
		op: Schema.Literals(["gt", "lt"]),
		value: Schema.Number,
	}),
])
export type LayoutCondition = typeof LayoutCondition.Type

/** No conditions: every customer. */
export const LayoutRule = Schema.Struct({
	match: Schema.Literals(["all", "any"]),
	conditions: Schema.Array(LayoutCondition).check(Schema.isMaxLength(20)),
})
export type LayoutRule = typeof LayoutRule.Type

export const EMPTY_LAYOUT_RULE: LayoutRule = { match: "all", conditions: [] }

/** What a rule is checked against: an account's fields plus the metric windows its rule reads. */
export interface LayoutFacts {
	readonly lifecycleStage: LifecycleStage
	readonly planName: string | null
	readonly tags: ReadonlyArray<string>
	readonly healthStatus: HealthStatus
	readonly mrrMinor: number
	readonly attributes: Readonly<Record<string, unknown>>
	/** `metricWindowKey(key, days)` → value; absent or null: no data, which no threshold meets. */
	readonly metricWindows: ReadonlyMap<string, number | null>
}

export const metricWindowKey = (metricKey: string, windowDays: number) => `${metricKey}@${windowDays}`

/** The metric windows a rule reads. */
export const ruleMetricWindows = (
	rule: LayoutRule,
): ReadonlyArray<{ readonly metricKey: string; readonly windowDays: number }> =>
	rule.conditions.flatMap((condition) =>
		condition._tag === "metric"
			? [{ metricKey: condition.metricKey, windowDays: condition.windowDays }]
			: [],
	)

const attributeText = (value: unknown): string | null =>
	value === undefined || value === null ? null : typeof value === "string" ? value : JSON.stringify(value)

export const conditionMatches = (condition: LayoutCondition, facts: LayoutFacts): boolean => {
	switch (condition._tag) {
		case "stage":
			return condition.stages.includes(facts.lifecycleStage)
		case "plan":
			return facts.planName !== null && condition.planNames.includes(facts.planName)
		case "tag":
			return condition.tags.some((tag) => facts.tags.includes(tag))
		case "health":
			return condition.statuses.includes(facts.healthStatus)
		case "mrr":
			return condition.op === "gte"
				? facts.mrrMinor >= condition.valueMinor
				: facts.mrrMinor < condition.valueMinor
		case "attribute": {
			const value = attributeText(facts.attributes[condition.key])
			if (condition.op === "exists") return value !== null && value !== ""
			if (condition.op === "eq") return value === condition.value
			return value !== condition.value
		}
		case "metric": {
			const value = facts.metricWindows.get(metricWindowKey(condition.metricKey, condition.windowDays))
			if (value === undefined || value === null) return false
			return condition.op === "gt" ? value > condition.value : value < condition.value
		}
	}
}

export const ruleMatches = (rule: LayoutRule, facts: LayoutFacts): boolean =>
	rule.conditions.length === 0 ||
	(rule.match === "all"
		? rule.conditions.every((condition) => conditionMatches(condition, facts))
		: rule.conditions.some((condition) => conditionMatches(condition, facts)))

/**
 * The layout an account gets: the one it is pinned to, else the first non-default layout (by
 * `position`) whose rule matches, else the default.
 */
export const resolveLayout = <
	L extends { readonly id: string; readonly isDefault: boolean; readonly rule: LayoutRule },
>(
	layouts: ReadonlyArray<L>,
	facts: LayoutFacts,
	pinnedLayoutId: string | null,
): L | undefined => {
	const pinned =
		pinnedLayoutId === null ? undefined : layouts.find((layout) => layout.id === pinnedLayoutId)
	if (pinned !== undefined) return pinned
	return (
		layouts.find((layout) => !layout.isDefault && ruleMatches(layout.rule, facts)) ??
		layouts.find((layout) => layout.isDefault)
	)
}

/** A layout as the editor submits it. */
export const LayoutDraft = Schema.Struct({
	name: NonEmptyText(80),
	rule: LayoutRule,
	widgets: OverviewWidgets,
})
export type LayoutDraft = typeof LayoutDraft.Type

/** A metric as the metrics editor submits it (the key is set on create and never changes). */
export const MetricDraft = Schema.Struct({
	name: NonEmptyText(120),
	description: Schema.NullOr(Text(500)),
	/** The catalog's section and a metric table's rows: "Ingest", "Feature usage". */
	group: Schema.NullOr(NonEmptyText(80)),
	unit: Schema.NullOr(NonEmptyText(40)),
	format: MetricFormat,
	/** How days combine over a window: summed, the highest, or the latest. */
	aggregation: Schema.Literals(["sum", "max", "last"]),
	/**
	 * Required to create one. Null on update for a source's own metric or a built-in, whose data
	 * Hazel does not define: only its name, description, group, unit and format change.
	 */
	source: Schema.NullOr(MetricSource),
})
export type MetricDraft = typeof MetricDraft.Type

// ---------------------------------------------------------------------------
// Read results
// ---------------------------------------------------------------------------

/** One metric over the last `days` days, and over the `days` before them. */
export const MetricWindow = Schema.Struct({
	metricKey: Schema.String,
	days: Schema.Int,
	/** Null: no data in the window. */
	value: Schema.NullOr(Schema.Number),
	previous: Schema.NullOr(Schema.Number),
	/** The last day with a value above 0, any time in the last year. */
	lastSeenDay: Schema.NullOr(Schema.String),
})
export type MetricWindow = typeof MetricWindow.Type

/** A metric source tried against the last days, before it is saved. */
export const MetricPreviewResult = Schema.Struct({
	/** The source cannot run (bad SQL, Maple refused it, a formula naming unknown metrics). */
	error: Schema.NullOr(Schema.String),
	days: Schema.Int,
	/** Accounts with a value on any of the days, of `totalAccounts`. */
	accountsWithData: Schema.Int,
	totalAccounts: Schema.Int,
	/** Rows Maple answered that name no known customer. */
	unmatchedRows: Schema.Int,
	/** The highest values over the days, summed by the metric's aggregation. */
	top: Schema.Array(
		Schema.Struct({ accountId: CustomerAccountId, name: Schema.String, value: Schema.Number }),
	),
	/** One customer's daily values, oldest first: the sample chart. */
	sample: Schema.NullOr(
		Schema.Struct({
			accountId: CustomerAccountId,
			name: Schema.String,
			points: Schema.Array(Schema.Struct({ day: Schema.String, value: Schema.Number })),
		}),
	),
})
export type MetricPreviewResult = typeof MetricPreviewResult.Type

/** Who a draft rule gives a layout to, at its place in the order. */
export const LayoutDryRunResult = Schema.Struct({
	/** Accounts the rule matches (pins aside), at most 200 listed. */
	matchingCount: Schema.Int,
	matching: Schema.Array(Schema.Struct({ accountId: CustomerAccountId, name: Schema.String })),
	/** Of those, the ones a layout earlier in the order already takes, per layout (pins aside). */
	takenBy: Schema.Array(
		Schema.Struct({ layoutId: CustomerOverviewLayoutId, name: Schema.String, count: Schema.Int }),
	),
	/** Of those, the ones pinned to another layout. */
	pinnedElsewhere: Schema.Int,
	/** Accounts it would actually get: matching, minus taken and pinned elsewhere, plus pinned to it. */
	effectiveCount: Schema.Int,
})
export type LayoutDryRunResult = typeof LayoutDryRunResult.Type
