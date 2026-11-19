import { describe, expect, it } from "vitest"
import { ACCOUNTS, ACCOUNTS_BY_KEY, HEALTH_TOTALS, OPEN_SIGNALS, SIGNALS, overviewFixture } from "./customers"

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

	it("group Acme and Halcyon into environments that hold no signals", () => {
		const { acme, acmeEu, halcyon, halcyonEu, halcyonStaging } = ACCOUNTS_BY_KEY
		expect([acme.primaryAccountId, acmeEu.primaryAccountId]).toEqual([null, acme.id])
		expect([halcyonEu.primaryAccountId, halcyonStaging.primaryAccountId]).toEqual([
			halcyon.id,
			halcyon.id,
		])
		const environmentIds = new Set(
			ACCOUNTS.filter((account) => account.primaryAccountId !== null).map((account) => account.id),
		)
		expect(environmentIds.size).toBe(3)
		expect(SIGNALS.some((signal) => environmentIds.has(signal.accountId))).toBe(false)
	})

	it("bucket the overview by range", () => {
		expect(overviewFixture("30d").activeUsers).toHaveLength(30)
		expect(overviewFixture("12m").mrrMovements).toHaveLength(12)
		expect(overviewFixture("90d").bucket).toBe("week")
		expect(overviewFixture("30d", { partial: true }).hasData.billing).toBe(false)
	})
})
