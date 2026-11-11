/**
 * The pure account rollup (`rollupAccount`): which subscription names the plan when some plans are
 * add-ons, that add-ons still count for MRR, and MRR from paid Stripe invoices (`overageInMrr`).
 */
import type { schema } from "@hazel/db"
import type { CustomerProvider } from "@hazel/domain/customers"
import type { CustomerSubscriptionId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { invoiceMrrOf, rollupAccount } from "./snapshot"
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
		invoiceMrr: [],
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

const DAY = 86_400_000
const paidDaysAgo = (days: number) => new Date(NOW.getTime() - days * DAY)
const subId = (name: string) => `sub-${name}` as CustomerSubscriptionId

/**
 * With `overageInMrr` on: `invoices` are paid Stripe ones (`subscriptionId` a sub's `id`); the
 * rollup gets `mrrSource`'s subscriptions, the invoices all of them.
 */
const invoiceRollupOf = (
	subscriptions: ReadonlyArray<Partial<schema.CustomerSubscription>>,
	invoices: ReadonlyArray<Partial<schema.CustomerInvoice>>,
	mrrSource: CustomerProvider = "stripe",
) => {
	const facts = factsOf({
		subscriptions,
		openInvoices: invoices.map((invoice) => ({ status: "paid", ...invoice })),
	})
	return rollupAccount({
		account: facts.account,
		subscriptions: facts.subscriptions.filter((sub) => sub.provider === mrrSource),
		mrrSource,
		addOnPlans: [],
		invoiceMrr: invoiceMrrOf(facts.subscriptions, facts.openInvoices, NOW),
		contacts: facts.contacts,
		activity: facts.activity,
		lastActiveDay: facts.lastActiveDay,
		currency: "usd",
		now: NOW,
		today: TODAY,
	})
}

describe("MRR from paid Stripe invoices", () => {
	const team = { id: subId("team"), mrrMinor: 19_900 }

	it("keeps the plans' MRR without counted invoices (the setting off, or none paid yet)", () => {
		expect(rollupOf([team]).mrrMinor).toBe(19_900)
		expect(invoiceRollupOf([team], []).mrrMinor).toBe(19_900)
	})

	it("counts a monthly subscription's last paid invoice, overage included", () => {
		const rollup = invoiceRollupOf(
			[team],
			[
				{ subscriptionId: team.id, amountPaidMinor: 21_000, paidAt: paidDaysAgo(40) },
				{ subscriptionId: team.id, amountPaidMinor: 24_350, paidAt: paidDaysAgo(10) },
			],
		)
		expect(rollup.mrrMinor).toBe(24_350)
		expect(rollup.lifecycleStage).toBe("active")
	})

	it("counts a yearly invoice per month", () => {
		const yearly = { id: subId("yearly"), interval: "year" as const, mrrMinor: 15_000 }
		expect(
			invoiceRollupOf(
				[yearly],
				[{ subscriptionId: yearly.id, amountPaidMinor: 190_000, paidAt: paidDaysAgo(300) }],
			).mrrMinor,
		).toBe(15_833)
	})

	it("falls back to the plans' MRR once the last paid invoice is past its interval and grace", () => {
		expect(
			invoiceRollupOf(
				[team],
				[{ subscriptionId: team.id, amountPaidMinor: 24_350, paidAt: paidDaysAgo(39) }],
			).mrrMinor,
		).toBe(19_900)
	})

	it("ignores a canceled subscription's invoices", () => {
		const old = { id: subId("old"), status: "canceled" as const, mrrMinor: 9_900 }
		expect(
			invoiceRollupOf(
				[team, old],
				[
					{ subscriptionId: team.id, amountPaidMinor: 20_500, paidAt: paidDaysAgo(5) },
					{ subscriptionId: old.id, amountPaidMinor: 9_900, paidAt: paidDaysAgo(5) },
				],
			).mrrMinor,
		).toBe(20_500)
	})

	it("adds only reporting-currency invoices", () => {
		const euro = { id: subId("euro"), currency: "eur", mrrMinor: 5_000 }
		const rollup = invoiceRollupOf(
			[team, euro],
			[
				{ subscriptionId: team.id, amountPaidMinor: 20_500, paidAt: paidDaysAgo(5) },
				{ subscriptionId: euro.id, amountPaidMinor: 7_000, currency: "eur", paidAt: paidDaysAgo(5) },
			],
		)
		expect(rollup.mrrMinor).toBe(20_500)
		expect(rollup.attributes.foreignMrr).toEqual({ eur: 5_000 })
	})

	it("counts an Autumn-sourced account's Stripe subscriptions' invoices", () => {
		const rollup = invoiceRollupOf(
			[
				{ provider: "autumn", planName: "Pro", mrrMinor: 4_900 },
				{ id: subId("stripe"), provider: "stripe", planName: "Pro", mrrMinor: 4_900 },
			],
			[{ subscriptionId: subId("stripe"), amountPaidMinor: 6_200, paidAt: paidDaysAgo(12) }],
			"autumn",
		)
		expect(rollup).toMatchObject({ mrrMinor: 6_200, mrrSource: "autumn", planName: "Pro" })
	})
})
