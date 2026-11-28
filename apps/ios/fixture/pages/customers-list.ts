import type { PageFixture } from "../page-fixture"
import { orgId } from "../snapshot"

/**
 * `/hazel/customers/list`: fourteen accounts across every stage, owners, plans, tags, open signals
 * and one EU environment under its primary, plus their 30-day active users (`customers.sparklines`).
 * Dates are against the parity clock (`compare-pages.ts`, 2026-11-26 15:00 UTC).
 */

const NOW_MS = Date.parse("2026-11-26T15:00:00Z")
const DAY_MS = 86_400_000
const ago = (days: number) => new Date(NOW_MS - days * DAY_MS).toISOString()

const uuid = (group: number, index: number) =>
	`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`

/** The fixture's people (`snapshot.ts`): Ada is the signed-in user. */
const user = (n: number) => uuid(2, n)
const ADA = user(1)
const GRACE = user(2)
const ALAN = user(3)
const KATHERINE = user(4)

const accountId = (n: number) => uuid(0x30, n)

type Stage = "lead" | "trialing" | "active" | "past_due" | "churned"

interface Seed {
	readonly n: number
	readonly name: string
	readonly domain: string
	readonly stage: Stage
	readonly plan: string | null
	readonly mrr: number
	readonly owner: string | null
	readonly active: number
	readonly trend: number | null
	readonly lastActiveDays: number | null
	readonly sinceDays: number
	readonly risk?: readonly [high: number, medium: number, low: number]
	readonly opportunities?: number
	readonly tags?: ReadonlyArray<string>
	readonly primary?: number
	readonly environment?: string
}

const SEEDS: ReadonlyArray<Seed> = [
	{
		n: 1,
		name: "Linear",
		domain: "linear.app",
		stage: "active",
		plan: "Enterprise",
		mrr: 1_250_000,
		owner: ADA,
		active: 182,
		trend: 12,
		lastActiveDays: 0,
		sinceDays: 720,
		opportunities: 1,
		tags: ["strategic"],
	},
	{
		n: 2,
		name: "Linear",
		domain: "eu.linear.app",
		stage: "active",
		plan: "Enterprise",
		mrr: 310_000,
		owner: ADA,
		active: 41,
		trend: 3,
		lastActiveDays: 1,
		sinceDays: 400,
		primary: 1,
		environment: "EU",
	},
	{
		n: 3,
		name: "Northwind",
		domain: "northwind.com",
		stage: "active",
		plan: "Growth",
		mrr: 480_000,
		owner: GRACE,
		active: 64,
		trend: -18,
		lastActiveDays: 2,
		sinceDays: 540,
		risk: [1, 0, 1],
		tags: ["renewal-q1"],
	},
	{
		n: 4,
		name: "Acme Corp",
		domain: "acme.com",
		stage: "past_due",
		plan: "Growth",
		mrr: 215_000,
		owner: ALAN,
		active: 22,
		trend: -42,
		lastActiveDays: 9,
		sinceDays: 610,
		risk: [2, 1, 0],
	},
	{
		n: 5,
		name: "Globex",
		domain: "globex.io",
		stage: "active",
		plan: "Pro",
		mrr: 129_900,
		owner: null,
		active: 18,
		trend: 0,
		lastActiveDays: 4,
		sinceDays: 300,
	},
	{
		n: 6,
		name: "Initech",
		domain: "initech.com",
		stage: "trialing",
		plan: "Pro",
		mrr: 0,
		owner: KATHERINE,
		active: 9,
		trend: 25,
		lastActiveDays: 0,
		sinceDays: 10,
		opportunities: 2,
		tags: ["pql"],
	},
	{
		n: 7,
		name: "Umbrella",
		domain: "umbrella.co",
		stage: "active",
		plan: "Starter",
		mrr: 49_900,
		owner: GRACE,
		active: 6,
		trend: -7,
		lastActiveDays: 15,
		sinceDays: 200,
		risk: [0, 1, 0],
	},
	{
		n: 8,
		name: "Hooli",
		domain: "hooli.xyz",
		stage: "active",
		plan: "Enterprise",
		mrr: 990_000,
		owner: KATHERINE,
		active: 140,
		trend: 4,
		lastActiveDays: 0,
		sinceDays: 900,
		tags: ["strategic", "design-partner"],
	},
	{
		n: 9,
		name: "Stark Industries",
		domain: "stark.com",
		stage: "trialing",
		plan: "Growth",
		mrr: 0,
		owner: null,
		active: 3,
		trend: null,
		lastActiveDays: 3,
		sinceDays: 5,
	},
	{
		n: 10,
		name: "Wayne Enterprises",
		domain: "wayne.com",
		stage: "active",
		plan: "Growth",
		mrr: 365_000,
		owner: ALAN,
		active: 51,
		trend: 9,
		lastActiveDays: 1,
		sinceDays: 480,
	},
	{
		n: 11,
		name: "Soylent",
		domain: "soylent.com",
		stage: "active",
		plan: "Pro",
		mrr: 89_000,
		owner: ADA,
		active: 12,
		trend: -3,
		lastActiveDays: 6,
		sinceDays: 150,
		risk: [0, 0, 2],
	},
	{
		n: 12,
		name: "Vandelay Industries",
		domain: "vandelay.com",
		stage: "churned",
		plan: null,
		mrr: 0,
		owner: GRACE,
		active: 0,
		trend: null,
		lastActiveDays: 70,
		sinceDays: 800,
	},
	{
		n: 13,
		name: "Pied Piper",
		domain: "piedpiper.com",
		stage: "lead",
		plan: null,
		mrr: 0,
		owner: null,
		active: 2,
		trend: null,
		lastActiveDays: 20,
		sinceDays: 30,
	},
	{
		n: 14,
		name: "Massive Dynamic",
		domain: "massivedynamic.com",
		stage: "active",
		plan: "Starter",
		mrr: 29_900,
		owner: KATHERINE,
		active: 4,
		trend: 55,
		lastActiveDays: null,
		sinceDays: 90,
	},
]

const accountRow = (seed: Seed) => {
	const [high, medium, low] = seed.risk ?? [0, 0, 0]
	return {
		id: accountId(seed.n),
		organizationId: orgId,
		name: seed.name,
		domains: [seed.domain],
		logoUrl: null,
		ownerUserId: seed.owner,
		lifecycleStage: seed.stage,
		lifecycleStageOverride: null,
		planName: seed.plan,
		mrrMinor: seed.mrr,
		currency: "USD",
		trialListMrrMinor: null,
		trialEndsAt: seed.stage === "trialing" ? ago(-9) : null,
		seatsUsed: null,
		seatsLimit: null,
		contactCount: seed.active,
		activeUsers30d: seed.active,
		activeUsersTrendPct: seed.trend,
		openRiskHigh: high,
		openRiskMedium: medium,
		openRiskLow: low,
		openOpportunities: seed.opportunities ?? 0,
		championContactId: null,
		championInactiveSince: null,
		lastActiveContactId: null,
		firstSeenAt: ago(seed.sinceDays),
		lastActiveAt: seed.lastActiveDays === null ? null : ago(seed.lastActiveDays),
		customerSince: seed.stage === "lead" ? null : ago(seed.sinceDays),
		churnedAt: seed.stage === "churned" ? ago(60) : null,
		tags: seed.tags ?? [],
		attributes: {},
		featureFlags: {},
		attentionMutedAt: null,
		attentionMutedUntil: null,
		attentionMutedByUserId: null,
		fieldSources: {},
		primaryAccountId: seed.primary === undefined ? null : accountId(seed.primary),
		environment: seed.environment ?? null,
		companyProfile: null,
		companyCheckedAt: null,
		createdAt: ago(seed.sinceDays),
		updatedAt: ago(0),
		deletedAt: null,
	}
}

/** 30 days of daily active users ending near the account's 30-day count, stable per account. */
const sparklineOf = (id: string) => {
	const seed = SEEDS.find((entry) => accountId(entry.n) === id)
	const base = Math.max(1, Math.round((seed?.active ?? 4) / 3))
	return Array.from({ length: 30 }, (_, day) =>
		Math.max(0, base + ((day * 7 + (seed?.n ?? 1) * 3) % 5) - 2),
	)
}

const fixture: PageFixture = {
	seed: (server) => {
		server.write("customers", orgId, "customer_accounts", SEEDS.map(accountRow))
	},
	rpcs: {
		"customers.sparklines": (payload) => ({
			sparklines: (Array.isArray(payload["accountIds"]) ? payload["accountIds"] : []).map((id) => ({
				accountId: String(id),
				values: sparklineOf(String(id)),
			})),
		}),
	},
}

export default fixture
