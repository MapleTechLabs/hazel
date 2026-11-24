/**
 * The pure account rollup (`rollupAccount`): which subscription names the plan when some plans are
 * add-ons, that add-ons still count for MRR, and usage billing on top (`usageMrrOf`).
 */
import type { schema } from "@hazel/db"
import type { CustomerProvider } from "@hazel/domain/customers"
import type { CustomerSubscriptionId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { unpaidEndOf } from "./facts"
import { rollupAccount, usageMrrOf } from "./snapshot"
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
		usageMrr: [],
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
 * `invoices` are paid Stripe ones (`subscriptionId` a sub's `id`); the rollup gets `mrrSource`'s
 * subscriptions, the usage all of them.
 */
const usageRollupOf = (
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
		usageMrr: usageMrrOf(facts.subscriptions, facts.openInvoices, NOW),
		contacts: facts.contacts,
		activity: facts.activity,
		lastActiveDay: facts.lastActiveDay,
		currency: "usd",
		now: NOW,
		today: TODAY,
	})
}

describe("MRR: the plans plus usage billing", () => {
	const team = { id: subId("team"), mrrMinor: 19_900 }

	it("is the plans' MRR without paid invoices", () => {
		expect(usageRollupOf([team], []).mrrMinor).toBe(19_900)
	})

	it("adds the last 3 months' average overage above the plan", () => {
		const rollup = usageRollupOf(
			[team],
			[
				{ subscriptionId: team.id, amountPaidMinor: 99_000, paidAt: paidDaysAgo(100) },
				{ subscriptionId: team.id, amountPaidMinor: 22_900, paidAt: paidDaysAgo(70) },
				{ subscriptionId: team.id, amountPaidMinor: 19_900, paidAt: paidDaysAgo(40) },
				{ subscriptionId: team.id, amountPaidMinor: 25_900, paidAt: paidDaysAgo(10) },
				{ subscriptionId: team.id, amountPaidMinor: 50_000, paidAt: paidDaysAgo(-2) },
			],
		)
		// (3_000 + 0 + 6_000) / 3; the invoices 100 days ago and 2 days ahead are out of the window.
		expect(rollup.mrrMinor).toBe(22_900)
		expect(rollup.lifecycleStage).toBe("active")
	})

	it("averages over the invoices there are when fewer than 3", () => {
		expect(
			usageRollupOf(
				[team],
				[
					{ subscriptionId: team.id, amountPaidMinor: 21_900, paidAt: paidDaysAgo(40) },
					{ subscriptionId: team.id, amountPaidMinor: 25_900, paidAt: paidDaysAgo(10) },
				],
			).mrrMinor,
		).toBe(23_900)
	})

	it("counts a usage-only subscription's whole invoices", () => {
		const metered = { id: subId("metered"), mrrMinor: 0, billsByUsage: true }
		expect(
			usageRollupOf(
				[metered],
				[{ subscriptionId: metered.id, amountPaidMinor: 4_200, paidAt: paidDaysAgo(12) }],
			).mrrMinor,
		).toBe(4_200)
	})

	it("adds nothing for a discount, a yearly plan, or a canceled subscription", () => {
		const yearly = { id: subId("yearly"), interval: "year" as const, mrrMinor: 15_000 }
		const old = { id: subId("old"), status: "canceled" as const, mrrMinor: 9_900 }
		expect(
			usageRollupOf(
				[team, yearly, old],
				[
					{ subscriptionId: team.id, amountPaidMinor: 15_000, paidAt: paidDaysAgo(5) },
					{ subscriptionId: yearly.id, amountPaidMinor: 190_000, paidAt: paidDaysAgo(20) },
					{ subscriptionId: old.id, amountPaidMinor: 50_000, paidAt: paidDaysAgo(5) },
				],
			).mrrMinor,
		).toBe(34_900)
	})

	it("adds only reporting-currency usage", () => {
		const euro = { id: subId("euro"), currency: "eur", mrrMinor: 5_000 }
		const rollup = usageRollupOf(
			[team, euro],
			[
				{ subscriptionId: team.id, amountPaidMinor: 20_500, paidAt: paidDaysAgo(5) },
				{ subscriptionId: euro.id, amountPaidMinor: 7_000, currency: "eur", paidAt: paidDaysAgo(5) },
			],
		)
		expect(rollup.mrrMinor).toBe(20_500)
		expect(rollup.attributes.foreignMrr).toEqual({ eur: 5_000 })
	})

	it("adds an Autumn-sourced account's Stripe usage on top of its Autumn plan", () => {
		const rollup = usageRollupOf(
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

describe("champion inactivity", () => {
	const championOf = (offsets: ReadonlyArray<number>) => {
		const facts = factsOf({ activity: { champion: offsets } })
		return rollupAccount({
			account: facts.account,
			subscriptions: facts.subscriptions,
			mrrSource: "autumn",
			addOnPlans: [],
			usageMrr: [],
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

describe("a plan that ended on a failed payment", () => {
	const DAY = 86_400_000
	const ago = (days: number) => new Date(NOW.getTime() - days * DAY)
	const ended = { status: "canceled", mrrMinor: 3_900, canceledAt: ago(2) } as const
	const plan = "sub_1" as CustomerSubscriptionId
	const failed = {
		subscriptionId: plan,
		status: "open",
		amountDueMinor: 3_900,
		attemptCount: 9,
		issuedAt: ago(90),
	} as const

	const rollupWith = (
		invoices: ReadonlyArray<Partial<schema.CustomerInvoice>>,
		subscriptions: ReadonlyArray<Partial<schema.CustomerSubscription>> = [ended],
	) => {
		const facts = factsOf({ subscriptions, openInvoices: invoices })
		const unpaidEnd = unpaidEndOf(facts.subscriptions, facts.openInvoices)
		return {
			unpaidEnd,
			rollup: rollupAccount({
				account: { ...facts.account, customerSince: ago(100), churnedAt: ago(2) },
				subscriptions: facts.subscriptions,
				mrrSource: "autumn",
				unpaidEnd,
				addOnPlans: [],
				usageMrr: [],
				contacts: facts.contacts,
				activity: facts.activity,
				lastActiveDay: facts.lastActiveDay,
				currency: "usd",
				now: NOW,
				today: TODAY,
			}),
		}
	}

	it("is past due, not churned, while the invoice is open", () => {
		const { rollup, unpaidEnd } = rollupWith([failed])
		expect(unpaidEnd?.since).toEqual(ago(90))
		expect(rollup).toMatchObject({ lifecycleStage: "past_due", churnedAt: null, mrrMinor: 0 })
	})

	it("churns from the failed invoice once it is voided or uncollectible", () => {
		for (const status of ["void", "uncollectible"] as const) {
			expect(rollupWith([{ ...failed, status }]).rollup).toMatchObject({
				lifecycleStage: "churned",
				churnedAt: ago(90),
			})
		}
	})

	it("dates the end from the first failed invoice since the last paid one", () => {
		const { unpaidEnd } = rollupWith([
			{ ...failed, issuedAt: ago(200) },
			{ subscriptionId: plan, status: "paid", amountPaidMinor: 3_900, issuedAt: ago(120) },
			failed,
			{ ...failed, issuedAt: ago(60) },
		])
		expect(unpaidEnd?.since).toEqual(ago(90))
	})

	it("does not count a $0 paid invoice as the last payment", () => {
		const { unpaidEnd } = rollupWith([
			{
				subscriptionId: plan,
				status: "paid",
				amountDueMinor: 0,
				amountPaidMinor: 0,
				issuedAt: ago(80),
			},
			failed,
		])
		expect(unpaidEnd?.since).toEqual(ago(90))
	})

	it("reads one-off invoices as saying nothing about the plan", () => {
		const oneOffPaid = {
			subscriptionId: null,
			status: "paid",
			amountPaidMinor: 900,
			issuedAt: ago(20),
		} as const
		expect(rollupWith([failed, oneOffPaid]).unpaidEnd?.since).toEqual(ago(90))
		expect(rollupWith([{ ...failed, subscriptionId: null }]).rollup.lifecycleStage).toBe("churned")
	})

	it("reads a plan invoice paid after the failure as the customer still paying", () => {
		const { rollup } = rollupWith([
			failed,
			{ subscriptionId: plan, status: "paid", amountPaidMinor: 3_900, issuedAt: ago(30) },
		])
		expect(rollup.lifecycleStage).toBe("churned")
	})

	it("leaves a customer churned when its bills were paid or the invoice came after the end", () => {
		expect(
			rollupWith([{ ...failed, status: "paid", amountPaidMinor: 3_900 }]).rollup.lifecycleStage,
		).toBe("churned")
		expect(rollupWith([{ ...failed, issuedAt: ago(1) }]).rollup.lifecycleStage).toBe("churned")
		expect(rollupWith([{ ...failed, attemptCount: 0 }]).rollup.lifecycleStage).toBe("churned")
	})

	it("ignores failed invoices while a paying plan is live", () => {
		const { unpaidEnd } = rollupWith([failed], [ended, { status: "active", mrrMinor: 3_900 }])
		expect(unpaidEnd).toBeNull()
	})
})
