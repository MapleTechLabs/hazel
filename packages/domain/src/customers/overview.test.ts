import { describe, expect, it } from "vitest"
import {
	builderProblem,
	checkMapleSql,
	EMPTY_LAYOUT_RULE,
	evaluateFormula,
	type LayoutFacts,
	type LayoutRule,
	mapleBuilderSql,
	metricWindowKey,
	parseFormula,
	resolveLayout,
	ruleMatches,
	statLabel,
	widgetMetricKeys,
} from "./overview"
import { CustomerOverviewLayoutId } from "@hazel/schema"

const parsed = (expression: string) => {
	const result = parseFormula(expression)
	if (!result.ok) throw new Error(result.error)
	return result
}

const evaluate = (expression: string, values: Record<string, number | null>) =>
	evaluateFormula(parsed(expression).node, (key) => values[key] ?? null)

describe("parseFormula / evaluateFormula", () => {
	it("follows precedence, parentheses and unary minus", () => {
		expect(evaluate("{a} + {b} * 2", { a: 1, b: 3 })).toBe(7)
		expect(evaluate("({a} + {b}) * 2", { a: 1, b: 3 })).toBe(8)
		expect(evaluate("-{a} - -2", { a: 5 })).toBe(-3)
		expect(evaluate("{a} / {b} / 2", { a: 8, b: 2 })).toBe(2)
		expect(evaluate("1.5e1 * {a}", { a: 2 })).toBe(30)
	})

	it("lists each metric once and allows dots and dashes in keys", () => {
		expect(parsed("{maple.log-bytes} / {maple.spans} + {maple.spans}").keys).toEqual([
			"maple.log-bytes",
			"maple.spans",
		])
	})

	it("is null on division by zero, a missing operand, or a result that is not finite", () => {
		expect(evaluate("{a} / {b}", { a: 1, b: 0 })).toBeNull()
		expect(evaluate("{a} + {b}", { a: 1 })).toBeNull()
		expect(evaluate("{a} * {a}", { a: 1e200 })).toBeNull()
		expect(evaluate("{a} - 1", { a: Number.POSITIVE_INFINITY })).toBeNull()
		expect(parseFormula("{a} * 1e999")).toEqual({ ok: false, error: "1e999 is too large a number" })
	})

	it("refuses what it cannot read", () => {
		for (const expression of ["", "{a} +", "({a}", "{a} )", "a / b", "{}", "{a", "2 * 3", "{a} {b}"]) {
			expect([expression, parseFormula(expression).ok]).toEqual([expression, false])
		}
	})
})

describe("checkMapleSql", () => {
	const valid = `SELECT Attributes['org_id'] AS account, sum(Value) AS value
FROM metrics_sum
WHERE $__orgFilter AND $__timeFilter(TimeUnix)
GROUP BY account`

	it("accepts a query that keeps the contract, a trailing semicolon too", () => {
		expect(checkMapleSql(valid)).toBeNull()
		expect(checkMapleSql(`${valid};`)).toBeNull()
		// A keyword inside a string literal is not a clause.
		expect(checkMapleSql(valid.replace("GROUP BY", "AND ServiceName != 'limit' GROUP BY"))).toBeNull()
	})

	it("names what breaks it", () => {
		expect(checkMapleSql("WITH x AS (SELECT 1) SELECT 1")).toBe("Start with SELECT")
		expect(checkMapleSql(`${valid}; SELECT 1`)).toBe("One statement only")
		expect(checkMapleSql(valid.replace("$__orgFilter AND ", ""))).toBe("AND in $__orgFilter")
		expect(checkMapleSql(valid.replace("$__timeFilter(TimeUnix)", "1 = 1"))).toBe(
			"Filter time with $__timeFilter(<column>)",
		)
		expect(
			checkMapleSql(
				"SELECT GroupId AS org, count() AS n FROM product_events WHERE $__orgFilter AND $__timeFilter(Timestamp) GROUP BY org",
			),
		).toBe("Select `account` and `value`")
		expect(checkMapleSql(`${valid}\nORDER BY value`)).toMatch(/^Leave out ORDER BY/)
		expect(checkMapleSql(`${valid}\nLIMIT 5`)).toMatch(/^Leave out ORDER BY/)
	})

	it("keeps the page clause Hazel appends meaningful: one plain SELECT ending in GROUP BY account", () => {
		const subquery = `SELECT account, sum(value) AS value FROM (${valid}) GROUP BY account`
		expect(checkMapleSql(subquery)).toBe("One SELECT only: no subqueries or UNION")
		expect(checkMapleSql(`${valid} UNION ALL ${valid}`)).toBe("One SELECT only: no subqueries or UNION")
		expect(checkMapleSql(`${valid} -- by org`)).toBe("Leave out comments")
		expect(checkMapleSql(valid.replace("FROM", "/* x */ FROM"))).toBe("Leave out comments")
		expect(checkMapleSql(valid.replace("GROUP BY account", "GROUP BY account, ServiceName"))).toBe(
			"End with GROUP BY account (a HAVING may follow)",
		)
		expect(checkMapleSql(`${valid} HAVING value > 0`)).toBeNull()
		// The organization filter scopes the result only as WHERE's first conjunct, never OR-ed.
		expect(checkMapleSql(valid.replace("$__orgFilter AND", "$__orgFilter OR 1 = 1 AND"))).toBe(
			"Start WHERE with $__orgFilter, then AND the other conditions",
		)
		expect(
			checkMapleSql(valid.replace("$__timeFilter(TimeUnix)", "$__timeFilter(TimeUnix) OR 1 = 1")),
		).toBe("Join WHERE's conditions with AND; put an OR inside parentheses")
		expect(
			checkMapleSql(
				"SELECT $__orgFilter AS account, sum(Value) AS value FROM metrics_sum WHERE $__timeFilter(TimeUnix) GROUP BY account",
			),
		).toBe("Start WHERE with $__orgFilter, then AND the other conditions")
		expect(
			checkMapleSql(valid.replace("GROUP BY", "AND (ServiceName = 'a' OR ServiceName = 'b') GROUP BY")),
		).toBeNull()
		// A quoted identifier is a name, not a clause; a real LIMIT still is one.
		expect(
			checkMapleSql(valid.replace("GROUP BY", 'AND "limit" > 0 AND `order` > 0 GROUP BY')),
		).toBeNull()
		expect(checkMapleSql(`${valid.replace("GROUP BY", 'AND "limit" > 0 GROUP BY')} LIMIT 3`)).toMatch(
			/^Leave out ORDER BY/,
		)
		// Inside a literal, none of it counts.
		expect(
			checkMapleSql(valid.replace("GROUP BY", "AND ServiceName != 'a -- union select \\' #' GROUP BY")),
		).toBeNull()
	})
})

describe("mapleBuilderSql", () => {
	it("writes SQL that keeps the contract", () => {
		const sql = mapleBuilderSql({
			table: "metrics_sum",
			filters: [
				{ field: "MetricName", op: "eq", value: "maple_ingest_org_bytes_total" },
				{ field: "Attributes.signal", op: "in", value: "logs, traces," },
				{ field: "ServiceName", op: "neq", value: "it's" },
			],
			value: "sum",
			customerField: "Attributes.org_id",
		})
		expect(sql).toBe(
			[
				"SELECT Attributes['org_id'] AS account, sum(Value) AS value",
				"FROM metrics_sum",
				"WHERE $__orgFilter",
				"  AND $__timeFilter(TimeUnix)",
				"  AND Attributes['org_id'] != ''",
				"  AND MetricName = 'maple_ingest_org_bytes_total'",
				"  AND Attributes['signal'] IN ('logs', 'traces')",
				"  AND ServiceName != 'it\\'s'",
				"GROUP BY account",
			].join("\n"),
		)
		expect(checkMapleSql(sql)).toBeNull()
	})

	it("names a builder it cannot write SQL for", () => {
		const builder = {
			table: "metrics_sum",
			filters: [{ field: "Attributes.signal", op: "in", value: " , ," }],
			value: "sum",
			customerField: "Attributes.org_id",
		} as const
		expect(builderProblem(builder)).toBe("Give Attributes.signal at least one value")
		expect(builderProblem({ ...builder, customerField: "org id'" })).toBe(
			"Not a column Hazel can query: org id'",
		)
		expect(builderProblem({ ...builder, filters: [{ ...builder.filters[0], value: "logs" }] })).toBeNull()
	})

	it("counts distinct values of a column", () => {
		const sql = mapleBuilderSql({
			table: "traces",
			filters: [],
			value: "uniq",
			valueField: "TraceId",
			customerField: "ResourceAttributes.org_id",
		})
		expect(sql).toContain("uniqExact(TraceId) AS value")
		expect(sql).toContain("$__timeFilter(Timestamp)")
		expect(checkMapleSql(sql)).toBeNull()
	})
})

const facts = (overrides: Partial<LayoutFacts> = {}): LayoutFacts => ({
	lifecycleStage: "active",
	planName: "Team",
	tags: [],
	healthStatus: "healthy",
	mrrMinor: 10_000,
	attributes: {},
	metricWindows: new Map(),
	...overrides,
})

describe("ruleMatches", () => {
	it("matches everyone with no conditions", () => {
		expect(ruleMatches(EMPTY_LAYOUT_RULE, facts())).toBe(true)
	})

	it("checks each kind of condition", () => {
		const one = (rule: LayoutRule["conditions"][number], input: LayoutFacts) =>
			ruleMatches({ match: "all", conditions: [rule] }, input)
		expect(one({ _tag: "stage", stages: ["trialing"] }, facts())).toBe(false)
		expect(one({ _tag: "plan", planNames: ["Team"] }, facts())).toBe(true)
		expect(one({ _tag: "plan", planNames: ["Team"] }, facts({ planName: null }))).toBe(false)
		expect(one({ _tag: "tag", tags: ["observability", "x"] }, facts({ tags: ["observability"] }))).toBe(
			true,
		)
		expect(one({ _tag: "health", statuses: ["at_risk"] }, facts())).toBe(false)
		expect(one({ _tag: "mrr", op: "gte", valueMinor: 10_000 }, facts())).toBe(true)
		expect(one({ _tag: "mrr", op: "lt", valueMinor: 10_000 }, facts())).toBe(false)
		const region = { _tag: "attribute", key: "region", value: "eu" } as const
		// Own attributes only.
		expect(one({ _tag: "attribute", key: "toString", op: "exists", value: "" }, facts())).toBe(false)
		expect(one({ ...region, op: "eq" }, facts({ attributes: { region: "eu" } }))).toBe(true)
		expect(one({ ...region, op: "neq" }, facts())).toBe(true)
		expect(one({ ...region, op: "exists" }, facts({ attributes: { region: "" } }))).toBe(false)
		const spans = { _tag: "metric", metricKey: "spans", windowDays: 30, op: "gt", value: 0 } as const
		expect(one(spans, facts({ metricWindows: new Map([[metricWindowKey("spans", 30), 5]]) }))).toBe(true)
		// No data meets no threshold, either way.
		expect(one(spans, facts({ metricWindows: new Map([[metricWindowKey("spans", 30), null]]) }))).toBe(
			false,
		)
		expect(one({ ...spans, op: "lt", value: 10 }, facts())).toBe(false)
	})

	it("needs all or any of them", () => {
		const conditions = [
			{ _tag: "plan", planNames: ["Team"] },
			{ _tag: "tag", tags: ["observability"] },
		] as const
		expect(ruleMatches({ match: "all", conditions }, facts())).toBe(false)
		expect(ruleMatches({ match: "any", conditions }, facts())).toBe(true)
	})
})

describe("resolveLayout", () => {
	const ids = {
		default: CustomerOverviewLayoutId.make(crypto.randomUUID()),
		trials: CustomerOverviewLayoutId.make(crypto.randomUUID()),
		everyone: CustomerOverviewLayoutId.make(crypto.randomUUID()),
		deleted: CustomerOverviewLayoutId.make(crypto.randomUUID()),
	}
	const fallback = { id: ids.default, isDefault: true, rule: EMPTY_LAYOUT_RULE }
	const trials = {
		id: ids.trials,
		isDefault: false,
		rule: { match: "all", conditions: [{ _tag: "stage", stages: ["trialing"] }] } satisfies LayoutRule,
	}
	const everyone = { id: ids.everyone, isDefault: false, rule: EMPTY_LAYOUT_RULE }

	it("takes the pin, else the first matching layout in order, else the default", () => {
		const layouts = [fallback, trials, everyone]
		expect(resolveLayout(layouts, facts({ lifecycleStage: "trialing" }), null)?.id).toBe(ids.trials)
		expect(resolveLayout(layouts, facts(), null)?.id).toBe(ids.everyone)
		expect(resolveLayout(layouts, facts(), ids.trials)?.id).toBe(ids.trials)
		expect(resolveLayout([fallback, trials], facts(), null)?.id).toBe(ids.default)
		// A pin to a layout that is gone is ignored.
		expect(resolveLayout([fallback, trials], facts(), ids.deleted)?.id).toBe(ids.default)
	})
})

describe("widgets", () => {
	const table = {
		_tag: "metric_table",
		id: "t",
		span: 2,
		title: "",
		windowDays: 30,
		usedAtLeast: 1,
		unused: "show",
		order: "value",
		columns: { trend: false, lastUsed: false },
		exclude: ["b"],
	} as const
	it("trims a group by `exclude`, but lists a hand-picked table as picked", () => {
		const groupKeys = () => ["a", "b", "c"]
		expect(widgetMetricKeys({ ...table, rows: { _tag: "group", group: "g" } }, groupKeys)).toEqual([
			"a",
			"c",
		])
		expect(
			widgetMetricKeys({ ...table, rows: { _tag: "metrics", metricKeys: ["b", "d"] } }, groupKeys),
		).toEqual(["b", "d"])
	})

	it("puts a metric's name into a stat's label as written", () => {
		const stat = {
			_tag: "stat",
			id: "s",
			span: 1,
			metricKey: "x",
			label: "{metric} ({window})",
			windowDays: 7,
			compare: "none",
			goodDirection: "up",
			hideWhenEmpty: false,
		} as const
		expect(statLabel(stat, "Cost in $& and $1")).toBe("Cost in $& and $1 (7d)")
	})
})
