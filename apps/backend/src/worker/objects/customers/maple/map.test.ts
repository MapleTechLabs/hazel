/**
 * The mapping: which rows become activity, which become metrics, which are left out, and how a
 * page declares the accounts it touched. Pure — no HTTP, no store.
 */
import type { IngestOp, RecordActivity, RecordMetric, UpsertAccount } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { accountRefOp, activityOps, countOf, metricDefinitionOps, metricMapOf, metricOps } from "./map"
import { ORG_ACME, ORG_GLOBEX, USER_ADA, USER_LIN } from "./fixtures"
import type { MapleActivityRow, MapleMetricRow } from "./wire"

const OBSERVED = "2026-06-15T12:00:00.000Z"

const activityRow = (overrides: Partial<MapleActivityRow> = {}): MapleActivityRow => ({
	day: "2026-06-14",
	account: ORG_ACME,
	contact: USER_ADA,
	events: 26,
	sessions: 4,
	...overrides,
})

const metricRow = (overrides: Partial<MapleMetricRow> = {}): MapleMetricRow => ({
	day: "2026-06-14",
	account: ORG_ACME,
	event: "dashboard_created",
	events: 2,
	...overrides,
})

const accounts = (ops: ReadonlyArray<IngestOp>) =>
	ops.filter((op): op is UpsertAccount => op._tag === "account")

const activity = (ops: ReadonlyArray<IngestOp>) =>
	ops.filter((op): op is RecordActivity => op._tag === "activity")

const metrics = (ops: ReadonlyArray<IngestOp>) => ops.filter((op): op is RecordMetric => op._tag === "metric")

describe("Maple activity mapping", () => {
	it("names the Clerk contact and the Maple account, with the day's events and sessions", () => {
		const { ops, skipped } = activityOps([activityRow()], OBSERVED)
		expect(skipped).toBe(0)
		expect(activity(ops)).toEqual([
			{
				_tag: "activity",
				contact: { provider: "clerk", externalId: USER_ADA },
				account: { provider: "maple", externalId: ORG_ACME },
				day: "2026-06-14",
				eventCount: 26,
				sessionCount: 4,
			},
		])
	})

	it("declares an account once per page, as a reference that creates nothing", () => {
		const { ops } = activityOps(
			[activityRow(), activityRow({ contact: USER_LIN }), activityRow({ account: ORG_GLOBEX })],
			OBSERVED,
		)
		expect(accounts(ops)).toEqual([accountRefOp(ORG_ACME, OBSERVED), accountRefOp(ORG_GLOBEX, OBSERVED)])
		// A reference and nothing more: Maple is not the identity source.
		expect(accounts(ops)[0]).toEqual({
			_tag: "account",
			externalId: ORG_ACME,
			sameAs: [{ provider: "clerk", externalId: ORG_ACME }],
			onNoMatch: "unmatched",
			observedAt: OBSERVED,
		})
		// No name, no domain and no `matchByDomain`: two Clerk organizations never merge through Maple.
		expect(Object.keys(accounts(ops)[0]!).sort()).toEqual([
			"_tag",
			"externalId",
			"observedAt",
			"onNoMatch",
			"sameAs",
		])
	})

	it("puts the account before the activity that names it", () => {
		const { ops } = activityOps([activityRow()], OBSERVED)
		expect(ops.map((op) => op._tag)).toEqual(["account", "activity"])
	})

	it("emits no contact op: Maple knows no email and would duplicate the Clerk contact", () => {
		const { ops } = activityOps([activityRow()], OBSERVED)
		expect(ops.some((op) => op._tag === "contact")).toBe(false)
	})

	it("skips and counts a row with no day, group, user or readable count", () => {
		const rows = [
			activityRow({ day: "not-a-day" }),
			activityRow({ account: "" }),
			activityRow({ contact: " " }),
			activityRow({ events: "nonsense" }),
			activityRow({ sessions: -1 }),
			activityRow(),
		]
		const { ops, skipped } = activityOps(rows, OBSERVED)
		expect(skipped).toBe(5)
		expect(activity(ops)).toHaveLength(1)
	})

	it("reads a count Maple sent as digits, which is how it sends one past 2^53", () => {
		expect(countOf("9007199254740993")).toBe(9007199254740992)
		expect(countOf(26)).toBe(26)
		expect(countOf("")).toBeNull()
		expect(countOf(Number.NaN)).toBeNull()
	})
})

describe("Maple metric mapping", () => {
	const map = metricMapOf([
		{ event: "dashboard_created", metricKey: "dashboards" },
		{ event: "alert_rule_created", metricKey: "dashboards" },
		{ event: "plan_started", metricKey: "upgrades" },
	])

	it("namespaces every key, so ingest never sees another provider's", () => {
		expect([...map.entries()]).toEqual([
			["dashboard_created", "maple.dashboards"],
			["alert_rule_created", "maple.dashboards"],
			["plan_started", "maple.upgrades"],
		])
	})

	it("drops a mapping Hazel cannot put in a query or write", () => {
		const unusable = metricMapOf([
			{ event: "ok'; DROP", metricKey: "x" },
			{ event: "ok", metricKey: "has space" },
			{ event: "", metricKey: "y" },
			{ event: "dashboard_created", metricKey: "dashboards" },
			// The same event twice keeps its first key.
			{ event: "dashboard_created", metricKey: "other" },
		])
		expect([...unusable.entries()]).toEqual([["dashboard_created", "maple.dashboards"]])
	})

	it("declares one definition per key, named after it and summed over a span of days", () => {
		expect(metricDefinitionOps(map)).toEqual([
			{
				_tag: "metric_definition",
				key: "maple.dashboards",
				name: "dashboards",
				unit: "events",
				aggregation: "sum",
				description: null,
			},
			{
				_tag: "metric_definition",
				key: "maple.upgrades",
				name: "upgrades",
				unit: "events",
				aggregation: "sum",
				description: null,
			},
		])
	})

	it("adds up the events that share a key, and keeps days and accounts apart", () => {
		const { ops, skipped } = metricOps(
			[
				metricRow({ events: 2 }),
				metricRow({ event: "alert_rule_created", events: 3 }),
				metricRow({ account: ORG_GLOBEX, events: 1 }),
				metricRow({ day: "2026-06-15", events: 5 }),
				metricRow({ event: "plan_started", events: 1 }),
			],
			map,
			OBSERVED,
		)
		expect(skipped).toBe(0)
		// Sorted by account, key and day, so the row order Maple listed cannot change the ops.
		expect(metrics(ops)).toEqual([
			{
				_tag: "metric",
				account: { provider: "maple", externalId: ORG_GLOBEX },
				metricKey: "maple.dashboards",
				day: "2026-06-14",
				value: 1,
			},
			{
				_tag: "metric",
				account: { provider: "maple", externalId: ORG_ACME },
				metricKey: "maple.dashboards",
				day: "2026-06-14",
				value: 5,
			},
			{
				_tag: "metric",
				account: { provider: "maple", externalId: ORG_ACME },
				metricKey: "maple.dashboards",
				day: "2026-06-15",
				value: 5,
			},
			{
				_tag: "metric",
				account: { provider: "maple", externalId: ORG_ACME },
				metricKey: "maple.upgrades",
				day: "2026-06-14",
				value: 1,
			},
		])
		expect(accounts(ops).map((op) => op.externalId)).toEqual([ORG_GLOBEX, ORG_ACME])
	})

	it("skips and counts a row whose event is not mapped", () => {
		const { ops, skipped } = metricOps([metricRow({ event: "$pageview" })], map, OBSERVED)
		expect(skipped).toBe(1)
		expect(ops).toEqual([])
	})

	it("writes no metric op without a mapping", () => {
		expect(metricOps([metricRow()], metricMapOf([]), OBSERVED)).toEqual({ ops: [], skipped: 1 })
	})
})
