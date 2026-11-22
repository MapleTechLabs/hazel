/**
 * The pure account rollup (`rollupAccount`): which subscription names the plan when some plans are
 * add-ons, that add-ons still count for MRR, and MRR and variable MRR from classified billing
 * (`docs/customers/revenue.md`).
 */
import type { schema } from "@hazel/db"
import type {
	CustomerProvider,
	InvoiceLineDoc,
	RevenueRule,
	SubscriptionItemDoc,
} from "@hazel/domain/customers"
import type { CustomerSubscriptionId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { makeRevenueBasis } from "./revenue"
import { rollupAccount } from "./snapshot"
import { factsOf, NOW, TODAY } from "./test-kit"

const rollupOf = (
	subscriptions: ReadonlyArray<Partial<schema.CustomerSubscription>>,
	addOnPlans: ReadonlyArray<string> = [],
) => {
	const facts = factsOf({ subscriptions })
	return rollupAccount({
		account: facts.account,
		subscriptions: facts.subscriptions,
		mrrSource: "autumn",
		addOnPlans,
		revenue: basisOf(),
		invoices: [],
		contacts: facts.contacts,
		activity: facts.activity,
		lastActiveDay: facts.lastActiveDay,
		currency: "usd",
		now: NOW,
		today: TODAY,
	})
}

const BYOK = "Bring Your Own OpenRouter Key"

describe("account rollup", () => {
	it("names a named add-on over an unnamed subscription", () => {
		const rollup = rollupOf(
			[
				{ planName: null, mrrMinor: 0 },
				{ planName: BYOK, mrrMinor: 1_500 },
			],
			[BYOK],
		)
		expect(rollup.planName).toBe(BYOK)
	})

	it("names the plan after the paying subscription with the most MRR", () => {
		const rollup = rollupOf([
			{ planName: "Pro", mrrMinor: 3_900 },
			{ planName: BYOK, mrrMinor: 4_500 },
		])
		expect(rollup.planName).toBe(BYOK)
		expect(rollup.mrrMinor).toBe(8_400)
	})

	it("names a base plan over a pricier add-on; the add-on still counts for MRR", () => {
		const rollup = rollupOf(
			[
				{ planName: "Starter", mrrMinor: 1_900 },
				{ planName: BYOK, mrrMinor: 4_500 },
			],
			[BYOK],
		)
		expect(rollup.planName).toBe("Starter")
		expect(rollup.mrrMinor).toBe(6_400)
	})

	it("names a base plan that bills nothing yet (on usage, or free) over a paying add-on", () => {
		expect(
			rollupOf(
				[
					{ planName: "Pro", mrrMinor: 0 },
					{ planName: BYOK, mrrMinor: 1_500 },
				],
				[BYOK],
			).planName,
		).toBe("Pro")
		expect(
			rollupOf(
				[
					{ planName: "Pro", status: "trialing", mrrMinor: 3_900 },
					{ planName: BYOK, mrrMinor: 1_500 },
				],
				[BYOK],
			).planName,
		).toBe("Pro")
	})

	it("names the add-on when the account has no base plan", () => {
		const rollup = rollupOf([{ planName: BYOK, mrrMinor: 1_500 }], [BYOK])
		expect(rollup.planName).toBe(BYOK)
		expect(rollup.mrrMinor).toBe(1_500)
	})

	it("ignores a canceled base plan", () => {
		expect(
			rollupOf(
				[
					{ planName: "Pro", status: "canceled", mrrMinor: 3_900 },
					{ planName: BYOK, mrrMinor: 1_500 },
				],
				[BYOK],
			).planName,
		).toBe(BYOK)
	})
})

const subId = (name: string) => `sub-${name}` as CustomerSubscriptionId

const item = (overrides: Partial<SubscriptionItemDoc>): SubscriptionItemDoc => ({
	externalId: `si_${overrides.priceId ?? "x"}`,
	priceId: "price_base",
	productId: "prod_base",
	quantity: 1,
	monthlyMinor: 19_900,
	listMonthlyMinor: 19_900,
	lookupKey: null,
	usageType: "licensed",
	billingScheme: "per_unit",
	metadata: {},
	...overrides,
})

const line = (overrides: Partial<InvoiceLineDoc>): InvoiceLineDoc => ({
	externalId: `il_${Math.random()}`,
	source: "subscription",
	proration: false,
	priceId: "price_api",
	productId: "prod_api",
	description: null,
	quantity: null,
	amountMinor: 0,
	periodStart: null,
	periodEnd: null,
	metadata: {},
	...overrides,
})

/** A billed invoice issued on the first of `month` (2026), with usage lines for the month before. */
const usageInvoice = (
	month: number,
	amountMinor: number,
	overrides: Partial<schema.CustomerInvoice> = {},
) => {
	const issued = new Date(Date.UTC(2026, month - 1, 1))
	return {
		status: "paid" as const,
		currency: "usd",
		issuedAt: issued,
		paidAt: issued,
		amountPaidMinor: amountMinor,
		servicePeriodStart: new Date(Date.UTC(2026, month - 2, 1)),
		lines: [
			line({
				amountMinor,
				periodStart: new Date(Date.UTC(2026, month - 2, 1)).toISOString(),
				periodEnd: issued.toISOString(),
			}),
		],
		...overrides,
	}
}

const METERED_PRICES = [
	{
		externalId: "price_api",
		productId: "prod_api",
		usageType: "metered",
		billingScheme: "per_unit",
		priceType: "recurring",
	},
	{
		externalId: "price_base",
		productId: "prod_base",
		usageType: "licensed",
		billingScheme: "per_unit",
		priceType: "recurring",
	},
].map((price) => ({
	provider: "stripe" as const,
	productName: null,
	nickname: null,
	lookupKey: null,
	currency: "usd",
	unitAmountMinor: null,
	interval: "month",
	intervalCount: 1,
	active: true,
	metadata: {},
	productMetadata: {},
	observedAt: null,
	createdAt: NOW,
	updatedAt: NOW,
	...price,
}))

const basisOf = (rules: ReadonlyArray<RevenueRule> = []) => makeRevenueBasis(rules, 3, "usd", METERED_PRICES)

/** `invoices` are the account's billed ones; the rollup gets `mrrSource`'s subscriptions. */
const usageRollupOf = (
	subscriptions: ReadonlyArray<Partial<schema.CustomerSubscription>>,
	invoices: ReadonlyArray<Partial<schema.CustomerInvoice>>,
	options: { readonly mrrSource?: CustomerProvider; readonly rules?: ReadonlyArray<RevenueRule> } = {},
) => {
	const mrrSource = options.mrrSource ?? "stripe"
	const facts = factsOf({ subscriptions, openInvoices: invoices })
	return rollupAccount({
		account: facts.account,
		subscriptions: facts.subscriptions.filter((sub) => sub.provider === mrrSource),
		mrrSource,
		addOnPlans: [],
		revenue: basisOf(options.rules),
		invoices: facts.openInvoices,
		contacts: facts.contacts,
		activity: facts.activity,
		lastActiveDay: facts.lastActiveDay,
		currency: "usd",
		now: NOW,
		today: TODAY,
	})
}

// NOW is 2026-06-15: variable MRR averages March, April and May.
describe("MRR and variable MRR", () => {
	const team = {
		id: subId("team"),
		mrrMinor: 19_900,
		items: [
			item({}),
			item({
				priceId: "price_api",
				productId: "prod_api",
				usageType: "metered",
				monthlyMinor: null,
				listMonthlyMinor: null,
			}),
		],
	}
	const usage = [
		usageInvoice(4, 3_000),
		usageInvoice(5, 0),
		usageInvoice(6, 6_000),
		usageInvoice(3, 99_000),
	]

	it("counts the recurring items in MRR, and averages usage into variable MRR by service month", () => {
		const rollup = usageRollupOf([team], usage)
		expect(rollup.mrrMinor).toBe(19_900)
		// March 3_000, April 0, May 6_000; February's 99_000 is before the window.
		expect(rollup.variableMrrMinor).toBe(3_000)
		expect(rollup.lifecycleStage).toBe("active")
		expect(rollup.mrrBasis).toBe(basisOf().key)
	})

	it("counts a subscription without items at its MRR", () => {
		expect(usageRollupOf([{ mrrMinor: 4_900, items: null }], []).mrrMinor).toBe(4_900)
	})

	it("moves a metered price into MRR (its trailing average) when a rule classes it recurring", () => {
		const rollup = usageRollupOf([team], usage, {
			rules: [
				{
					id: "api",
					name: "Committed API usage",
					conditions: [{ field: "product", values: ["prod_api"] }],
					classification: "recurring",
				},
			],
		})
		expect(rollup).toMatchObject({ mrrMinor: 22_900, variableMrrMinor: 0 })
	})

	it("drops a fixed price from MRR when a rule classes it otherwise", () => {
		const rollup = usageRollupOf([team], usage, {
			rules: [
				{
					id: "base",
					name: "Seats are variable",
					conditions: [{ field: "price", values: ["price_base"] }],
					classification: "variable",
				},
			],
		})
		expect(rollup).toMatchObject({ mrrMinor: 0, variableMrrMinor: 3_000 })
	})

	it("averages a new customer over the months it was billed in", () => {
		const rollup = usageRollupOf([team], [usageInvoice(6, 6_000)])
		expect(rollup.variableMrrMinor).toBe(6_000)
	})

	it("leaves out void, other-currency and not yet issued invoices", () => {
		const rollup = usageRollupOf(
			[team],
			[
				usageInvoice(4, 3_000),
				usageInvoice(5, 50_000, { status: "void" }),
				usageInvoice(6, 70_000, { currency: "eur" }),
				usageInvoice(6, 80_000, { issuedAt: new Date(NOW.getTime() + 86_400_000) }),
			],
		)
		// March 3_000 alone (still averaged over the 3 months since it was first billed).
		expect(rollup.variableMrrMinor).toBe(1_000)
	})

	it("counts no usage once the account stops paying", () => {
		const rollup = usageRollupOf([{ ...team, status: "canceled", canceledAt: NOW }], usage)
		expect(rollup).toMatchObject({ mrrMinor: 0, variableMrrMinor: 0 })
	})

	it("counts an invoice-only customer's usage while it was billed last month", () => {
		expect(usageRollupOf([], usage).variableMrrMinor).toBe(3_000)
		expect(usageRollupOf([], [usageInvoice(4, 3_000)]).variableMrrMinor).toBe(0)
	})

	it("keeps another currency's subscriptions out of MRR", () => {
		const euro = { id: subId("euro"), currency: "eur", mrrMinor: 5_000, items: null }
		const rollup = usageRollupOf([team, euro], usage)
		expect(rollup.mrrMinor).toBe(19_900)
		expect(rollup.attributes.foreignMrr).toEqual({ eur: 5_000 })
	})

	it("adds an Autumn-sourced account's Stripe usage as variable MRR beside its Autumn plan", () => {
		const rollup = usageRollupOf(
			[
				{ provider: "autumn", planName: "Pro", mrrMinor: 4_900, items: null },
				{
					id: subId("stripe"),
					provider: "stripe",
					planName: "Pro",
					mrrMinor: 4_900,
					items: team.items,
				},
			],
			usage,
			{ mrrSource: "autumn" },
		)
		expect(rollup).toMatchObject({ mrrMinor: 4_900, variableMrrMinor: 3_000, mrrSource: "autumn" })
	})
})

describe("champion inactivity", () => {
	const championOf = (offsets: ReadonlyArray<number>) => {
		const facts = factsOf({ activity: { champion: offsets } })
		return rollupAccount({
			account: facts.account,
			subscriptions: facts.subscriptions,
			mrrSource: "autumn",
			addOnPlans: [],
			revenue: basisOf(),
			invoices: [],
			contacts: facts.contacts,
			activity: facts.activity,
			lastActiveDay: facts.lastActiveDay,
			currency: "usd",
			now: NOW,
			today: TODAY,
		})
	}

	it("gives the champion a week's grace before calling them quiet", () => {
		expect(championOf([-20, -10, -1]).championInactiveSince).toBeNull()
		expect(championOf([-20, -10, -6]).championInactiveSince).toBeNull()
		expect(championOf([-20, -10, -7]).championInactiveSince).not.toBeNull()
	})
})
