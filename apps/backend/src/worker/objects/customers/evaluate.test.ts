/**
 * Signal evaluation per template (`./evaluate.ts`): each fires on its condition, stays quiet below
 * it, escalates by evidence step, and honours scope, sources and churn.
 */
import { type RuleConfig, type SignalSeverity, TEMPLATES } from "@hazel/domain/customers"
import { describe, expect, it } from "vitest"
import { evaluate, type Match, type RuleInput } from "./evaluate"
import { formatMoney, metricSeries } from "./facts"
import { billingProviderOf } from "./snapshot"
import { factsOf, type FactsInput, NOW, orgFacts, TODAY } from "./test-kit"
import { addDays } from "./time"

const ruleOf = (config: RuleConfig, overrides: Partial<RuleInput> = {}): RuleInput => ({
	name: TEMPLATES[config._tag].name,
	template: config._tag,
	severity: TEMPLATES[config._tag].defaultSeverity,
	config,
	scope: {},
	...overrides,
})

const defaults = <T extends RuleConfig["_tag"]>(template: T) => TEMPLATES[template].defaultConfig

const run = (template: RuleConfig["_tag"], input: FactsInput, org = orgFacts()) =>
	evaluate(ruleOf(defaults(template)), factsOf(input), org)

const match = (template: RuleConfig["_tag"], input: FactsInput, org = orgFacts()) => {
	const result = run(template, input, org)
	if (result._tag !== "Match") throw new Error(`expected a match, got ${result.reason}`)
	return result as Match
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index)

const severityOf = (template: RuleConfig["_tag"], input: FactsInput): SignalSeverity =>
	match(template, input).severity

describe("signal evaluation", () => {
	it("inactive: quiet for 14 days after being active; escalates at 2× and 4×", () => {
		const quiet = (days: number): FactsInput => ({
			activity: { ann: [-days, -days - 3] },
			priorActive: [[30, 3]],
		})
		expect(run("inactive", quiet(10))).toEqual({ _tag: "NoMatch", reason: "Below threshold" })
		const found = match("inactive", quiet(18))
		expect(found.evidence).toMatchObject({
			_tag: "last_active",
			step: 0,
			daysInactive: 18,
			priorActiveUsers: 3,
		})
		expect(found.reason).toBe("No activity for 18 days; 3 active users before")
		expect(found.severity).toBe("medium")
		expect(severityOf("inactive", quiet(30))).toBe("high")
		expect(match("inactive", quiet(60)).evidence.step).toBe(2)
		// Never active: not this template's case.
		expect(run("inactive", { idle: ["bob"] })).toEqual({ _tag: "NoMatch", reason: "No data" })
		// No prior users before the quiet period.
		expect(run("inactive", { activity: { ann: [-20] }, priorActive: [[30, 0]] })._tag).toBe("NoMatch")
	})

	it("usage_drop: 7-day average down ≥30% vs the 28 days before", () => {
		const steady = range(-35, -1)
		const input: FactsInput = {
			activity: {
				ann: steady,
				bob: steady.filter((offset) => offset < -7),
				cat: steady.filter((offset) => offset < -7),
			},
		}
		const found = match("usage_drop", input)
		expect(found.evidence).toMatchObject({
			_tag: "series",
			metricKey: "active_users",
			recentAvg: 1,
			baselineAvg: 3,
		})
		expect(found.evidence.step).toBe(1)
		expect(found.evidence).toHaveProperty("series.length", 35)
		expect(run("usage_drop", { activity: { ann: steady, bob: steady } })).toEqual({
			_tag: "NoMatch",
			reason: "Below threshold",
		})
		expect(run("usage_drop", {})).toEqual({ _tag: "NoMatch", reason: "No data" })
	})

	it("usage_drop on a built-in metric reads its derived series (MRR from movements)", () => {
		const config = defaults("usage_drop")
		if (config._tag !== "usage_drop") throw new Error("usage_drop defaults")
		const rule = ruleOf({ ...config, metricKey: "mrr" })
		const facts = factsOf({
			account: { mrrMinor: 5_000 },
			movements: [
				{ day: addDays(TODAY, -60), type: "new", fromMrrMinor: 0, toMrrMinor: 20_000 },
				{ day: addDays(TODAY, -3), type: "contraction", fromMrrMinor: 20_000, toMrrMinor: 5_000 },
			],
		})
		expect(evaluate(rule, facts, orgFacts())).toMatchObject({
			_tag: "Match",
			evidence: { _tag: "series", metricKey: "mrr", baselineAvg: 20_000 },
		})
	})

	it("carries a level metric's last value over missing days; sums count them as 0", () => {
		const facts = factsOf({
			metrics: new Map([
				[
					"seats",
					[
						{ day: addDays(TODAY, -10), value: 5, limitValue: null },
						{ day: addDays(TODAY, -8), value: 7, limitValue: null },
					],
				],
			]),
		})
		const values = (aggregation: "sum" | "last") =>
			metricSeries(facts, "seats", addDays(TODAY, -6), 4, aggregation).map((point) => point.value)
		expect(values("last")).toEqual([5, 7, 7, 7])
		expect(values("sum")).toEqual([0, 7, 0, 0])
	})

	it("formats money in the currency's own minor unit", () => {
		expect(formatMoney(1_500, "usd")).toBe("$15.00")
		expect(formatMoney(1_500, "jpy")).toBe("¥1,500")
	})

	it("bills each account from Autumn once it is imported and bills the account; else from Stripe", () => {
		const subs = (...subscriptions: NonNullable<FactsInput["subscriptions"]>) =>
			factsOf({ subscriptions }).subscriptions
		const both = subs({ provider: "stripe" }, { provider: "autumn" })
		expect(billingProviderOf(false, both)).toBe("stripe")
		expect(billingProviderOf(true, both)).toBe("autumn")
		// Unknown to Autumn, or billed in Stripe outside it.
		expect(billingProviderOf(true, subs({ provider: "stripe" }))).toBe("stripe")
		// Autumn bills only on a billed paying subscription: a free plan or a trial leaves Stripe's.
		const free = { provider: "autumn", mrrMinor: 0 } as const
		const trial = { provider: "autumn", status: "trialing" } as const
		const ended = { provider: "autumn", status: "canceled" } as const
		expect(billingProviderOf(true, subs({ provider: "stripe" }, free))).toBe("stripe")
		expect(billingProviderOf(true, subs({ provider: "stripe" }, trial))).toBe("stripe")
		expect(billingProviderOf(true, subs({ provider: "stripe" }, free, ended))).toBe("stripe")
		expect(
			billingProviderOf(true, subs({ provider: "stripe" }, { provider: "autumn", status: "past_due" })),
		).toBe("autumn")
		// Neither billing now: the one that paid, Autumn's first.
		const stripeEnded = { provider: "stripe", status: "canceled" } as const
		expect(billingProviderOf(true, subs(stripeEnded, free, ended))).toBe("autumn")
		expect(billingProviderOf(true, subs(stripeEnded, free))).toBe("stripe")
		// Autumn's only: kept while Autumn imports or after a disconnect, never zeroed.
		expect(billingProviderOf(false, subs({ provider: "autumn" }))).toBe("autumn")
		expect(billingProviderOf(true, subs(free))).toBe("autumn")
		expect(billingProviderOf(true, [])).toBe("stripe")
	})

	it("payment_failed: past due, or an invoice open 7+ days past due; escalates by age and unpaid", () => {
		const overdue = (days: number) => ({
			dueAt: new Date(NOW.getTime() - days * 86_400_000),
			declineReason: "card_declined",
		})
		expect(run("payment_failed", { subscriptions: [{}], openInvoices: [overdue(3)] })).toEqual({
			_tag: "NoMatch",
			reason: "Below threshold",
		})
		const found = match("payment_failed", { subscriptions: [{}], openInvoices: [overdue(9)] })
		expect(found.evidence).toMatchObject({ _tag: "amount", step: 0, amountMinor: 19_900, daysOverdue: 9 })
		expect(found.reason).toBe("$199.00 unpaid, 9 days overdue (card declined)")
		expect(found.severity).toBe("high")
		expect(
			match("payment_failed", { subscriptions: [{}], openInvoices: [overdue(16)] }).evidence.step,
		).toBe(1)
		expect(match("payment_failed", { subscriptions: [{ status: "unpaid" }] }).evidence.step).toBe(2)
		expect(match("payment_failed", { subscriptions: [{ status: "past_due" }] }).evidence).toMatchObject({
			subscriptionStatus: "past_due",
			amountMinor: 19_900,
		})
	})

	it("cancel_scheduled: cancel at period end, or a recent downgrade", () => {
		const ends = (days: number) => new Date(NOW.getTime() + days * 86_400_000)
		const found = match("cancel_scheduled", {
			subscriptions: [
				{ cancelAtPeriodEnd: true, currentPeriodEnd: ends(20), cancellationReason: "too_expensive" },
			],
		})
		expect(found.evidence).toMatchObject({
			_tag: "delta",
			unit: "minor",
			from: 19_900,
			to: 0,
			step: 0,
			reason: "too_expensive",
		})
		expect(
			match("cancel_scheduled", {
				subscriptions: [{ cancelAtPeriodEnd: true, currentPeriodEnd: ends(3) }],
			}).evidence.step,
		).toBe(1)
		const downgrade = match("cancel_scheduled", {
			subscriptions: [{}],
			movements: [
				{
					day: addDays(TODAY, -5),
					type: "contraction",
					fromMrrMinor: 79_900,
					toMrrMinor: 19_900,
					deltaMinor: -60_000,
				},
			],
		})
		expect(downgrade.evidence).toMatchObject({ from: 79_900, to: 19_900, reason: "Downgraded" })
		expect(
			run("cancel_scheduled", {
				subscriptions: [{}],
				movements: [{ day: addDays(TODAY, -30), type: "contraction" }],
			}),
		).toEqual({ _tag: "NoMatch", reason: "Below threshold" })
	})

	it("trial_ending_low_activation: trial ends in ≤5 days with < 2 active users", () => {
		const trial = (days: number, activity: FactsInput["activity"] = {}): FactsInput => ({
			account: {
				lifecycleStage: "trialing",
				mrrMinor: 0,
				trialEndsAt: new Date(NOW.getTime() + days * 86_400_000),
			},
			activity,
		})
		const found = match("trial_ending_low_activation", trial(4, { ann: [-1] }))
		expect(found.evidence).toMatchObject({
			_tag: "ratio",
			value: 1,
			target: 2,
			unit: "users",
			daysLeft: 4,
			step: 0,
		})
		expect(match("trial_ending_low_activation", trial(2, { ann: [-1] })).evidence.step).toBe(1)
		expect(match("trial_ending_low_activation", trial(4)).evidence.step).toBe(2)
		expect(run("trial_ending_low_activation", trial(9))._tag).toBe("NoMatch")
		expect(run("trial_ending_low_activation", trial(3, { ann: [-1], bob: [-2] }))._tag).toBe("NoMatch")
	})

	it("onboarding_stalled: 7–30 days old, fewer than 2 contacts ever active", () => {
		const aged = (days: number, input: FactsInput = {}): FactsInput => ({
			...input,
			account: { firstSeenAt: new Date(NOW.getTime() - days * 86_400_000) },
		})
		const found = match("onboarding_stalled", aged(10, { activity: { ann: [-2] }, idle: ["bob", "cat"] }))
		expect(found.evidence).toMatchObject({
			_tag: "ratio",
			value: 1,
			target: 2,
			unit: "contacts",
			ageDays: 10,
			step: 0,
		})
		expect(found.severity).toBe("low")
		expect(match("onboarding_stalled", aged(25, { idle: ["bob"] })).evidence.step).toBe(2)
		expect(run("onboarding_stalled", aged(40, { idle: ["bob"] }))._tag).toBe("NoMatch")
		expect(run("onboarding_stalled", aged(10, { activity: { ann: [-1], bob: [-1] } }))._tag).toBe(
			"NoMatch",
		)
	})

	it("health_drop: −20 points within 7 days, or entered critical", () => {
		const health = (
			before: number,
			now: number,
			status: "healthy" | "at_risk" | "critical" = "at_risk",
		) => ({
			health: [
				{ day: addDays(TODAY, -5), score: before, status: "healthy" as const },
				{ day: TODAY, score: now, status },
			],
		})
		const found = match("health_drop", health(80, 55))
		expect(found.evidence).toMatchObject({ _tag: "delta", unit: "points", from: 80, to: 55, step: 0 })
		expect(match("health_drop", health(90, 50)).evidence.step).toBe(1)
		expect(run("health_drop", health(70, 60))._tag).toBe("NoMatch")
		expect(match("health_drop", health(38, 35, "critical")).reason).toContain("now critical")
		// Entered critical: a new account first scored critical has not.
		expect(run("health_drop", { health: [{ day: TODAY, score: 35, status: "critical" }] })).toEqual({
			_tag: "NoMatch",
			reason: "Below threshold",
		})
		expect(run("health_drop", {})).toEqual({ _tag: "NoMatch", reason: "No data" })
	})

	it("champion_inactive: the most active user of the window before went quiet 14+ days", () => {
		const found = match("champion_inactive", {
			activity: { ann: range(-40, -16), bob: [-30, -20, -2] },
		})
		expect(found.evidence).toMatchObject({
			_tag: "last_active",
			contactName: "ann",
			daysInactive: 16,
			step: 0,
		})
		expect(found.reason).toBe("ann, the most active user, inactive for 16 days")
		expect(run("champion_inactive", { activity: { ann: range(-40, -1), bob: [-30] } })._tag).toBe(
			"NoMatch",
		)
	})

	it("near_limit: a metered metric at ≥90% of its plan limit (opportunity)", () => {
		const metric = (value: number, limit: number | null = 1000) =>
			new Map([["api_calls", [{ day: TODAY, value, limitValue: limit }]]])
		const found = match(
			"near_limit",
			{ metrics: metric(950) },
			orgFacts({ metricNames: new Map([["api_calls", "API calls"]]) }),
		)
		expect(found.evidence).toMatchObject({
			_tag: "limit",
			metricKey: "api_calls",
			metricName: "API calls",
			pct: 95,
			step: 0,
		})
		expect(match("near_limit", { metrics: metric(1250) }).evidence.step).toBe(2)
		expect(run("near_limit", { metrics: metric(500) })).toEqual({
			_tag: "NoMatch",
			reason: "Below threshold",
		})
		expect(run("near_limit", { metrics: metric(950, null) })).toEqual({
			_tag: "NoMatch",
			reason: "No data",
		})
		// Autumn is its source.
		expect(
			run("near_limit", { metrics: metric(950) }, orgFacts({ connected: new Set(["clerk"]) })),
		).toEqual({
			_tag: "NoMatch",
			reason: "Missing data source",
		})
	})

	it("seat_growth: active users +50% over 30 days, from at least 3", () => {
		const found = match("seat_growth", {
			activity: { a: [-40, -3], b: [-45, -2], c: [-50, -1], d: [-1], e: [-5] },
		})
		expect(found.evidence).toMatchObject({ _tag: "delta", unit: "users", from: 3, to: 5, step: 0 })
		expect(run("seat_growth", { activity: { a: [-40, -1], b: [-45, -1], c: [-50, -1] } })._tag).toBe(
			"NoMatch",
		)
		expect(run("seat_growth", { activity: { a: [-40], b: [-1], c: [-1], d: [-1] } })._tag).toBe("NoMatch")
		// A zero baseline never grows by a percentage, even with no minimum.
		const config = defaults("seat_growth")
		if (config._tag !== "seat_growth") throw new Error("seat_growth defaults")
		const growth = (input: FactsInput) =>
			evaluate(ruleOf({ ...config, minActiveUsers: 0 }), factsOf(input), orgFacts())
		expect(growth({})).toEqual({ _tag: "NoMatch", reason: "No data" })
		expect(growth({ activity: { a: [-1], b: [-2] } })).toEqual({
			_tag: "NoMatch",
			reason: "Below threshold",
		})
	})

	it("skips churned accounts, out-of-scope accounts and missing sources", () => {
		const quiet: FactsInput = { activity: { ann: [-20] }, priorActive: [[30, 2]] }
		expect(run("inactive", { ...quiet, account: { lifecycleStage: "churned" } })).toEqual({
			_tag: "NoMatch",
			reason: "Churned",
		})
		const scoped = evaluate(
			ruleOf(defaults("inactive"), { scope: { planNames: ["Enterprise"] } }),
			factsOf(quiet),
			orgFacts(),
		)
		expect(scoped).toEqual({ _tag: "NoMatch", reason: "Out of scope" })
		expect(
			evaluate(
				ruleOf(defaults("inactive"), { scope: { payingOnly: true } }),
				factsOf({ ...quiet, account: { mrrMinor: 0, lifecycleStage: "lead" } }),
				orgFacts(),
			),
		).toEqual({ _tag: "NoMatch", reason: "Out of scope" })
		// Billed on usage at MRR 0: paying.
		expect(
			evaluate(
				ruleOf(defaults("inactive"), { scope: { payingOnly: true } }),
				factsOf({
					...quiet,
					account: { mrrMinor: 0, lifecycleStage: "active" },
					subscriptions: [{ mrrMinor: 0, billsByUsage: true }],
				}),
				orgFacts(),
			)._tag,
		).toBe("Match")
		expect(run("inactive", quiet, orgFacts({ connected: new Set(["stripe"]) }))).toEqual({
			_tag: "NoMatch",
			reason: "Missing data source",
		})
		// A renamed rule titles its signals; a rule's severity is the floor.
		const renamed = evaluate(
			ruleOf(defaults("inactive"), { name: "Gone dark", severity: "high" }),
			factsOf(quiet),
			orgFacts(),
		)
		expect(renamed).toMatchObject({ _tag: "Match", title: "Gone dark", severity: "high" })
	})
})
