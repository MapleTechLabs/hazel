/**
 * Signal evaluation per template (`./evaluate.ts`): each fires on its condition, stays quiet below
 * it, escalates by evidence step, and honours scope, sources and churn.
 */
import {
	DEFAULT_SLA_POLICY,
	type RuleConfig,
	type SignalSeverity,
	type SlaPriority,
	TEMPLATES,
} from "@hazel/domain/customers"
import type { CustomerIssueId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { evaluate, type Match, type RuleInput } from "./evaluate"
import { formatMoney, metricSeries } from "./facts"
import { billingProviderOf } from "./snapshot"
import type { IssueSlaFacts } from "./facts"
import { factsOf, type FactsInput, NOW, orgFacts, TODAY, uuid } from "./test-kit"
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

	it("usage_drop on a metric whose source stopped delivering waits for it, not a 100% drop", () => {
		const config = defaults("usage_drop")
		if (config._tag !== "usage_drop") throw new Error("usage_drop defaults")
		const rule = ruleOf({ ...config, metricKey: "requests" })
		const facts = factsOf({
			metrics: new Map([
				[
					"requests",
					range(-35, -8).map((offset) => ({
						day: addDays(TODAY, offset),
						value: 100,
						limitValue: null,
					})),
				],
			]),
		})
		expect(evaluate(rule, facts, orgFacts())._tag).toBe("Match")
		expect(evaluate(rule, facts, orgFacts({ staleMetrics: new Set(["requests"]) }))).toEqual({
			_tag: "NoMatch",
			reason: "Missing data source",
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
		expect(billingProviderOf(false, both, null)).toBe("stripe")
		expect(billingProviderOf(true, both, "stripe")).toBe("autumn")
		// Unknown to Autumn, or billed in Stripe outside it.
		expect(billingProviderOf(true, subs({ provider: "stripe" }), null)).toBe("stripe")
		// Autumn bills only on a billed paying subscription: a free plan or a trial leaves Stripe's.
		const free = { provider: "autumn", mrrMinor: 0 } as const
		const trial = { provider: "autumn", status: "trialing" } as const
		const ended = { provider: "autumn", status: "canceled" } as const
		expect(billingProviderOf(true, subs({ provider: "stripe" }, free), "autumn")).toBe("stripe")
		expect(billingProviderOf(true, subs({ provider: "stripe" }, trial), null)).toBe("stripe")
		expect(billingProviderOf(true, subs({ provider: "stripe" }, free, ended), "autumn")).toBe("stripe")
		const usage = { provider: "autumn", mrrMinor: 0, billsByUsage: true } as const
		expect(billingProviderOf(true, subs({ provider: "stripe" }, usage), "stripe")).toBe("autumn")
		expect(
			billingProviderOf(
				true,
				subs({ provider: "stripe" }, { provider: "autumn", status: "past_due" }),
				null,
			),
		).toBe("autumn")
		// Neither billing now: the stored source; without one, the one that paid, Stripe's first.
		const stripeEnded = { provider: "stripe", status: "canceled" } as const
		expect(billingProviderOf(true, subs(stripeEnded, trial), "stripe")).toBe("stripe")
		expect(billingProviderOf(true, subs(stripeEnded, ended), "autumn")).toBe("autumn")
		expect(billingProviderOf(true, subs(stripeEnded, ended), null)).toBe("stripe")
		expect(billingProviderOf(true, subs({ ...stripeEnded, mrrMinor: 0 }, ended), null)).toBe("autumn")
		expect(billingProviderOf(true, subs(stripeEnded, free), null)).toBe("stripe")
		// One provider's only: kept while Autumn imports or after a disconnect, never zeroed.
		expect(billingProviderOf(false, subs({ provider: "autumn" }), "stripe")).toBe("autumn")
		expect(billingProviderOf(true, subs(free), null)).toBe("autumn")
		expect(billingProviderOf(true, [], null)).toBe("stripe")
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

	it("near_limit: forecasts the current period's run rate to the billing period end", () => {
		const series = (values: ReadonlyArray<number>, limit = 1000) =>
			new Map([
				[
					"api_calls",
					values.map((value, index) => ({
						day: addDays(TODAY, index - values.length + 1),
						value,
						limitValue: limit,
					})),
				],
			])
		// 10 a day over the last 7 days (an older day is left out): 30 days out with no period end.
		const rising = series([0, 900, 910, 920, 930, 940, 950, 960])
		expect(match("near_limit", { metrics: rising }).evidence).toMatchObject({
			forecast: {
				day: addDays(TODAY, 30),
				periodEnd: false,
				value: 1260,
				pct: 126,
				perDay: 10,
				days: 7,
				limitDay: addDays(TODAY, 4),
			},
		})
		const found = match("near_limit", {
			metrics: rising,
			subscriptions: [{ currentPeriodEnd: new Date(`${addDays(TODAY, 10)}T09:00:00.000Z`) }],
		})
		expect(found.evidence).toMatchObject({
			forecast: { day: addDays(TODAY, 10), periodEnd: true, value: 1060, pct: 106 },
		})
		expect(found.reason).toBe(
			"api_calls at 96% of the plan limit (960 of 1000); on pace for 106% by the period end",
		)
		// A period ending later today is the horizon; one already past is not.
		const ending = (at: Date) =>
			match("near_limit", { metrics: rising, subscriptions: [{ currentPeriodEnd: at }] }).evidence
		expect(ending(new Date(NOW.getTime() + 3_600_000))).toMatchObject({
			forecast: { day: TODAY, periodEnd: true },
		})
		expect(ending(new Date(NOW.getTime() - 3_600_000))).toMatchObject({
			forecast: { periodEnd: false },
		})
		// A crossing far past the horizon is no date (and no out-of-range one).
		expect(
			match("near_limit", { metrics: series([9_499_999_999, 9_500_000_000], 10_000_000_000) }).evidence,
		).toMatchObject({ forecast: { perDay: 1, limitDay: null } })
		// Only the days since the latest reset count; one day is no trend.
		expect(match("near_limit", { metrics: series([90, 99, 92, 94], 100) }).evidence).toMatchObject({
			forecast: { perDay: 2, days: 2 },
		})
		const fresh = match("near_limit", { metrics: series([90, 99, 95], 100) }).evidence
		expect(fresh).toMatchObject({ forecast: null })
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

	it("only covers the customers Needs attention is set to: by stage and by source", () => {
		const quiet: FactsInput = { activity: { ann: [-20] }, priorActive: [[30, 2]] }
		const notCovered = { _tag: "NoMatch", reason: "Not covered by Needs attention" }
		// Signed up through Clerk, never a Stripe customer: not someone to act on.
		expect(run("inactive", { ...quiet, providers: ["clerk"] })).toEqual(notCovered)
		expect(
			run(
				"inactive",
				{ ...quiet, providers: ["clerk"] },
				orgFacts({
					attention: { stages: ["active"], requiredSources: [] },
				}),
			)._tag,
		).toBe("Match")
		expect(
			run(
				"inactive",
				{ ...quiet, providers: ["clerk", "autumn"] },
				orgFacts({
					attention: { stages: ["active"], requiredSources: ["stripe", "autumn"] },
				}),
			)._tag,
		).toBe("Match")
		expect(
			run(
				"inactive",
				{ ...quiet, account: { lifecycleStage: "lead" } },
				orgFacts({
					attention: { stages: ["active", "trialing"], requiredSources: ["stripe"] },
				}),
			),
		).toEqual(notCovered)
	})

	it("churned: the customer's last entry, for the window after it churned", () => {
		const churned = (days: number, input: FactsInput = {}): FactsInput => ({
			account: {
				lifecycleStage: "churned",
				mrrMinor: 0,
				churnedAt: new Date(NOW.getTime() - days * 86_400_000),
			},
			movements: [{ type: "churn", fromMrrMinor: 19_900, toMrrMinor: 0, day: addDays(TODAY, -days) }],
			subscriptions: [
				{
					status: "canceled",
					planName: "Team",
					canceledAt: new Date(NOW.getTime() - days * 86_400_000),
					cancellationReason: "too_expensive",
				},
			],
			...input,
		})
		const found = match("churned", churned(3))
		expect(found.reason).toBe(`Lost ${formatMoney(19_900, "usd")}/mo 3 days ago`)
		expect(found.evidence).toMatchObject({
			_tag: "delta",
			unit: "minor",
			from: 19_900,
			to: 0,
			fromLabel: "Team",
			toLabel: "Churned",
			reason: "too_expensive",
		})
		expect(run("churned", churned(20))).toEqual({ _tag: "NoMatch", reason: "Below threshold" })
		expect(run("churned", {})).toEqual({ _tag: "NoMatch", reason: "Below threshold" })
		// Still needs the source: a churned org that was never in Stripe is not covered.
		expect(run("churned", churned(3, { providers: ["clerk"] }))).toEqual({
			_tag: "NoMatch",
			reason: "Not covered by Needs attention",
		})
		// A scheduled cancellation: requested 29 days ago, ended (the movement) 2 days ago.
		expect(
			match(
				"churned",
				churned(29, {
					movements: [
						{ type: "churn", fromMrrMinor: 19_900, toMrrMinor: 0, day: addDays(TODAY, -2) },
					],
				}),
			).reason,
		).toBe(`Lost ${formatMoney(19_900, "usd")}/mo 2 days ago`)
		// …and before that movement loads: the canceled subscription's period end, 2 days ago.
		const scheduled = match(
			"churned",
			churned(29, {
				movements: [],
				subscriptions: [
					{
						status: "canceled",
						mrrMinor: 19_900,
						cancelAtPeriodEnd: true,
						canceledAt: new Date(NOW.getTime() - 29 * 86_400_000),
						currentPeriodEnd: new Date(NOW.getTime() - 2 * 86_400_000),
					},
				],
			}),
		)
		expect(scheduled.reason).toBe(`Lost ${formatMoney(19_900, "usd")}/mo 2 days ago`)
		expect(scheduled.evidence).toMatchObject({
			effectiveAt: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
		})
		// Canceled at once 30 days ago: the period end Stripe keeps (passed yesterday) is not when it ended.
		expect(
			run(
				"churned",
				churned(30, {
					movements: [],
					subscriptions: [
						{
							status: "canceled",
							mrrMinor: 0,
							billsByUsage: true,
							cancelAtPeriodEnd: false,
							canceledAt: new Date(NOW.getTime() - 30 * 86_400_000),
							currentPeriodEnd: new Date(NOW.getTime() - 86_400_000),
						},
					],
				}),
			),
		).toEqual({ _tag: "NoMatch", reason: "Below threshold" })
		// A past episode's movement is not this churn's; before the movement loads, every
		// subscription canceled that day counts.
		const twoSubs = (days: number) => ({
			status: "canceled" as const,
			canceledAt: new Date(NOW.getTime() - days * 86_400_000),
		})
		expect(
			match(
				"churned",
				churned(3, {
					movements: [
						{ type: "churn", fromMrrMinor: 99_000, toMrrMinor: 0, day: addDays(TODAY, -200) },
					],
					subscriptions: [
						{ ...twoSubs(3), mrrMinor: 10_000 },
						{ ...twoSubs(3), mrrMinor: 5_000 },
					],
				}),
			).evidence,
		).toMatchObject({ from: 15_000 })
		// …only paid ones in the reporting currency: not a trial that never converted, not EUR.
		expect(
			match(
				"churned",
				churned(3, {
					movements: [],
					subscriptions: [
						{ ...twoSubs(3), mrrMinor: 10_000 },
						{
							...twoSubs(3),
							mrrMinor: 50_000,
							trialEndsAt: new Date(NOW.getTime() + 86_400_000),
							currentPeriodEnd: null,
						},
						{ ...twoSubs(3), mrrMinor: 5_000, currency: "eur" },
					],
				}),
			).evidence,
		).toMatchObject({ from: 10_000, currency: "usd" })
		// The compute that sees the churn has not written its movement yet: the series still ends at 0.
		const unseen = match(
			"churned",
			churned(0, {
				movements: [{ type: "new", fromMrrMinor: 0, toMrrMinor: 19_900, day: addDays(TODAY, -60) }],
				subscriptions: [{ ...twoSubs(0), mrrMinor: 19_900 }],
			}),
		).evidence
		if (unseen._tag !== "delta") throw new Error("delta evidence")
		expect(unseen.from).toBe(19_900)
		expect(unseen.series.at(-1)).toEqual({ day: TODAY, value: 0 })
		expect(unseen.series.at(-2)?.value).toBe(19_900)
		// …but not a stage: churn is covered even with no stage picked.
		expect(
			run("churned", churned(3), orgFacts({ attention: { stages: [], requiredSources: ["stripe"] } }))
				._tag,
		).toBe("Match")
	})

	describe("SLA overdue", () => {
		const MIN = 60_000
		/** An open issue; `replyLate` / `resolutionLate`: minutes past due (negative: due later, null: none running). */
		const issue = (
			options: Readonly<{
				title?: string
				priority?: SlaPriority
				replyLate?: number | null
				resolutionLate?: number | null
				replied?: boolean
			}>,
		): IssueSlaFacts => {
			const at = (late: number) => NOW.getTime() - late * MIN
			const replyLate = options.replyLate ?? null
			const resolutionLate = options.resolutionLate ?? null
			return {
				issueId: uuid() as CustomerIssueId,
				title: options.title ?? "Dashboard is broken",
				targets: DEFAULT_SLA_POLICY.targets,
				state: {
					priority: options.priority ?? "medium",
					reply:
						replyLate === null
							? null
							: {
									first: true,
									startedAt: at(replyLate + 240),
									dueAt: at(replyLate),
									warnAt: at(replyLate + 60),
									metAt: options.replied === true ? at(replyLate - 1) : null,
									stoppedAt: null,
									elapsedMs: null,
									warnedAt: null,
									breachedAt: null,
								},
					firstResponse: null,
					resolution: {
						runningSince: resolutionLate === null ? null : at(resolutionLate + 1440),
						consumedMs: 0,
						dueAt: resolutionLate === null ? null : at(resolutionLate),
						warnAt: resolutionLate === null ? null : at(resolutionLate + 360),
						pausedAt: resolutionLate === null ? at(10) : null,
						resolvedAt: null,
						warnedAt: null,
						breachedAt: null,
					},
				},
			}
		}
		const withIssues = (...issues: ReadonlyArray<IssueSlaFacts>): FactsInput => ({
			openIssueSlas: issues,
		})
		const grace = (graceMinutes: number, overrides: Partial<RuleInput> = {}) =>
			ruleOf({ _tag: "response_overdue", graceMinutes }, overrides)

		it("response_overdue: no match without an overdue reply", () => {
			expect(run("response_overdue", {})).toEqual({ _tag: "NoMatch", reason: "No data" })
			expect(run("response_overdue", withIssues(issue({ replyLate: -30 })))).toEqual({
				_tag: "NoMatch",
				reason: "Below threshold",
			})
			// Answered, or only the resolution clock late.
			expect(run("response_overdue", withIssues(issue({ replyLate: 30, replied: true })))._tag).toBe(
				"NoMatch",
			)
			expect(run("response_overdue", withIssues(issue({ resolutionLate: 30 })))._tag).toBe("NoMatch")
		})

		it("response_overdue: the most overdue issue, the count, and the reason", () => {
			const late = issue({ title: "Login fails", replyLate: 80 })
			const found = match("response_overdue", withIssues(issue({ replyLate: 30 }), late, issue({})))
			expect(found.severity).toBe("high")
			expect(found.reason).toBe("2 issues waiting on a reply; the most overdue by 1h 20m")
			expect(found.evidence).toEqual({
				_tag: "overdue",
				step: 0,
				clock: "reply",
				count: 2,
				issueId: late.issueId,
				issueTitle: "Login fails",
				dueAt: new Date(NOW.getTime() - 80 * MIN).toISOString(),
				overdueMs: 80 * MIN,
			})
			expect(match("response_overdue", withIssues(late)).reason).toBe(
				'"Login fails" waiting on a reply, 1h 20m overdue',
			)
		})

		it("response_overdue: overdue by at least the grace", () => {
			const facts = factsOf(withIssues(issue({ replyLate: 30 }), issue({ replyLate: 90 })))
			expect(evaluate(grace(120), facts, orgFacts())).toEqual({
				_tag: "NoMatch",
				reason: "Below threshold",
			})
			const found = evaluate(grace(60), facts, orgFacts())
			expect(found._tag === "Match" && found.evidence).toMatchObject({ count: 1, overdueMs: 90 * MIN })
		})

		it("escalates at 2× and 4× the issue's target", () => {
			const stepOf = (template: "response_overdue" | "resolution_overdue", late: IssueSlaFacts) =>
				evaluate(
					ruleOf(defaults(template), { severity: "low" }),
					factsOf(withIssues(late)),
					orgFacts(),
				)
			// Medium: 4h reply, 24h resolution; urgent: 1h reply.
			expect(stepOf("response_overdue", issue({ replyLate: 479 }))).toMatchObject({ severity: "low" })
			expect(stepOf("response_overdue", issue({ replyLate: 480 }))).toMatchObject({
				severity: "medium",
			})
			expect(stepOf("response_overdue", issue({ replyLate: 960 }))).toMatchObject({ severity: "high" })
			expect(stepOf("response_overdue", issue({ priority: "urgent", replyLate: 240 }))).toMatchObject({
				severity: "high",
			})
			expect(stepOf("resolution_overdue", issue({ resolutionLate: 2 * 1440 }))).toMatchObject({
				severity: "medium",
			})
			expect(
				match("resolution_overdue", withIssues(issue({ resolutionLate: 4 * 1440 }))).evidence.step,
			).toBe(2)
		})

		it("resolution_overdue: a running resolution clock past due, not a paused one", () => {
			expect(run("resolution_overdue", withIssues(issue({ replyLate: 30 })))).toEqual({
				_tag: "NoMatch",
				reason: "Below threshold",
			})
			const found = match(
				"resolution_overdue",
				withIssues(issue({ resolutionLate: 45, replyLate: 10 })),
			)
			expect(found.severity).toBe("medium")
			expect(found.reason).toBe('"Dashboard is broken" past the resolution target, 45m overdue')
			expect(found.evidence).toMatchObject({ _tag: "overdue", clock: "resolution", count: 1 })
		})

		it("covers accounts outside Needs attention, but not churned or out-of-scope ones", () => {
			const lead: FactsInput = {
				...withIssues(issue({ replyLate: 30, resolutionLate: 30 })),
				account: { lifecycleStage: "lead", mrrMinor: 0, tags: ["slack"] },
				providers: ["clerk"],
			}
			const narrow = orgFacts({ attention: { stages: ["active"], requiredSources: ["stripe"] } })
			expect(run("response_overdue", lead, narrow)._tag).toBe("Match")
			expect(run("resolution_overdue", lead, narrow)._tag).toBe("Match")
			// Other templates stay behind the coverage.
			expect(run("health_drop", lead, narrow)).toEqual({
				_tag: "NoMatch",
				reason: "Not covered by Needs attention",
			})
			expect(
				run("response_overdue", { ...lead, account: { ...lead.account, lifecycleStage: "churned" } }),
			).toEqual({ _tag: "NoMatch", reason: "Churned" })
			expect(evaluate(grace(0, { scope: { payingOnly: true } }), factsOf(lead), narrow)).toEqual({
				_tag: "NoMatch",
				reason: "Out of scope",
			})
			expect(evaluate(grace(0, { scope: { tagsAny: ["slack"] } }), factsOf(lead), narrow)._tag).toBe(
				"Match",
			)
		})
	})
})
