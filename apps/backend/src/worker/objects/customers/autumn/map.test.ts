/**
 * The pure mapping: which account an Autumn customer lands on, the MRR normalization (a month, a
 * year, a quantity, prepaid units, a free plan, a zero-decimal currency), the plan states Hazel
 * records and the ones it skips, and what a feature balance becomes as a metric and a plan limit.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import {
	accountOp,
	balanceOps,
	billingIntervalOf,
	customerOps,
	featureDefinitionOps,
	historyStartOf,
	isEntityScoped,
	metricKeyOf,
	plansById,
	statusOf,
	subscriptionMrr,
	subscriptionOps,
	usageEventOp,
	usageHistoryOps,
} from "./map"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_INITECH,
	CUSTOMER_PERSONAL,
	FEATURES,
	LIMIT_REACHED_MESSAGES,
	MS,
	ORG_ACME,
	PLAN_ENTERPRISE,
	PLAN_FREE,
	PLAN_PRO,
	PLAN_PRO_V1,
	PLAN_TEAM,
	SUB_ACME,
	SUB_ACME_CANCELING,
	SUB_ACME_ENTITY,
	SUB_ACME_EXPIRED,
	SUB_ACME_PAST_DUE,
	SUB_ACME_SCHEDULED,
	SUB_GLOBEX_LAPSED,
	SUB_GLOBEX_TRIAL,
	SUB_INITECH,
	USAGE_ALERT_MESSAGES,
} from "./fixtures"
import { AutumnBalanceEvent, AutumnCustomer, AutumnPlan, AutumnSubscription } from "./wire"

const CONFIG: ConnectionConfig = { _tag: "autumn", customerIdIsClerkOrgId: true }
const BY_DOMAIN: ConnectionConfig = { _tag: "autumn", customerIdIsClerkOrgId: false }

const customer = Schema.decodeUnknownSync(AutumnCustomer)
const subscription = Schema.decodeUnknownSync(AutumnSubscription)
const plan = Schema.decodeUnknownSync(AutumnPlan)
const balanceEvent = Schema.decodeUnknownSync(AutumnBalanceEvent)

const PLANS = plansById(
	[PLAN_PRO, PLAN_PRO_V1, PLAN_ENTERPRISE, PLAN_FREE, PLAN_TEAM].map((row) => plan(row)),
)
const AT = new Date("2026-11-10T12:00:00.000Z")
const OBSERVED = "2026-11-10T12:00:00.000Z"

const DAY = 86_400_000

const named = (row: unknown) => {
	const decoded = customer(row)
	return { ...decoded, id: decoded.id ?? "" }
}

const subOps = (rows: ReadonlyArray<unknown>, options: { currency?: string; customer?: unknown } = {}) =>
	subscriptionOps(
		rows.map((row) => subscription(row)),
		{
			pricing: { plans: PLANS, currency: options.currency ?? "usd" },
			balances:
				options.customer === undefined ? [] : Object.values(named(options.customer).balances ?? {}),
			observedAt: OBSERVED,
		},
	)

const subOp = (row: unknown, currency = "usd") => subOps([row], { currency })[0] ?? null

const ACME_SUB = `${ORG_ACME}:${SUB_ACME.id}`

describe("Autumn customer → account", () => {
	it("places a customer by the Clerk organization id its own id is", () => {
		expect(accountOp(named(CUSTOMER_ACME), CONFIG, "live", OBSERVED)).toEqual({
			_tag: "account",
			externalId: ORG_ACME,
			externalUrl: `https://app.useautumn.com/customers/${ORG_ACME}`,
			sameAs: [{ provider: "clerk", externalId: ORG_ACME }],
			onNoMatch: "unmatched",
			name: "Acme Analytics",
			// Autumn outranks Clerk's member count: the seat pool is what the customer pays for.
			seatsUsed: 12,
			seatsLimit: 25,
			createdAt: "2026-01-14T09:20:00.000Z",
			observedAt: OBSERVED,
		})
	})

	it("sends the email's domain as a match key only when the id is not a shared one", () => {
		// With the shared id on, a billing email never teaches the account a domain.
		expect(accountOp(named(CUSTOMER_ACME), CONFIG, "live")).not.toHaveProperty("domains")
		const byDomain = accountOp(named(CUSTOMER_ACME), BY_DOMAIN, "live")
		expect(byDomain).toMatchObject({ sameAs: [], domains: ["acme.com"], matchByDomain: true })
		// Ingest drops free-mail domains; a customer with no email sends none at all.
		expect(accountOp(named(CUSTOMER_PERSONAL), BY_DOMAIN, "live")).toMatchObject({
			domains: ["gmail.com"],
		})
		expect(accountOp(named(CUSTOMER_GLOBEX), BY_DOMAIN, "live")).not.toHaveProperty("domains")
	})

	it("leaves absent fields alone, and links a sandbox record to the sandbox dashboard", () => {
		const op = accountOp(named(CUSTOMER_GLOBEX), CONFIG, "sandbox", OBSERVED)
		// No name and no licenses: nothing another source established is cleared.
		expect(op).not.toHaveProperty("name")
		expect(op).not.toHaveProperty("seatsUsed")
		expect(op.externalUrl).toBe(`https://app.useautumn.com/sandbox/customers/${CUSTOMER_GLOBEX.id}`)
	})
})

describe("Autumn plan → subscription", () => {
	it("normalizes a monthly plan's amount to minor units", () => {
		expect(subOp(SUB_ACME)).toEqual({
			_tag: "subscription",
			// Autumn's id is unique per customer only.
			externalId: ACME_SUB,
			account: { provider: "autumn", externalId: ORG_ACME },
			planName: "Pro",
			status: "active",
			mrrMinor: 9_900,
			listMrrMinor: 9_900,
			// The base price is in the MRR: its usage overage does not make it usage-billed.
			billsByUsage: false,
			currency: "usd",
			interval: "month",
			quantity: 1,
			startedAt: "2026-01-14T09:20:00.000Z",
			trialEndsAt: null,
			currentPeriodEnd: "2026-12-01T09:20:00.000Z",
			cancelAtPeriodEnd: false,
			canceledAt: null,
			observedAt: OBSERVED,
		})
	})

	it("spreads a yearly plan over twelve months and multiplies by the quantity", () => {
		// $12 000 a year × 3 = $3 000 a month.
		expect(subOp(SUB_GLOBEX_TRIAL)).toMatchObject({
			planName: "Enterprise",
			status: "trialing",
			trialEndsAt: "2026-11-19T11:30:00.000Z",
			mrrMinor: 300_000,
			interval: "year",
			quantity: 3,
		})
	})

	it("counts a zero-decimal currency's amount as it stands", () => {
		// ¥99 a month is 99 minor units, not 9 900.
		expect(subOp(SUB_ACME, "jpy")).toMatchObject({ mrrMinor: 99, currency: "jpy" })
		// A three-decimal currency is thousandths.
		expect(subOp(SUB_ACME, "kwd")).toMatchObject({ mrrMinor: 99_000 })
	})

	it("reads the plan states Hazel records, and skips the ones it does not", () => {
		expect(subOp(SUB_ACME_PAST_DUE)).toMatchObject({ status: "past_due" })
		expect(subOp(SUB_ACME_CANCELING)).toMatchObject({
			status: "active",
			cancelAtPeriodEnd: true,
			canceledAt: "2026-11-08T16:00:00.000Z",
		})
		// Ended: recorded as canceled, so the account's MRR can drop.
		expect(subOp(SUB_ACME_EXPIRED)).toMatchObject({
			status: "canceled",
			cancelAtPeriodEnd: false,
			canceledAt: "2026-01-14T09:20:00.000Z",
			// The free plan it ended on bills nothing.
			mrrMinor: 0,
			planName: "Free",
		})
		// Not billing yet, and a sub-customer's plan is not the account's.
		expect(subOp(SUB_ACME_SCHEDULED)).toBeNull()
		expect(subOp(SUB_ACME_ENTITY)).toBeNull()
		expect(isEntityScoped(subscription(SUB_ACME_ENTITY))).toBe(true)
		expect(statusOf(subscription(SUB_ACME_SCHEDULED))).toBeNull()
	})

	it("names a plan Autumn did not return by its id, and bills it nothing", () => {
		const [unknownPlan] = subscriptionOps([subscription(SUB_ACME)], {
			pricing: { plans: new Map(), currency: "usd" },
			observedAt: OBSERVED,
		})
		expect(unknownPlan).toMatchObject({ planName: "pro", mrrMinor: 0, interval: "other" })
	})

	it("prefers the plan's active version, and prices a one-off cadence as nothing", () => {
		// The archived v1 is $79; the active v2 is $99.
		expect(PLANS.get("pro")?.price?.amount).toBe(99)
		expect(plansById([plan(PLAN_PRO_V1)]).get("pro")?.price?.amount).toBe(79)
		const oneOff = plan({ ...PLAN_PRO, price: { amount: 500, interval: "one_off" } })
		expect(subscriptionMrr(subscription(SUB_ACME), oneOff, "usd")).toBe(0)
		expect(billingIntervalOf(oneOff)).toBe("other")
	})

	it("prices the customer's own version of the plan when the read expanded it", () => {
		// A custom price: $49 for this customer, whatever the catalog says.
		const custom = { ...SUB_ACME, plan: { ...PLAN_PRO, price: { amount: 49, interval: "month" } } }
		expect(subOp(custom)).toMatchObject({ mrrMinor: 4_900, listMrrMinor: 4_900, planName: "Pro" })
	})

	it("adds the prepaid units bought on top of a plan, never the usage billed after it", () => {
		// $20 base + 5 seats × $10.
		expect(subOps([SUB_INITECH], { customer: CUSTOMER_INITECH })).toMatchObject([
			{ externalId: `${SUB_INITECH.customer_id}:main`, planName: "Team", mrrMinor: 7_000 },
		])
		// Pro's messages overage is `usage_based`: not knowable in advance.
		expect(subOps([SUB_ACME], { customer: CUSTOMER_ACME })).toMatchObject([{ mrrMinor: 9_900 }])
		// A grant of another plan, or a sub-customer's, is not this plan's.
		const seats = named(CUSTOMER_INITECH).balances?.["seats"]
		const elsewhere = [
			{ ...seats!, breakdown: seats!.breakdown!.map((grant) => ({ ...grant, plan_id: "pro" })) },
			{ ...seats!, breakdown: seats!.breakdown!.map((grant) => ({ ...grant, source: "entity" })) },
		]
		expect(subscriptionMrr(subscription(SUB_INITECH), PLANS.get("team"), "usd", elsewhere)).toBe(2_000)
	})

	it("marks a plan billed only by usage, or by tiered prepaid units, as billsByUsage", () => {
		// No base price: only Pro's `usage_based` messages bill.
		const usageOnly = { ...PLAN_PRO, price: null }
		expect(subOp({ ...SUB_ACME, plan: usageOnly })).toMatchObject({ mrrMinor: 0, billsByUsage: true })
		// Once ended, it was billed: still marked (its account churned rather than a lead).
		const ended = {
			...SUB_ACME_EXPIRED,
			current_period_end: SUB_ACME.current_period_end,
			plan: usageOnly,
		}
		expect(subOp(ended)).toMatchObject({
			status: "canceled",
			billsByUsage: true,
		})
		// A trial that lapsed unconverted was never billed.
		expect(subOp({ ...SUB_GLOBEX_LAPSED, plan: usageOnly })).toMatchObject({ billsByUsage: false })
		// A free plan bills nothing.
		expect(subOp({ ...SUB_ACME, plan: PLAN_FREE })).toMatchObject({ mrrMinor: 0, billsByUsage: false })
		// Seats bought at a tiered price (no flat amount) on a plan with no base price.
		const seats = named(CUSTOMER_INITECH).balances?.["seats"]
		const tiered = {
			...CUSTOMER_INITECH,
			balances: {
				seats: {
					...seats!,
					breakdown: seats!.breakdown!.map((grant) => ({
						...grant,
						price: { ...grant.price, amount: null },
					})),
				},
			},
		}
		expect(
			subOps([{ ...SUB_INITECH, plan: { ...PLAN_TEAM, price: null } }], { customer: tiered }),
		).toMatchObject([{ mrrMinor: 0, billsByUsage: true }])
		expect(subOps([{ ...SUB_INITECH, plan: { ...PLAN_TEAM, price: null } }])).toMatchObject([
			{ mrrMinor: 0, billsByUsage: false },
		])
	})

	it("reads a cancellation beside a scheduled paid base plan of its group as a downgrade, not a cancel", () => {
		const team = { ...SUB_ACME_SCHEDULED, plan_id: "team", auto_enable: false }
		const [current] = subOps([SUB_ACME_CANCELING, team])
		expect(current).toMatchObject({ status: "active", cancelAtPeriodEnd: false, canceledAt: null })
		const canceling = (scheduled: unknown) => subOps([SUB_ACME_CANCELING, scheduled])[0]
		// The free plan Autumn schedules when a plan is canceled (its group's `auto_enable` one).
		expect(canceling(SUB_ACME_SCHEDULED)).toMatchObject({ cancelAtPeriodEnd: true })
		// A free plan is no downgrade target even when not auto-enabled.
		expect(canceling({ ...SUB_ACME_SCHEDULED, auto_enable: false })).toMatchObject({
			cancelAtPeriodEnd: true,
		})
		// A scheduled add-on replaces nothing, nor does a plan of another group.
		expect(canceling({ ...team, add_on: true })).toMatchObject({ cancelAtPeriodEnd: true })
		expect(canceling({ ...team, plan: { ...PLAN_TEAM, group: "storage" } })).toMatchObject({
			cancelAtPeriodEnd: true,
		})
		// A plan billing only prepaid units (flat or tiered) is paid, though balances price them later.
		const seatsOnly = { ...PLAN_TEAM, price: null }
		const tiered = {
			...seatsOnly,
			items: PLAN_TEAM.items.map((item) => ({ ...item, price: { ...item.price, amount: null } })),
		}
		for (const target of [seatsOnly, tiered]) {
			expect(canceling({ ...team, plan: target })).toMatchObject({ cancelAtPeriodEnd: false })
		}
		// One-off packs on a free plan are no recurring price: the plan is canceling.
		const packs = {
			...seatsOnly,
			items: PLAN_TEAM.items.map((item) => ({
				...item,
				price: { ...item.price, interval: "one_off" },
			})),
		}
		expect(canceling({ ...team, plan: packs })).toMatchObject({ cancelAtPeriodEnd: true })
	})

	it("splits a plan's prepaid units over the customer's live plans on it, and gives an ended one none", () => {
		const second = { ...SUB_INITECH, id: "second" }
		// $20 base each, the 5 seats × $10 split between the two.
		expect(
			subOps([SUB_INITECH, second], { customer: CUSTOMER_INITECH }).map((op) => op.mrrMinor),
		).toEqual([4_500, 4_500])
		const ended = {
			...SUB_INITECH,
			id: "old",
			status: "expired",
			canceled_at: SUB_ACME_EXPIRED.canceled_at,
		}
		expect(subOps([SUB_INITECH, ended], { customer: CUSTOMER_INITECH }).map((op) => op.mrrMinor)).toEqual(
			[7_000, 2_000],
		)
	})

	it("bills a trial that lapsed unconverted nothing, so its account is no churned customer", () => {
		expect(subOp(SUB_GLOBEX_LAPSED)).toMatchObject({ status: "canceled", mrrMinor: 0 })
		// Still live past a card-less trial Autumn has not converted yet: no billing period, no trial left.
		const lapsing = {
			...SUB_GLOBEX_TRIAL,
			trial_ends_at: null,
			current_period_start: null,
			current_period_end: null,
		}
		const trialPlan = { ...PLAN_ENTERPRISE, free_trial: { duration_length: 14, card_required: false } }
		expect(subOp({ ...lapsing, plan: trialPlan })).toMatchObject({
			status: "active",
			mrrMinor: 0,
			billsByUsage: false,
		})
		// A plan without a trial billed outside Stripe (`no_billing_changes`) keeps its price.
		expect(subOp(lapsing)).toMatchObject({ status: "active", mrrMinor: 300_000 })
	})

	it("bills a card trial canceled before it converted nothing, from the plan's trial terms", () => {
		// Autumn clears `trial_ends_at` once the trial is over; the billing period was the trial's.
		const trialPlan = { ...PLAN_ENTERPRISE, free_trial: { duration_length: 14, duration_type: "day" } }
		const started = SUB_GLOBEX_TRIAL.started_at
		const canceled = {
			...SUB_GLOBEX_TRIAL,
			plan: trialPlan,
			status: "expired",
			trial_ends_at: null,
			canceled_at: started + 3 * DAY,
			expires_at: SUB_GLOBEX_TRIAL.current_period_end + 10 * 60_000,
		}
		expect(subOp(canceled)).toMatchObject({
			status: "canceled",
			mrrMinor: 0,
			billsByUsage: false,
			trialEndsAt: new Date(started + 14 * DAY + 70 * 60_000).toISOString(),
		})
		// A month's trial ends on the calendar: Jan 31 + 1 month is Feb 28, not 31 days later.
		const monthStart = Date.UTC(2026, 0, 31, 12)
		const monthTrial = {
			...canceled,
			plan: { ...PLAN_ENTERPRISE, free_trial: { duration_length: 1, duration_type: "month" } },
			started_at: monthStart,
			canceled_at: monthStart + DAY,
			current_period_end: Date.UTC(2026, 1, 28, 12, 10),
			expires_at: Date.UTC(2026, 1, 28, 12, 10),
		}
		expect(subOp(monthTrial)).toMatchObject({
			mrrMinor: 0,
			trialEndsAt: new Date(Date.UTC(2026, 1, 28, 13, 10)).toISOString(),
		})
		const pastTrial = { ...monthTrial, expires_at: Date.UTC(2026, 2, 2, 12) }
		expect(subOp(pastTrial)).toMatchObject({ mrrMinor: 300_000, trialEndsAt: null })
		// Billed past its trial, then canceled: a paid plan that ended.
		const converted = {
			...canceled,
			current_period_end: started + 44 * DAY,
			expires_at: started + 44 * DAY,
		}
		expect(subOp(converted)).toMatchObject({ status: "canceled", mrrMinor: 300_000, trialEndsAt: null })
	})

	it("keeps a converted trial's end, which Autumn cleared, from its billing period or trial terms", () => {
		const trialPlan = { ...PLAN_ENTERPRISE, free_trial: { duration_length: 14, duration_type: "day" } }
		const started = SUB_GLOBEX_TRIAL.started_at
		const converted = {
			...SUB_GLOBEX_TRIAL,
			plan: trialPlan,
			trial_ends_at: null,
			current_period_start: started + 14 * DAY + 10 * 60_000,
			current_period_end: started + 44 * DAY + 10 * 60_000,
		}
		// Its first paid period starts at the trial's end.
		expect(subOp(converted)).toMatchObject({
			status: "active",
			mrrMinor: 300_000,
			trialEndsAt: new Date(started + 14 * DAY + 10 * 60_000).toISOString(),
		})
		// Renewed since: the end from the trial terms.
		const renewed = {
			...converted,
			current_period_start: started + 44 * DAY,
			current_period_end: started + 74 * DAY,
		}
		expect(subOp(renewed)).toMatchObject({
			trialEndsAt: new Date(started + 14 * DAY + 70 * 60_000).toISOString(),
		})
		// Still in its first period (no trial given), or a plan without a trial: none.
		expect(subOp({ ...converted, current_period_start: started })).toMatchObject({ trialEndsAt: null })
		expect(subOp({ ...converted, plan: PLAN_ENTERPRISE })).toMatchObject({ trialEndsAt: null })
	})

	it("sends no MRR for a past_due plan whose prepaid units Autumn's balances leave out", () => {
		const pastDue = { ...SUB_INITECH, past_due: true }
		// Balances carry only active plans' grants unless the org counts past_due ones.
		const [hidden] = subOps([pastDue], { customer: { ...CUSTOMER_INITECH, balances: {} } })
		expect(hidden).toMatchObject({ status: "past_due" })
		expect(hidden).not.toHaveProperty("mrrMinor")
		expect(hidden).not.toHaveProperty("listMrrMinor")
		expect(hidden).not.toHaveProperty("billsByUsage")
		// The org counts them: priced as usual.
		expect(subOps([pastDue], { customer: CUSTOMER_INITECH })).toMatchObject([{ mrrMinor: 7_000 }])
		// A sub-customer's grant of the plan is not the customer's own.
		const { seats } = CUSTOMER_INITECH.balances
		const entityOnly = {
			...CUSTOMER_INITECH,
			balances: {
				seats: {
					...seats,
					breakdown: seats.breakdown.map((grant) => ({ ...grant, source: "entity" })),
				},
			},
		}
		expect(subOps([pastDue], { customer: entityOnly })[0]).not.toHaveProperty("mrrMinor")
		// No prepaid item to hide: Pro's base price is all there is.
		expect(subOp(SUB_ACME_PAST_DUE)).toMatchObject({ status: "past_due", mrrMinor: 9_900 })
		// Held twice, one past_due: the shared pool may lack its grants, so neither holding is priced.
		const pool = subOps([SUB_INITECH, { ...pastDue, id: "second" }], { customer: CUSTOMER_INITECH })
		expect(pool.map((op) => [op.status, "mrrMinor" in op])).toEqual([
			["active", false],
			["past_due", false],
		])
	})

	it("keys an id by its customer, and keeps the live plan when an ended one shares its id", () => {
		const other = { ...SUB_ACME, customer_id: "org_2other" }
		expect(subOps([SUB_ACME, other]).map((op) => op.externalId)).toEqual([
			ACME_SUB,
			`org_2other:${SUB_ACME.id}`,
		])
		const ended = { ...SUB_ACME_EXPIRED, id: SUB_ACME.id }
		expect(subOps([ended, SUB_ACME]).map((op) => [op.externalId, op.status])).toEqual([
			[ACME_SUB, "active"],
		])
		expect(subOps([SUB_ACME, ended]).map((op) => op.status)).toEqual(["active"])
	})

	it("takes the customer id from the row, else from the caller", () => {
		const inline = subscription({ ...SUB_ACME, customer_id: null })
		const pricing = { plans: PLANS, currency: "usd" }
		expect(
			subscriptionOps([inline], { pricing, customerId: ORG_ACME, observedAt: OBSERVED }),
		).toMatchObject([{ account: { provider: "autumn", externalId: ORG_ACME } }])
		expect(subscriptionOps([inline], { pricing, observedAt: OBSERVED })).toEqual([])
	})
})

describe("Autumn balance → metric", () => {
	it("writes the period's usage with the granted amount as its limit", () => {
		expect(balanceOps(named(CUSTOMER_ACME), { at: AT })).toEqual([
			{
				_tag: "metric_definition",
				key: "autumn.messages",
				name: "Messages",
				unit: null,
				aggregation: "max",
				description: null,
			},
			{
				_tag: "metric",
				account: { provider: "autumn", externalId: ORG_ACME },
				metricKey: "autumn.messages",
				day: "2026-11-10",
				value: 8_200,
				limitValue: 10_000,
			},
			{
				_tag: "metric_definition",
				key: "autumn.seats",
				name: "Seats",
				unit: null,
				aggregation: "max",
				description: null,
			},
			{
				_tag: "metric",
				account: { provider: "autumn", externalId: ORG_ACME },
				metricKey: "autumn.seats",
				day: "2026-11-10",
				value: 12,
				limitValue: 25,
			},
		])
	})

	it("gives an unlimited feature no limit to be near", () => {
		expect(balanceOps(named(CUSTOMER_GLOBEX), { at: AT })).toMatchObject([
			{ _tag: "metric_definition", key: "autumn.messages" },
			{ _tag: "metric", value: 1_000, limitValue: null },
		])
	})

	it("namespaces every key, so no other provider's metric collides", () => {
		expect(metricKeyOf("messages")).toBe("autumn.messages")
		expect(featureDefinitionOps(FEATURES).map((op) => [op.key, op.name])).toEqual([
			["autumn.messages", "Messages"],
			["autumn.seats", "Seats"],
		])
	})

	it("puts the account before its usage, so a metric never names an account that is not there", () => {
		const ops = customerOps(named(CUSTOMER_ACME), {
			config: CONFIG,
			env: "live",
			at: AT,
			observedAt: OBSERVED,
		})
		expect(ops.map((op) => op._tag)).toEqual([
			"account",
			"metric_definition",
			"metric",
			"metric_definition",
			"metric",
		])
	})
})

describe("Autumn usage events", () => {
	it("records a limit reached and a usage alert, deduped on the delivery", () => {
		expect(
			usageEventOp(balanceEvent(LIMIT_REACHED_MESSAGES.data), {
				kind: "limit_reached",
				deliveryId: "msg_2abc",
				occurredAt: OBSERVED,
				names: new Map([["messages", "Messages"]]),
			}),
		).toEqual({
			_tag: "event",
			externalId: "limit_reached:msg_2abc",
			account: { provider: "autumn", externalId: ORG_ACME },
			type: "usage.limit_reached",
			title: "Messages reached its included allowance",
			data: { featureId: "messages", metricKey: "autumn.messages", limitType: "included" },
			occurredAt: OBSERVED,
		})
		expect(
			usageEventOp(balanceEvent(USAGE_ALERT_MESSAGES.data), {
				kind: "usage_alert",
				deliveryId: "msg_2def",
				occurredAt: OBSERVED,
			}),
		).toMatchObject({
			type: "usage.limit_approaching",
			title: "messages crossed the 80% usage alert",
			data: { threshold: 80, thresholdType: "usage_percentage" },
		})
	})
})

describe("Autumn usage history", () => {
	const acme = { ...Schema.decodeUnknownSync(AutumnCustomer)(CUSTOMER_ACME), id: ORG_ACME }
	const window = { from: "2026-10-25", today: "2026-11-11" }
	const used = new Map([
		[
			"messages",
			new Map([
				// The period before (from Oct 1, the reset stepped back a month from Nov 1).
				["2026-10-01", 100],
				["2026-10-26", 50],
				["2026-10-31", 30],
				// The current one, from the Nov 1 reset: today's usage is 8,200.
				["2026-11-01", 200],
				["2026-11-10", 300],
				["2026-11-11", 400],
			]),
		],
		["seats", new Map([["2026-11-05", 2]])],
	])
	const series = (key: string, ops: ReturnType<typeof usageHistoryOps>) =>
		Object.fromEntries(
			ops.flatMap((op) => (op._tag === "metric" && op.metricKey === key ? [[op.day, op.value]] : [])),
		)

	it("reads events from the start of the day the oldest period in the window began", () => {
		expect(historyStartOf(acme, window.from)).toBe(MS("2026-10-01T00:00:00.000Z"))
	})

	it("rebuilds each past day's level: back from today's usage, then forward from earlier resets", () => {
		const ops = usageHistoryOps(acme, used, window)
		const messages = series(metricKeyOf("messages"), ops)
		expect(messages).toMatchObject({
			"2026-10-25": 100,
			"2026-10-26": 150,
			"2026-10-30": 150,
			"2026-10-31": 180,
			"2026-11-01": 7_500,
			"2026-11-09": 7_500,
			"2026-11-10": 7_800,
		})
		// Today is the balance's own, never rebuilt; nothing before the window.
		expect(messages["2026-11-11"]).toBeUndefined()
		expect(Object.keys(messages)).toHaveLength(17)
		// A balance that never resets is today's level less what came after.
		expect(series(metricKeyOf("seats"), ops)).toMatchObject({
			"2026-10-25": 10,
			"2026-11-04": 10,
			"2026-11-05": 12,
			"2026-11-10": 12,
		})
		// A past day's plan is not known: no limit, so the stored one stays.
		expect(ops.every((op) => op._tag === "metric" && op.limitValue === undefined)).toBe(true)
	})

	it("starts at the customer's creation, and never goes below zero", () => {
		const globex = { ...Schema.decodeUnknownSync(AutumnCustomer)(CUSTOMER_GLOBEX), id: "org_globex" }
		const ops = usageHistoryOps(globex, new Map([["messages", new Map([["2026-11-08", 5_000]])]]), window)
		expect(series(metricKeyOf("messages"), ops)).toEqual({
			"2026-11-05": 0,
			"2026-11-06": 0,
			"2026-11-07": 0,
			"2026-11-08": 1_000,
			"2026-11-09": 1_000,
			"2026-11-10": 1_000,
		})
	})
})
