/**
 * The pure account rollup (`rollupAccount`): which subscription names the plan when some plans are
 * add-ons, and that add-ons still count for MRR.
 */
import type { schema } from "@hazel/db"
import { describe, expect, it } from "vitest"
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
