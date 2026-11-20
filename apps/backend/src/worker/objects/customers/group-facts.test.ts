import type { CustomerContactId } from "@hazel/schema"
import { describe, expect, it } from "vitest"
import { evaluate } from "./evaluate"
import type { AccountFacts } from "./facts"
import { groupFacts, groupMovements } from "./group-facts"
import { factsOf, orgFacts, TODAY } from "./test-kit"
import { addDays } from "./time"

const FROM = addDays(TODAY, -61)

const id = (value: string) => value as CustomerContactId

/** One environment whose people are `[contact id, email, active day offsets]`. */
const environment = (
	people: ReadonlyArray<readonly [string, string | null, ReadonlyArray<number>]>,
	overrides: Parameters<typeof factsOf>[0] = {},
): AccountFacts => {
	const base = factsOf(overrides)
	const activity = new Map<string, Map<CustomerContactId, number>>()
	for (const [contact, , offsets] of people) {
		for (const offset of offsets) {
			const day = addDays(TODAY, offset)
			const into = activity.get(day) ?? new Map<CustomerContactId, number>()
			into.set(id(contact), 5)
			activity.set(day, into)
		}
	}
	const contacts = people.map(([contact, email, offsets]) => ({
		id: id(contact),
		name: contact,
		email,
		role: null,
		firstActiveAt:
			offsets.length === 0 ? null : new Date(`${addDays(TODAY, Math.min(...offsets))}T00:00:00Z`),
		lastActiveDay: offsets.length === 0 ? null : addDays(TODAY, Math.max(...offsets)),
	}))
	const days = contacts.flatMap((contact) =>
		contact.lastActiveDay === null ? [] : [contact.lastActiveDay],
	)
	return {
		...base,
		contacts,
		activity,
		lastActiveDay: days.length === 0 ? null : days.sort().at(-1)!,
		everActiveContacts: contacts.filter((contact) => contact.firstActiveAt !== null).length,
	}
}

describe("groupFacts", () => {
	it("counts a person in several environments once, by email", () => {
		const us = environment(
			[
				["ada-us", "Ada@acme.com", [-1]],
				["bo", "bo@acme.com", [-20]],
			],
			{ priorActive: [[30, 2]] },
		)
		const eu = environment(
			[
				["ada-eu", "ada@acme.com", [-3, -1]],
				["cy", null, []],
			],
			{ priorActive: [[30, 1]] },
		)
		const group = groupFacts(us, [eu], FROM)
		expect(group.contacts.map((contact) => contact.id)).toEqual(["ada-us", "bo", "cy"])
		expect(group.contacts[0]).toMatchObject({
			firstActiveAt: new Date(`${addDays(TODAY, -3)}T00:00:00Z`),
			lastActiveDay: addDays(TODAY, -1),
		})
		expect([...(group.activity.get(addDays(TODAY, -1)) ?? [])]).toEqual([["ada-us", 10]])
		expect([...(group.activity.get(addDays(TODAY, -3)) ?? [])]).toEqual([["ada-us", 5]])
		expect(group.lastActiveDay).toBe(addDays(TODAY, -1))
		expect(group.everActiveContacts).toBe(2)
		// Ada and Bo in the 30 days up to the last active day: Ada once.
		expect(group.priorActive.get(30)).toBe(2)
	})

	it("sums MRR, seats and metrics; takes the earliest and latest dates and the primary's health", () => {
		const health = [{ day: TODAY, score: 80, status: "healthy" as const }]
		const us = factsOf({
			account: {
				mrrMinor: 10_000,
				seatsUsed: 4,
				seatsLimit: 10,
				customerSince: new Date("2026-03-01T00:00:00Z"),
				lastActiveAt: new Date("2026-06-01T00:00:00Z"),
				tags: ["vip"],
			},
			metrics: new Map([["events", [{ day: TODAY, value: 3, limitValue: 10 }]]]),
			health,
		})
		const eu = factsOf({
			account: {
				mrrMinor: 5_000,
				seatsUsed: 2,
				seatsLimit: null,
				customerSince: new Date("2026-01-01T00:00:00Z"),
				lastActiveAt: new Date("2026-06-10T00:00:00Z"),
				tags: ["eu"],
			},
			metrics: new Map([
				[
					"events",
					[
						{ day: addDays(TODAY, -1), value: 1, limitValue: null },
						{ day: TODAY, value: 4, limitValue: 5 },
					],
				],
			]),
			health: [{ day: TODAY, score: 20, status: "critical" as const }],
		})
		const group = groupFacts(us, [eu], FROM)
		expect(group.account).toMatchObject({
			id: us.account.id,
			mrrMinor: 15_000,
			seatsUsed: 6,
			seatsLimit: 10,
			customerSince: new Date("2026-01-01T00:00:00Z"),
			lastActiveAt: new Date("2026-06-10T00:00:00Z"),
			tags: ["vip", "eu"],
		})
		expect(group.metrics.get("events")).toEqual([
			{ day: addDays(TODAY, -1), value: 1, limitValue: null },
			{ day: TODAY, value: 7, limitValue: 15 },
		])
		expect(group.health).toBe(health)
	})

	it("takes the most advanced stage: churned only when every environment is", () => {
		const stageOf = (...stages: Array<AccountFacts["stage"]>) => {
			const [primary, ...rest] = stages.map((stage) => factsOf({ account: { lifecycleStage: stage } }))
			return groupFacts(primary!, rest, FROM).stage
		}
		expect(stageOf("churned", "active")).toBe("active")
		expect(stageOf("lead", "trialing")).toBe("trialing")
		expect(stageOf("past_due", "active")).toBe("active")
		expect(stageOf("churned", "lead")).toBe("lead")
		expect(stageOf("churned", "churned")).toBe("churned")
	})

	it("turns the environments' MRR movements into the group's", () => {
		const us = factsOf({
			account: { mrrMinor: 100 },
			movements: [
				{ day: addDays(TODAY, -10), type: "new", fromMrrMinor: 0, toMrrMinor: 100, deltaMinor: 100 },
			],
		})
		const eu = factsOf({
			account: { mrrMinor: 20 },
			movements: [
				{
					day: addDays(TODAY, -5),
					type: "contraction",
					fromMrrMinor: 50,
					toMrrMinor: 20,
					deltaMinor: -30,
				},
			],
		})
		expect(
			groupMovements([us, eu]).map(
				({ day, type, fromMrrMinor, toMrrMinor, deltaMinor, accountId }) => ({
					day,
					type,
					fromMrrMinor,
					toMrrMinor,
					deltaMinor,
					primary: accountId === us.account.id,
				}),
			),
		).toEqual([
			{
				day: addDays(TODAY, -10),
				type: "expansion",
				fromMrrMinor: 50,
				toMrrMinor: 150,
				deltaMinor: 100,
				primary: true,
			},
			{
				day: addDays(TODAY, -5),
				type: "contraction",
				fromMrrMinor: 150,
				toMrrMinor: 120,
				deltaMinor: -30,
				primary: true,
			},
		])
	})

	it("keeps an environment's quiet users from reading as the customer going quiet", () => {
		const rule = {
			name: "Stopped using the product",
			template: "inactive" as const,
			severity: "medium" as const,
			config: {
				_tag: "inactive" as const,
				inactiveDays: 14,
				priorWindowDays: 30,
				minPriorActiveUsers: 1,
			},
			scope: {},
		}
		const quiet = environment([["ada", "ada@acme.com", [-40, -30, -20]]], { priorActive: [[30, 1]] })
		const busy = environment([["bo", "bo@acme.com", [-2, -1]]], { priorActive: [[30, 1]] })
		expect(evaluate(rule, quiet, orgFacts())._tag).toBe("Match")
		expect(evaluate(rule, groupFacts(quiet, [busy], FROM), orgFacts())._tag).toBe("NoMatch")
	})

	it("measures plan limits per environment and names the one at its limit", () => {
		const rule = {
			name: "Near plan limit",
			template: "near_limit" as const,
			severity: "medium" as const,
			config: { _tag: "near_limit" as const, thresholdPct: 90, metricKeys: [] },
			scope: {},
		}
		const usage = (value: number) => new Map([["sessions", [{ day: TODAY, value, limitValue: 10_000 }]]])
		const prod = factsOf({ account: { name: "sakura-prod", environment: "prod" }, metrics: usage(2_000) })
		const dev = factsOf({ account: { name: "sakura-dev", environment: "dev" }, metrics: usage(11_749) })
		// Summed, 13,749 of 20,000 is under the threshold; dev alone is over its own limit.
		const result = evaluate(rule, groupFacts(prod, [dev], FROM), orgFacts())
		expect(result).toMatchObject({
			_tag: "Match",
			reason: "sessions at 118% of the plan limit in sakura-dev (dev) (11749 of 10000)",
			evidence: { _tag: "limit", accountId: dev.account.id, pct: 117.5 },
		})
	})
})
