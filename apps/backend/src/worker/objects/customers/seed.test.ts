import { IngestOp } from "@hazel/domain/customers"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import { type DemoArchetype, generateDemoSeed } from "./seed"

const NOW = new Date("2026-11-10T15:30:00.000Z")
const DAY_MS = 86_400_000
const seed = generateDemoSeed({ now: NOW })
const ops = seed.batches.flatMap((batch) => batch.ops.map((op) => ({ provider: batch.provider, op })))

type Op<T extends IngestOp["_tag"]> = Extract<IngestOp, { _tag: T }>
const opsOf = <T extends IngestOp["_tag"]>(tag: T) =>
	ops.flatMap(({ provider, op }) => (op._tag === tag ? [{ provider, op: op as Op<T> }] : []))

const dayAgo = (ago: number) => new Date(Date.parse("2026-11-10") - ago * DAY_MS).toISOString().slice(0, 10)
const orgsOf = (archetype: DemoArchetype) =>
	seed.accounts.filter((account) => account.archetype === archetype).map((account) => account.clerkOrgId)
const activityOf = (org: string) =>
	opsOf("activity")
		.map(({ op }) => op)
		.filter((op) => op.account.externalId === org)
const activeContacts = (org: string, newestAgo: number, oldestAgo: number) =>
	new Set(
		activityOf(org)
			.filter((op) => op.day <= dayAgo(newestAgo) && op.day >= dayAgo(oldestAgo))
			.map((op) => op.contact.externalId),
	).size
const subsOf = (org: string) =>
	opsOf("subscription")
		.map(({ op }) => op)
		.filter((op) => op.account.externalId === org)

describe("generateDemoSeed", () => {
	it("is deterministic per seed", () => {
		expect(generateDemoSeed({ now: NOW })).toEqual(seed)
		expect(generateDemoSeed({ now: NOW, seed: 2 })).not.toEqual(seed)
	})

	it("produces ops that decode", () => {
		const decode = Schema.decodeUnknownSync(IngestOp)
		for (const { op } of ops) decode(op)
	})

	it("orders batches and references only earlier records", () => {
		expect(seed.batches.map((batch) => batch.provider)).toEqual(["clerk", "autumn", "stripe", "maple"])
		const accounts = new Set<string>()
		const contacts = new Set<string>()
		for (const { provider, op } of ops) {
			switch (op._tag) {
				case "account":
					accounts.add(`${provider}:${op.externalId}`)
					break
				case "contact":
					expect(accounts).toContain(`${op.account.provider}:${op.account.externalId}`)
					contacts.add(`${provider}:${op.externalId}`)
					break
				case "activity":
					expect(contacts).toContain(`${op.contact.provider}:${op.contact.externalId}`)
					expect(accounts).toContain(`${op.account.provider}:${op.account.externalId}`)
					break
				case "subscription":
				case "invoice":
				case "metric":
				case "event":
					expect(accounts).toContain(`${op.account.provider}:${op.account.externalId}`)
					break
			}
		}
	})

	it("has the archetype mix, unique ids and bounded volume", () => {
		const archetypes = new Set(seed.accounts.map((account) => account.archetype))
		expect(archetypes.size).toBe(15)
		expect(seed.accounts).toHaveLength(200)
		expect(opsOf("activity").length).toBeLessThanOrEqual(45_000)
		expect(opsOf("invoice").length).toBeLessThanOrEqual(2_000)
		expect(opsOf("metric").length).toBeLessThanOrEqual(20_000)

		const keys = ops.map(({ provider, op }) => {
			switch (op._tag) {
				case "activity":
					return `activity:${op.contact.externalId}:${op.day}`
				case "metric":
					return `metric:${op.account.externalId}:${op.metricKey}:${op.day}`
				case "metric_definition":
					return `metric_definition:${op.key}`
				default:
					return `${provider}:${op._tag}:${op.externalId}`
			}
		})
		expect(new Set(keys).size).toBe(keys.length)
		const builtIn = ["active_users", "active_users_30d", "mrr", "health_score"]
		expect(opsOf("metric").some(({ op }) => builtIn.includes(op.metricKey))).toBe(false)
	})

	it("parks the deliberate Stripe edge cases", () => {
		const stripe = opsOf("account").filter(({ provider }) => provider === "stripe")
		const clerkDomains = opsOf("account")
			.filter(({ provider }) => provider === "clerk")
			.flatMap(({ op }) => op.domains ?? [])
		const withoutSameAs = stripe
			.filter(({ op }) => op.sameAs.length === 0)
			.map(({ op }) => op.domains![0]!)
		const matches = (domain: string) => clerkDomains.filter((d) => d === domain).length
		expect(withoutSameAs.filter((domain) => matches(domain) === 0)).toHaveLength(3)
		expect(withoutSameAs.filter((domain) => matches(domain) === 2)).toHaveLength(1)
		expect(withoutSameAs.filter((domain) => matches(domain) === 1)).toHaveLength(2)
	})

	it("shapes each archetype so its signal matches", () => {
		for (const org of orgsOf("went_quiet")) {
			expect(activeContacts(org, 0, 13)).toBe(0)
			expect(activeContacts(org, 14, 75)).toBeGreaterThanOrEqual(3)
		}
		for (const org of orgsOf("trial_ending_low")) {
			const trial = subsOf(org).find((sub) => sub.status === "trialing")!
			const daysLeft = (Date.parse(trial.trialEndsAt!) - NOW.getTime()) / DAY_MS
			expect(daysLeft).toBeGreaterThan(0)
			expect(daysLeft).toBeLessThanOrEqual(5)
			expect(activeContacts(org, 0, 6)).toBeLessThanOrEqual(1)
		}
		for (const org of orgsOf("usage_drop")) {
			const dau = (newest: number, days: number) =>
				activityOf(org).filter((op) => op.day <= dayAgo(newest) && op.day > dayAgo(newest + days))
					.length / days
			expect(dau(0, 7)).toBeGreaterThan(0)
			expect(dau(0, 7)).toBeLessThanOrEqual(dau(7, 28) * 0.5)
		}
		for (const org of orgsOf("champion_left")) {
			const recent = activityOf(org).filter((op) => op.day >= dayAgo(29))
			const daysBy = new Map<string, number>()
			for (const op of recent)
				daysBy.set(op.contact.externalId, (daysBy.get(op.contact.externalId) ?? 0) + 1)
			const champion = [...daysBy].sort((a, b) => b[1] - a[1])[0]![0]
			const last = recent
				.filter((op) => op.contact.externalId === champion)
				.map((op) => op.day)
				.sort()
				.at(-1)!
			expect(last <= dayAgo(14)).toBe(true)
			expect(activeContacts(org, 0, 13)).toBeGreaterThan(0)
		}
		for (const org of orgsOf("seat_growth")) {
			const before = activeContacts(org, 30, 59)
			expect(before).toBeGreaterThanOrEqual(3)
			expect(activeContacts(org, 0, 29)).toBeGreaterThanOrEqual(before * 1.6)
		}
		for (const org of orgsOf("onboarding_stalled")) {
			expect(activeContacts(org, 0, 365)).toBeLessThanOrEqual(1)
		}
		for (const org of orgsOf("near_limit")) {
			const today = opsOf("metric").find(
				({ op }) =>
					op.account.externalId === org && op.metricKey === "api_calls" && op.day === dayAgo(0),
			)!.op
			expect(today.value).toBeGreaterThanOrEqual(0.9 * today.limitValue!)
		}
		for (const org of orgsOf("payment_failed")) {
			expect(subsOf(org).some((sub) => sub.status === "past_due" || sub.status === "unpaid")).toBe(true)
			const customer = `cus_${org.slice(4)}`
			const open = opsOf("invoice").find(
				({ op }) => op.account.externalId === customer && op.status === "open",
			)!
			expect(Date.parse(open.op.dueAt!)).toBeLessThan(NOW.getTime() - 7 * DAY_MS)
		}
		for (const org of orgsOf("cancel_scheduled")) {
			expect(subsOf(org).some((sub) => sub.cancelAtPeriodEnd && sub.status === "active")).toBe(true)
		}
		for (const org of orgsOf("downgraded")) {
			const [before, after] = subsOf(org)
			expect(after!.mrrMinor).toBeLessThan(before!.mrrMinor)
			expect(Date.parse(before!.canceledAt!)).toBeGreaterThan(NOW.getTime() - 14 * DAY_MS)
		}
		for (const org of orgsOf("churned")) {
			expect(subsOf(org).every((sub) => sub.status === "canceled")).toBe(true)
		}
	})

	it("never dates history after now", () => {
		const nowIso = NOW.toISOString()
		for (const { op } of opsOf("invoice")) {
			if (op.status !== "upcoming") expect(op.issuedAt! <= nowIso).toBe(true)
		}
		for (const { op } of opsOf("contact"))
			expect(op.lastSeenAt === null || op.lastSeenAt! <= nowIso).toBe(true)
		for (const { op } of opsOf("activity")) expect(op.day <= dayAgo(0)).toBe(true)
	})
})
