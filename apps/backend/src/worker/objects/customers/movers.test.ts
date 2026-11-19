/** Top movers on the customers overview (`rankMovers` in `./read.ts`). */
import type { CustomerAccountId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { rankMovers } from "./read"

const row = (id: string, previous: number, current: number) => ({
	accountId: id as CustomerAccountId,
	previous,
	current,
})

describe("rankMovers", () => {
	it("compares average daily active users per window, as a percentage of the previous one", () => {
		const { gainers, decliners } = rankMovers([row("up", 60, 90), row("down", 300, 150)], 30)
		expect(gainers).toEqual([{ accountId: "up", previousAvg: 2, currentAvg: 3, changePct: 50 }])
		expect(decliners).toEqual([{ accountId: "down", previousAvg: 10, currentAvg: 5, changePct: -50 }])
	})

	it("leaves out accounts under the baseline, and flat ones", () => {
		// 1 user-day to 9 in 30 days is not +800%; 1 → 1 (30 to 31 user-days) shows no move.
		const { gainers, decliners } = rankMovers(
			[row("noise", 1, 9), row("gone", 20, 0), row("flat", 60, 60), row("rounds-flat", 30, 31)],
			30,
		)
		expect(gainers).toEqual([])
		expect(decliners).toEqual([])
	})

	it("keeps an account that went silent from a real baseline", () => {
		const { decliners } = rankMovers([row("silent", 30, 0)], 30)
		expect(decliners).toEqual([{ accountId: "silent", previousAvg: 1, currentAvg: 0, changePct: -100 }])
	})
})
