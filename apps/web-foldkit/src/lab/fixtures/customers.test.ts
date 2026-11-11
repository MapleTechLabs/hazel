import { describe, expect, it } from "vitest"
import { ACCOUNTS, HEALTH_TOTALS, OPEN_SIGNALS, SIGNALS, overviewFixture } from "./customers"

describe("customers fixtures", () => {
	it("add up to the designs' book: 214 accounts, $48,210 MRR", () => {
		expect(ACCOUNTS).toHaveLength(214)
		expect(ACCOUNTS.reduce((sum, account) => sum + account.mrrMinor, 0)).toBe(4_821_000)
		expect(new Set(ACCOUNTS.map((account) => account.id)).size).toBe(214)
	})

	it("match the health distribution per status", () => {
		for (const [status, [count, mrr]] of Object.entries(HEALTH_TOTALS)) {
			const accounts = ACCOUNTS.filter((account) => account.healthStatus === status)
			expect(accounts).toHaveLength(count)
			expect(accounts.reduce((sum, account) => sum + account.mrrMinor, 0)).toBe(mrr * 100)
			expect(accounts.every((account) => account.mrrMinor >= 0)).toBe(true)
		}
	})

	it("cover every evidence viz and every signal status", () => {
		expect(new Set(SIGNALS.map((signal) => signal.evidence._tag))).toEqual(
			new Set(["amount", "last_active", "series", "limit", "delta", "ratio"]),
		)
		expect(new Set(SIGNALS.map((signal) => signal.status))).toEqual(
			new Set(["open", "snoozed", "done", "dismissed", "auto_resolved"]),
		)
		expect(OPEN_SIGNALS.map((signal) => signal.priorityScore)).toEqual(
			[...OPEN_SIGNALS.map((signal) => signal.priorityScore)].sort((a, b) => b - a),
		)
	})

	it("bucket the overview by range", () => {
		expect(overviewFixture("30d").activeUsers).toHaveLength(30)
		expect(overviewFixture("12m").mrrMovements).toHaveLength(12)
		expect(overviewFixture("90d").bucket).toBe("week")
		expect(overviewFixture("30d", { partial: true }).hasData.billing).toBe(false)
	})
})
