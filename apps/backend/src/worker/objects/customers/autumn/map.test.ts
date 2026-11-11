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
	isEntityScoped,
	metricKeyOf,
	plansById,
	statusOf,
	subscriptionMrr,
	subscriptionOps,
	usageEventOp,
} from "./map"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_INITECH,
	CUSTOMER_PERSONAL,
	FEATURES,
	LIMIT_REACHED_MESSAGES,
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

	it("reads a cancellation beside a scheduled base plan as a downgrade, not a cancel", () => {
		const [current] = subOps([SUB_ACME_CANCELING, SUB_ACME_SCHEDULED])
		expect(current).toMatchObject({ status: "active", cancelAtPeriodEnd: false, canceledAt: null })
		// A scheduled add-on replaces nothing.
		const [canceling] = subOps([SUB_ACME_CANCELING, { ...SUB_ACME_SCHEDULED, add_on: true }])
		expect(canceling).toMatchObject({ cancelAtPeriodEnd: true })
	})

	it("bills a trial that lapsed unconverted nothing, so its account is no churned customer", () => {
		expect(subOp(SUB_GLOBEX_LAPSED)).toMatchObject({ status: "canceled", mrrMinor: 0 })
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
