import { describe, expect, it } from "vitest"
import {
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
} from "./overview"

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

	it("is null on division by zero or a missing operand", () => {
		expect(evaluate("{a} / {b}", { a: 1, b: 0 })).toBeNull()
		expect(evaluate("{a} + {b}", { a: 1 })).toBeNull()
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
	const fallback = { id: "default", isDefault: true, rule: EMPTY_LAYOUT_RULE }
	const trials = {
		id: "trials",
		isDefault: false,
		rule: { match: "all", conditions: [{ _tag: "stage", stages: ["trialing"] }] },
	} satisfies { id: string; isDefault: boolean; rule: LayoutRule }
	const everyone = { id: "everyone", isDefault: false, rule: EMPTY_LAYOUT_RULE }

	it("takes the pin, else the first matching layout in order, else the default", () => {
		const layouts = [fallback, trials, everyone]
		expect(resolveLayout(layouts, facts({ lifecycleStage: "trialing" }), null)?.id).toBe("trials")
		expect(resolveLayout(layouts, facts(), null)?.id).toBe("everyone")
		expect(resolveLayout(layouts, facts(), "trials")?.id).toBe("trials")
		expect(resolveLayout([fallback, trials], facts(), null)?.id).toBe("default")
		// A pin to a layout that is gone is ignored.
		expect(resolveLayout([fallback, trials], facts(), "deleted")?.id).toBe("default")
	})
})
