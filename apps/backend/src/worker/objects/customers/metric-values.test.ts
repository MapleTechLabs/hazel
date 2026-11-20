import type { MetricSource } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { sameMetricData } from "./metric-values"

const query = (sql: string): MetricSource => ({ _tag: "maple_query", sql, builder: null })

describe("sameMetricData", () => {
	it("ignores whitespace outside quotes, keeps it inside literals and quoted identifiers", () => {
		const base =
			"SELECT account, sum(Value) AS value FROM t WHERE $__orgFilter AND x = 'a b' GROUP BY account"
		expect(
			sameMetricData(
				query(base),
				query(`  ${base.replaceAll(" ", "\n  ")};`.replace("'a\n  b'", "'a b'")),
			),
		).toBe(true)
		expect(sameMetricData(query(base), query(base.replace("'a b'", "'a  b'")))).toBe(false)
		expect(sameMetricData(query('SELECT "a b" AS account'), query('SELECT "a  b" AS account'))).toBe(
			false,
		)
		expect(sameMetricData(query("SELECT `a b` AS account"), query("SELECT `a  b` AS account"))).toBe(
			false,
		)
	})

	it("compares events as a set and formulas without whitespace", () => {
		expect(
			sameMetricData(
				{ _tag: "product_event", events: [" b", "a", "a"] },
				{ _tag: "product_event", events: ["a", "b"] },
			),
		).toBe(true)
		expect(
			sameMetricData(
				{ _tag: "formula", expression: "{a} / {b}" },
				{ _tag: "formula", expression: "{a}/{b}" },
			),
		).toBe(true)
		expect(sameMetricData(query("SELECT 1"), null)).toBe(false)
	})
})
