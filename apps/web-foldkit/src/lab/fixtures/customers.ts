import {
	type Account,
	type AccountDetail,
	type ActiveUsersPoint,
	type Connection,
	type ContactRow,
	type CustomersRange,
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_HEALTH_SETTINGS,
	EMPTY_SYNC_STATS,
	type HealthDistributionRow,
	type HealthStatus,
	type LifecycleStage,
	type MrrMovementBucket,
	type OverviewResult,
	type SeriesPoint,
	type Settings,
	type Signal,
	type SignalEvidence,
	type SignalRule,
	type SignalSeverity,
	type SignalStatus,
	type SignalTemplate,
	type SyncProgress,
	type SyncRun,
	TEMPLATES,
} from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerContactId,
	CustomerEventId,
	CustomerExternalRefId,
	CustomerInvoiceId,
	CustomerSettingsId,
	CustomerSignalId,
	CustomerSignalRuleId,
	CustomerSubscriptionId,
	CustomerSyncRunId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"

/**
 * Customers lab fixtures: one fictional org, internally consistent with the Wonder designs.
 *
 * - `NOW` is fixed (Tue 10 Nov 2026, 12:00 UTC); every age and date is relative to it.
 * - 214 accounts, $48,210 MRR: healthy 142 ($35,980) · at risk 41 ($8,140) · critical 18 ($3,310)
 *   · unknown 13 ($780). The ~20 named accounts carry the edge cases (huge MRR, trial with no MRR,
 *   churned, past due, long name, no logo); the rest are generated (seeded) to hit those totals.
 * - Signals cover every evidence viz and every status.
 * - Typed against `@hazel/domain/customers`, so a contract change breaks here first.
 */

export const NOW = new Date("2026-11-10T12:00:00Z")
const DAY = 86_400_000
const HOUR = 3_600_000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const daysAgo = (days: number) => ago(days * DAY)
const iso = (date: Date) => date.toISOString()
/** `YYYY-MM-DD` of `NOW - days`. */
export const dayOf = (days: number) => iso(daysAgo(days)).slice(0, 10)

/** Deterministic ids: `kind` keeps entity types apart. */
const uuid = (kind: number, n: number) =>
	`${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`

/** mulberry32: the same "random" data on every load. */
const prng = (seed: number) => {
	let state = seed >>> 0
	return () => {
		state = (state + 0x6d2b79f5) >>> 0
		let t = state
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
	}
}

export const ORGANIZATION_ID = Schema.decodeSync(OrganizationId)(uuid(1, 1))
export const CURRENCY = "USD"

// ---------------------------------------------------------------------------
// Team (the CSMs who own accounts)
// ---------------------------------------------------------------------------

export type TeamMember = Readonly<{ id: UserId; name: string; email: string; avatarUrl: string | null }>

const member = (n: number, name: string, email: string): TeamMember => ({
	id: Schema.decodeSync(UserId)(uuid(2, n)),
	name,
	email,
	avatarUrl: null,
})

export const MAYA = member(1, "Maya Reinhardt", "maya@hazel.sh")
export const JONAS = member(2, "Jonas Ortega", "jonas@hazel.sh")
export const DANA = member(3, "Dana Kim", "dana@hazel.sh")
export const PRIYA = member(4, "Priya Shah", "priya@hazel.sh")
export const TEAM: ReadonlyArray<TeamMember> = [MAYA, JONAS, DANA, PRIYA]
/** The signed-in user ("Mine"). */

export const memberOf = (id: UserId | null): TeamMember | null =>
	TEAM.find((entry) => entry.id === id) ?? null

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

type AccountSeed = Readonly<{
	name: string
	domain: string | null
	plan: string | null
	mrr: number
	health: HealthStatus
	score: number | null
	stage?: LifecycleStage
	owner?: TeamMember | null
	contacts?: number
	active30d?: number
	trendPct?: number | null
	lastActiveHours?: number | null
	sinceDays?: number | null
	firstSeenDays?: number
	trialEndsInDays?: number
	trialListMrr?: number
	churnedDaysAgo?: number
	seats?: readonly [number, number]
	risk?: readonly [high: number, medium: number, low: number]
	opportunities?: number
	tags?: ReadonlyArray<string>
	logoUrl?: string | null
}>

/** `n` is the account's number (1-based): its id, default owner and age come from it. */
const makeAccount = (seed: AccountSeed, n: number): Account => {
	const stage = seed.stage ?? (seed.mrr > 0 ? "active" : "lead")
	const [high, medium, low] = seed.risk ?? [0, 0, 0]
	const firstSeen = daysAgo(seed.firstSeenDays ?? 200 + ((n * 37) % 500))
	return {
		id: Schema.decodeSync(CustomerAccountId)(uuid(10, n)),
		organizationId: ORGANIZATION_ID,
		name: seed.name,
		domains: seed.domain === null ? [] : [seed.domain],
		logoUrl: seed.logoUrl ?? null,
		ownerUserId:
			seed.owner === undefined ? (TEAM[n % TEAM.length]?.id ?? null) : (seed.owner?.id ?? null),
		lifecycleStage: stage,
		lifecycleStageOverride: null,
		planName: seed.plan,
		mrrMinor: seed.mrr * 100,
		currency: CURRENCY,
		trialListMrrMinor: seed.trialListMrr === undefined ? null : seed.trialListMrr * 100,
		trialEndsAt:
			seed.trialEndsInDays === undefined ? null : new Date(NOW.getTime() + seed.trialEndsInDays * DAY),
		healthScore: seed.score,
		healthStatus: seed.health,
		healthUpdatedAt: ago(HOUR),
		seatsUsed: seed.seats?.[0] ?? null,
		seatsLimit: seed.seats?.[1] ?? null,
		contactCount: seed.contacts ?? 8,
		activeUsers30d: seed.active30d ?? 4,
		activeUsersTrendPct: seed.trendPct === undefined ? 0 : seed.trendPct,
		openRiskHigh: high,
		openRiskMedium: medium,
		openRiskLow: low,
		openOpportunities: seed.opportunities ?? 0,
		championContactId: null,
		championInactiveSince: null,
		lastActiveContactId: null,
		firstSeenAt: firstSeen,
		lastActiveAt: seed.lastActiveHours === null ? null : ago((seed.lastActiveHours ?? 30) * HOUR),
		customerSince:
			seed.sinceDays === null
				? null
				: seed.sinceDays !== undefined
					? daysAgo(seed.sinceDays)
					: seed.mrr > 0
						? firstSeen
						: null,
		churnedAt: seed.churnedDaysAgo === undefined ? null : daysAgo(seed.churnedDaysAgo),
		tags: seed.tags ?? [],
		attributes: {},
		fieldSources: { name: "clerk", mrrMinor: "stripe", lastActiveAt: "maple" },
		createdAt: firstSeen,
		updatedAt: ago(HOUR),
		deletedAt: null,
	}
}

/** The edge cases, by name. */
const NAMED_SEEDS = {
	northwind: {
		name: "Northwind Labs",
		domain: "northwind.dev",
		plan: "Scale",
		mrr: 4_800,
		health: "healthy",
		score: 82,
		owner: MAYA,
		contacts: 51,
		active30d: 42,
		trendPct: 12.4,
		lastActiveHours: 2,
		seats: [42, 50],
		opportunities: 1,
		sinceDays: 610,
	},
	acme: {
		name: "Acme Robotics",
		domain: "acmerobotics.io",
		plan: "Growth",
		mrr: 2_150,
		health: "at_risk",
		score: 54,
		stage: "past_due",
		owner: JONAS,
		contacts: 24,
		active30d: 18,
		trendPct: -21.5,
		lastActiveHours: 72,
		risk: [1, 0, 0],
		tags: ["enterprise-pilot"],
		sinceDays: 410,
	},
	kestrel: {
		name: "Kestrel Systems",
		domain: "kestrel.so",
		plan: "Scale",
		mrr: 1_320,
		health: "critical",
		score: 27,
		owner: MAYA,
		contacts: 14,
		active30d: 9,
		trendPct: -64,
		lastActiveHours: 18 * 24,
		risk: [1, 1, 0],
		sinceDays: 380,
	},
	brightfield: {
		name: "Brightfield Analytics",
		domain: "brightfield.co",
		plan: "Trial",
		mrr: 0,
		health: "unknown",
		score: null,
		stage: "trialing",
		owner: null,
		contacts: 7,
		active30d: 6,
		trendPct: null,
		lastActiveHours: 5 * 24,
		trialEndsInDays: 4,
		trialListMrr: 490,
		risk: [0, 1, 0],
		firstSeenDays: 10,
		sinceDays: null,
	},
	halcyon: {
		name: "Halcyon Health",
		domain: "halcyonhealth.com",
		plan: "Enterprise",
		mrr: 8_900,
		health: "healthy",
		score: 91,
		owner: DANA,
		contacts: 212,
		active30d: 168,
		trendPct: 4.2,
		lastActiveHours: 1,
		seats: [168, 250],
		sinceDays: 900,
		tags: ["enterprise", "annual"],
	},
	oakridge: {
		name: "Oakridge Logistics",
		domain: "oakridge-logistics.com",
		plan: null,
		mrr: 0,
		health: "unknown",
		score: null,
		stage: "churned",
		owner: JONAS,
		contacts: 9,
		active30d: 0,
		trendPct: null,
		lastActiveHours: 41 * 24,
		churnedDaysAgo: 20,
		sinceDays: 300,
	},
	consolidated: {
		name: "Consolidated International Widget Manufacturing Holdings GmbH",
		domain: "ciwmh.de",
		plan: "Growth",
		mrr: 640,
		health: "at_risk",
		score: 48,
		owner: PRIYA,
		contacts: 33,
		active30d: 11,
		trendPct: -42.5,
		lastActiveHours: 26,
		risk: [0, 1, 0],
	},
	pinecone: {
		name: "Pinecone Studio",
		domain: null,
		plan: null,
		mrr: 0,
		health: "unknown",
		score: null,
		stage: "lead",
		owner: null,
		contacts: 2,
		active30d: 1,
		trendPct: null,
		lastActiveHours: 9 * 24,
		firstSeenDays: 3,
	},
	lumen: {
		name: "Lumen Health",
		domain: "lumen.health",
		plan: "Growth",
		mrr: 890,
		health: "at_risk",
		score: 61,
		owner: DANA,
		contacts: 19,
		active30d: 12,
		trendPct: -8,
		lastActiveHours: 6,
		risk: [1, 0, 0],
	},
	fernway: {
		name: "Fernway",
		domain: "fernway.app",
		plan: "Starter",
		mrr: 380,
		health: "critical",
		score: 36,
		owner: PRIYA,
		contacts: 6,
		active30d: 2,
		trendPct: -55,
		lastActiveHours: 4 * 24,
		risk: [0, 1, 0],
	},
	quarry: {
		name: "Quarry Labs",
		domain: "quarrylabs.io",
		plan: "Growth",
		mrr: 1_150,
		health: "healthy",
		score: 88,
		owner: MAYA,
		contacts: 26,
		active30d: 20,
		trendPct: 96,
		lastActiveHours: 3,
		opportunities: 1,
		seats: [20, 25],
	},
	tidewater: {
		name: "Tidewater Co",
		domain: "tidewater.co",
		plan: "Starter",
		mrr: 290,
		health: "critical",
		score: 31,
		owner: JONAS,
		contacts: 5,
		active30d: 1,
		trendPct: null,
		lastActiveHours: 8 * 24,
		firstSeenDays: 12,
		sinceDays: 12,
		risk: [0, 0, 1],
	},
	marlow: {
		name: "Marlow & Finch",
		domain: "marlowfinch.com",
		plan: "Growth",
		mrr: 760,
		health: "at_risk",
		score: 57,
		owner: MAYA,
		contacts: 17,
		active30d: 10,
		trendPct: -12,
		lastActiveHours: 20,
		risk: [0, 1, 0],
	},
	vantablack: {
		name: "Vantablack Studios",
		domain: "vantablack.studio",
		plan: "Scale",
		mrr: 990,
		health: "critical",
		score: 22,
		stage: "past_due",
		owner: DANA,
		contacts: 11,
		active30d: 7,
		trendPct: -18,
		lastActiveHours: 30,
		risk: [1, 0, 0],
	},
	cobalt: {
		name: "Cobalt Freight",
		domain: "cobaltfreight.com",
		plan: "Growth",
		mrr: 520,
		health: "at_risk",
		score: 49,
		owner: MAYA,
		contacts: 15,
		active30d: 6,
		trendPct: -36,
		lastActiveHours: 50,
	},
	juniper: {
		name: "Juniper AI",
		domain: "juniper.ai",
		plan: "Growth",
		mrr: 690,
		health: "healthy",
		score: 76,
		owner: MAYA,
		contacts: 12,
		active30d: 10,
		trendPct: 3,
		lastActiveHours: 4,
	},
	ridgeview: {
		name: "Ridgeview Partners",
		domain: "ridgeview.partners",
		plan: "Starter",
		mrr: 310,
		health: "at_risk",
		score: 52,
		owner: PRIYA,
		contacts: 4,
		active30d: 2,
		trendPct: -10,
		lastActiveHours: 15 * 24,
	},
	sable: {
		name: "Sable Analytics",
		domain: "sable.dev",
		plan: "Starter",
		mrr: 480,
		health: "healthy",
		score: 79,
		owner: JONAS,
		contacts: 9,
		active30d: 7,
		trendPct: 6,
		lastActiveHours: 8,
	},
} satisfies Record<string, AccountSeed>

export type NamedAccount = keyof typeof NAMED_SEEDS

/** The named accounts, by key (`ACCOUNTS_BY_KEY.acme`). */
export const ACCOUNTS_BY_KEY = Object.fromEntries(
	Object.entries(NAMED_SEEDS).map(([key, seed], index) => [key, makeAccount(seed, index + 1)]),
) as Readonly<Record<NamedAccount, Account>>

const PREFIXES = [
	"Atlas",
	"Beacon",
	"Cedar",
	"Delta",
	"Ember",
	"Falcon",
	"Granite",
	"Harbor",
	"Iris",
	"Jasper",
	"Keystone",
	"Lattice",
	"Meridian",
	"Nimbus",
	"Orchid",
	"Prism",
	"Quill",
	"Redwood",
	"Summit",
	"Thistle",
	"Umber",
	"Vertex",
	"Willow",
	"Zephyr",
	"Alder",
	"Birch",
	"Coral",
	"Dune",
	"Echo",
	"Fjord",
	"Glade",
	"Helix",
]
const SUFFIXES = [
	"Labs",
	"Systems",
	"Analytics",
	"Health",
	"Logistics",
	"Software",
	"Studio",
	"Cloud",
	"Works",
	"Partners",
	"AI",
	"Bio",
	"Data",
	"Finance",
	"Media",
	"Robotics",
]
const PLANS_BY_MRR = (mrr: number): string | null =>
	mrr === 0 ? null : mrr < 150 ? "Starter" : mrr < 700 ? "Growth" : mrr < 3_000 ? "Scale" : "Enterprise"

/** Status → [count, MRR] the whole book must reach (the overview's health distribution). */
export const HEALTH_TOTALS = {
	healthy: [142, 35_980],
	at_risk: [41, 8_140],
	critical: [18, 3_310],
	unknown: [13, 780],
} as const satisfies Record<HealthStatus, readonly [count: number, mrr: number]>

const generated = (() => {
	const random = prng(214)
	const named = Object.values(NAMED_SEEDS) as ReadonlyArray<AccountSeed>
	const seeds: Array<AccountSeed> = []
	let nameIndex = 0
	const nextName = () => {
		const name = `${PREFIXES[nameIndex % PREFIXES.length]} ${SUFFIXES[Math.floor(nameIndex / PREFIXES.length) % SUFFIXES.length]}`
		nameIndex += 1
		return name
	}
	for (const status of ["healthy", "at_risk", "critical", "unknown"] as const) {
		const [count, mrr] = HEALTH_TOTALS[status]
		const own = named.filter((seed) => seed.health === status)
		const remainingCount = count - own.length
		const remainingMrr = mrr - own.reduce((sum, seed) => sum + seed.mrr, 0)
		// Weights skewed small (most accounts are small), some at $0 for critical/unknown leads.
		const weights = Array.from({ length: remainingCount }, () => {
			const roll = random()
			return status !== "healthy" && roll < 0.3 ? 0 : roll ** 2.2 + 0.05
		})
		const total = weights.reduce((sum, weight) => sum + weight, 0)
		// Whole $10 steps rounded down; the biggest account takes the remainder, so the total is exact.
		const mrrs = weights.map((weight) => Math.floor(((weight / total) * remainingMrr) / 10) * 10)
		const biggest = weights.indexOf(Math.max(...weights))
		const remainder = remainingMrr - mrrs.reduce((sum, value) => sum + value, 0)
		const exact = mrrs.map((value, index) => (index === biggest ? value + remainder : value))
		exact.forEach((accountMrr, index) => {
			const name = nextName()
			const scoreBase = status === "healthy" ? 70 : status === "at_risk" ? 40 : 5
			const score =
				status === "unknown"
					? null
					: scoreBase +
						Math.floor(random() * (status === "healthy" ? 30 : status === "at_risk" ? 30 : 35))
			const contacts = 2 + Math.floor(random() * (accountMrr / 40 + 6))
			const active =
				status === "unknown"
					? 0
					: Math.max(
							1,
							Math.round(
								contacts * (status === "healthy" ? 0.7 : status === "at_risk" ? 0.4 : 0.15),
							),
						)
			const stage: LifecycleStage =
				accountMrr > 0
					? status === "critical" && index % 5 === 0
						? "past_due"
						: "active"
					: index % 3 === 0
						? "trialing"
						: "lead"
			seeds.push({
				name,
				domain: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
				plan: stage === "trialing" ? "Trial" : PLANS_BY_MRR(accountMrr),
				mrr: accountMrr,
				health: status,
				score,
				stage,
				contacts,
				active30d: active,
				trendPct:
					status === "unknown"
						? null
						: Math.round((random() * 60 - (status === "healthy" ? 15 : 40)) * 10) / 10,
				lastActiveHours:
					status === "unknown"
						? null
						: Math.round(
								random() * (status === "healthy" ? 48 : status === "at_risk" ? 240 : 600),
							),
				risk: status === "critical" ? [1, 0, 0] : status === "at_risk" ? [0, 1, 0] : [0, 0, 0],
				trialEndsInDays: stage === "trialing" ? 1 + Math.floor(random() * 13) : undefined,
				trialListMrr: stage === "trialing" ? 290 : undefined,
			})
		})
	}
	const namedCount = Object.keys(NAMED_SEEDS).length
	return seeds.map((seed, index) => makeAccount(seed, namedCount + index + 1))
})()

/** Every account: the named ones first, then the generated book. 214 in all. */
export const ACCOUNTS: ReadonlyArray<Account> = [...Object.values(ACCOUNTS_BY_KEY), ...generated]

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const series = (values: ReadonlyArray<number>): ReadonlyArray<SeriesPoint> =>
	values.map((value, index) => ({ day: dayOf(values.length - 1 - index), value }))

/** A 35-day DAU series: steady around `baseline`, then the last 7 days around `recent`. */
const dropSeries = (baseline: number, recent: number, seed: number): ReadonlyArray<SeriesPoint> => {
	const random = prng(seed)
	return series(
		Array.from({ length: 35 }, (_, index) => {
			const level = index < 28 ? baseline : recent
			return Math.max(0, Math.round(level * (0.8 + random() * 0.4)))
		}),
	)
}

type SignalSeed = Readonly<{
	account: NamedAccount
	template: SignalTemplate
	severity: SignalSeverity
	status?: SignalStatus
	title?: string
	reason: string
	evidence: SignalEvidence
	priority: number
	openedDaysAgo: number
	assignee?: TeamMember | null
	snoozedUntilDays?: number
	resolvedDaysAgo?: number
}>

const RULE_IDS = Object.fromEntries(
	Object.keys(TEMPLATES).map((template, index) => [
		template,
		Schema.decodeSync(CustomerSignalRuleId)(uuid(20, index + 1)),
	]),
) as Readonly<Record<SignalTemplate, CustomerSignalRuleId>>

/** `n` is the signal's number (1-based): its id and opening order come from it. */
const makeSignal = (seed: SignalSeed, n: number): SignalEntry => {
	const account = ACCOUNTS_BY_KEY[seed.account]
	const status = seed.status ?? "open"
	const opened = ago(seed.openedDaysAgo * DAY + n * HOUR)
	const resolved = seed.resolvedDaysAgo === undefined ? null : daysAgo(seed.resolvedDaysAgo)
	const signal: Signal = {
		id: Schema.decodeSync(CustomerSignalId)(uuid(21, n)),
		organizationId: ORGANIZATION_ID,
		accountId: account.id,
		ruleId: RULE_IDS[seed.template],
		template: seed.template,
		kind: TEMPLATES[seed.template].kind,
		severity: seed.severity,
		status,
		title: seed.title ?? TEMPLATES[seed.template].name,
		reason: seed.reason,
		evidence: seed.evidence,
		openingEvidence: seed.evidence,
		actionEvidence: status === "open" ? null : seed.evidence,
		priorityScore: seed.priority,
		firstDetectedAt: opened,
		openedAt: opened,
		lastEvaluatedAt: ago(HOUR),
		assigneeUserId: seed.assignee === undefined ? account.ownerUserId : (seed.assignee?.id ?? null),
		snoozedUntil:
			seed.snoozedUntilDays === undefined
				? null
				: new Date(NOW.getTime() + seed.snoozedUntilDays * DAY),
		snoozedByUserId: status === "snoozed" ? MAYA.id : null,
		snoozedAt: status === "snoozed" ? daysAgo(1) : null,
		snoozeNote: status === "snoozed" ? "Waiting on their Q4 planning" : null,
		resolvedAt:
			status === "done" || status === "dismissed" || status === "auto_resolved" ? resolved : null,
		resolvedByUserId: status === "done" || status === "dismissed" ? MAYA.id : null,
		outcome: status === "done" ? "contacted" : null,
		resolutionNote: status === "done" ? "Called their CTO; they're rolling out to two more teams." : null,
		dismissReason: status === "dismissed" ? "Seasonal dip, expected" : null,
		reopenAfter: status === "done" && resolved !== null ? new Date(resolved.getTime() + 7 * DAY) : null,
		reopenCount: 0,
		closedAt: status === "auto_resolved" ? resolved : null,
		createdAt: opened,
		updatedAt: ago(HOUR),
	}
	return { signal, account }
}

/** Signals in priority order (the open queue is the `open` ones). */
export type SignalEntry = Readonly<{ signal: Signal; account: Account }>

const SIGNAL_SEEDS: ReadonlyArray<SignalSeed> = [
	{
		account: "acme",
		template: "payment_failed",
		severity: "high",
		title: "Payment failed",
		reason: "Invoice INV-2041 for $2,150 open 9 days past due, 3 retries",
		priority: 13.4,
		openedDaysAgo: 2,
		evidence: {
			_tag: "amount",
			step: 1,
			amountMinor: 215_000,
			currency: CURRENCY,
			invoiceId: Schema.decodeSync(CustomerInvoiceId)(uuid(33, 1)),
			invoiceNumber: "INV-2041",
			subscriptionStatus: "past_due",
			dueAt: iso(daysAgo(9)),
			daysOverdue: 9,
			attemptCount: 3,
			declineReason: "Card declined: insufficient funds",
			nextRetryAt: iso(new Date(NOW.getTime() + 2 * DAY)),
		},
	},
	{
		account: "kestrel",
		template: "inactive",
		severity: "high",
		title: "Stopped logging in",
		reason: "No activity for 18 days; 12 weekly active users before",
		priority: 12.1,
		openedDaysAgo: 4,
		evidence: {
			_tag: "last_active",
			step: 1,
			lastActiveAt: iso(daysAgo(18)),
			daysInactive: 18,
			priorActiveUsers: 12,
			contactId: null,
			contactName: null,
			contactEmail: null,
		},
	},
	{
		account: "northwind",
		template: "near_limit",
		severity: "medium",
		title: "Near API request limit",
		reason: "92% of 500K monthly requests used, resets in 11 days",
		priority: 9.8,
		openedDaysAgo: 1,
		assignee: null,
		evidence: {
			_tag: "limit",
			step: 0,
			metricKey: "api_requests",
			metricName: "API requests",
			value: 461_000,
			limit: 500_000,
			pct: 92.2,
		},
	},
	{
		account: "brightfield",
		template: "trial_ending_low_activation",
		severity: "medium",
		title: "Trial ending, low activation",
		reason: "Trial ends in 4 days; 1 active user in the last 7 days",
		priority: 8.6,
		openedDaysAgo: 0.25,
		assignee: MAYA,
		evidence: {
			_tag: "ratio",
			step: 0,
			value: 1,
			target: 2,
			unit: "users",
			deadline: iso(new Date(NOW.getTime() + 4 * DAY)),
			daysLeft: 4,
			ageDays: 10,
		},
	},
	{
		account: "vantablack",
		template: "payment_failed",
		severity: "high",
		title: "Payment failed",
		reason: "Subscription unpaid; invoice INV-1987 for $990 is 34 days past due",
		priority: 8.2,
		openedDaysAgo: 30,
		evidence: {
			_tag: "amount",
			step: 2,
			amountMinor: 99_000,
			currency: CURRENCY,
			invoiceId: Schema.decodeSync(CustomerInvoiceId)(uuid(33, 2)),
			invoiceNumber: "INV-1987",
			subscriptionStatus: "unpaid",
			dueAt: iso(daysAgo(34)),
			daysOverdue: 34,
			attemptCount: 4,
			declineReason: "Card expired",
			nextRetryAt: null,
		},
	},
	{
		account: "lumen",
		template: "cancel_scheduled",
		severity: "high",
		title: "Cancellation scheduled",
		reason: "Growth ($890/mo) cancels at period end on Nov 16",
		priority: 7.9,
		openedDaysAgo: 3,
		evidence: {
			_tag: "delta",
			step: 1,
			unit: "minor",
			from: 89_000,
			to: 0,
			changePct: -100,
			currency: CURRENCY,
			effectiveAt: iso(new Date(NOW.getTime() + 6 * DAY)),
			fromLabel: null,
			toLabel: null,
			reason: "Too expensive for current usage",
			series: [],
		},
	},
	{
		account: "consolidated",
		template: "usage_drop",
		severity: "medium",
		reason: "Daily active users down 42% (7-day avg 7 vs 12 before)",
		priority: 6.4,
		openedDaysAgo: 5,
		evidence: {
			_tag: "series",
			step: 0,
			metricKey: "active_users",
			recentAvg: 7,
			baselineAvg: 12.2,
			changePct: -42.5,
			recentDays: 7,
			baselineDays: 28,
			series: dropSeries(12, 7, 7),
		},
	},
	{
		account: "fernway",
		template: "health_drop",
		severity: "medium",
		title: "Health dropped",
		reason: "Health fell 36 points in 7 days, from 72 to 36",
		priority: 5.8,
		openedDaysAgo: 2,
		evidence: {
			_tag: "delta",
			step: 1,
			unit: "points",
			from: 72,
			to: 36,
			changePct: -50,
			currency: null,
			effectiveAt: null,
			fromLabel: null,
			toLabel: null,
			reason: null,
			series: series([72, 70, 66, 58, 51, 44, 40, 36]),
		},
	},
	{
		account: "marlow",
		template: "champion_inactive",
		severity: "medium",
		reason: "Eli Novak, the most active user, hasn't been seen for 16 days",
		priority: 5.5,
		openedDaysAgo: 2,
		evidence: {
			_tag: "last_active",
			step: 0,
			lastActiveAt: iso(daysAgo(16)),
			daysInactive: 16,
			priorActiveUsers: 10,
			contactId: Schema.decodeSync(CustomerContactId)(uuid(30, 99)),
			contactName: "Eli Novak",
			contactEmail: "eli@marlowfinch.com",
		},
	},
	{
		account: "quarry",
		template: "seat_growth",
		severity: "low",
		title: "Seat growth",
		reason: "Active users up 150% in 30 days, from 8 to 20",
		priority: 4.6,
		openedDaysAgo: 6,
		evidence: {
			_tag: "delta",
			step: 1,
			unit: "users",
			from: 8,
			to: 20,
			changePct: 150,
			currency: null,
			effectiveAt: null,
			fromLabel: null,
			toLabel: null,
			reason: null,
			series: series([8, 9, 9, 11, 12, 14, 15, 17, 18, 20]),
		},
	},
	{
		account: "tidewater",
		template: "onboarding_stalled",
		severity: "low",
		reason: "Signed up 12 days ago; 1 of 5 contacts has ever been active",
		priority: 3.1,
		openedDaysAgo: 5,
		evidence: {
			_tag: "ratio",
			step: 0,
			value: 1,
			target: 2,
			unit: "contacts",
			deadline: null,
			daysLeft: null,
			ageDays: 12,
		},
	},
	// Not open: every other status.
	{
		account: "cobalt",
		template: "usage_drop",
		severity: "medium",
		status: "snoozed",
		reason: "Daily active users down 36% (7-day avg 4 vs 6.3 before)",
		priority: 5.2,
		openedDaysAgo: 8,
		snoozedUntilDays: 3,
		evidence: {
			_tag: "series",
			step: 0,
			metricKey: "active_users",
			recentAvg: 4,
			baselineAvg: 6.3,
			changePct: -36.5,
			recentDays: 7,
			baselineDays: 28,
			series: dropSeries(6, 4, 11),
		},
	},
	{
		account: "ridgeview",
		template: "inactive",
		severity: "medium",
		status: "snoozed",
		title: "Stopped logging in",
		reason: "No activity for 15 days; 2 weekly active users before",
		priority: 3.4,
		openedDaysAgo: 1,
		snoozedUntilDays: 1,
		evidence: {
			_tag: "last_active",
			step: 0,
			lastActiveAt: iso(daysAgo(15)),
			daysInactive: 15,
			priorActiveUsers: 2,
			contactId: null,
			contactName: null,
			contactEmail: null,
		},
	},
	{
		account: "juniper",
		template: "usage_drop",
		severity: "medium",
		status: "done",
		reason: "Daily active users down 33% (7-day avg 6 vs 9 before)",
		priority: 4.1,
		openedDaysAgo: 12,
		resolvedDaysAgo: 3,
		evidence: {
			_tag: "series",
			step: 0,
			metricKey: "active_users",
			recentAvg: 6,
			baselineAvg: 9,
			changePct: -33.3,
			recentDays: 7,
			baselineDays: 28,
			series: dropSeries(9, 6, 13),
		},
	},
	{
		account: "ridgeview",
		template: "health_drop",
		severity: "low",
		status: "dismissed",
		title: "Health dropped",
		reason: "Health fell 21 points in 7 days, from 73 to 52",
		priority: 2.2,
		openedDaysAgo: 9,
		resolvedDaysAgo: 6,
		evidence: {
			_tag: "delta",
			step: 0,
			unit: "points",
			from: 73,
			to: 52,
			changePct: -28.8,
			currency: null,
			effectiveAt: null,
			fromLabel: null,
			toLabel: null,
			reason: null,
			series: [],
		},
	},
	{
		account: "sable",
		template: "inactive",
		severity: "medium",
		status: "auto_resolved",
		title: "Stopped logging in",
		reason: "No activity for 14 days; 5 weekly active users before",
		priority: 3.0,
		openedDaysAgo: 10,
		resolvedDaysAgo: 2,
		evidence: {
			_tag: "last_active",
			step: 0,
			lastActiveAt: iso(daysAgo(16)),
			daysInactive: 14,
			priorActiveUsers: 5,
			contactId: null,
			contactName: null,
			contactEmail: null,
		},
	},
]

/** Every signal with its account, in priority order. */
export const SIGNAL_ENTRIES: ReadonlyArray<SignalEntry> = SIGNAL_SEEDS.map((seed, index) =>
	makeSignal(seed, index + 1),
)
/** The open queue, highest priority first. */
export const OPEN_ENTRIES = SIGNAL_ENTRIES.filter((entry) => entry.signal.status === "open")
export const SIGNALS: ReadonlyArray<Signal> = SIGNAL_ENTRIES.map((entry) => entry.signal)
export const OPEN_SIGNALS = OPEN_ENTRIES.map((entry) => entry.signal)

// ---------------------------------------------------------------------------
// Rules and settings
// ---------------------------------------------------------------------------

export const RULES: ReadonlyArray<SignalRule> = (Object.keys(TEMPLATES) as ReadonlyArray<SignalTemplate>).map(
	(template) => {
		const meta = TEMPLATES[template]
		const matching = SIGNALS.filter(
			(signal) => signal.template === template && signal.status === "open",
		).length
		return {
			id: RULE_IDS[template],
			organizationId: ORGANIZATION_ID,
			name: meta.name,
			template,
			kind: meta.kind,
			severity: meta.defaultSeverity,
			config: meta.defaultConfig,
			scope: {},
			// One rule off, so the rules list shows a disabled row.
			enabled: template !== "health_drop",
			createdBy: null,
			updatedBy: null,
			lastTriggeredAt: matching > 0 ? daysAgo(1) : null,
			matchingCount: matching,
			createdAt: daysAgo(120),
			updatedAt: daysAgo(120),
			deletedAt: null,
		}
	},
)

export const SETTINGS: Settings = {
	id: Schema.decodeSync(CustomerSettingsId)(uuid(22, 1)),
	organizationId: ORGANIZATION_ID,
	health: DEFAULT_HEALTH_SETTINGS,
	reportingCurrency: CURRENCY,
	addOnPlans: [],
	lastComputedAt: ago(HOUR),
	updatedBy: null,
	createdAt: daysAgo(120),
	updatedAt: daysAgo(30),
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const connection = (
	n: number,
	provider: Connection["provider"],
	overrides: Partial<Connection>,
): Connection => ({
	id: Schema.decodeSync(CustomerConnectionId)(uuid(23, n)),
	organizationId: ORGANIZATION_ID,
	provider,
	status: "active",
	externalAccountId: null,
	externalAccountName: null,
	config: DEFAULT_CONNECTION_CONFIG[provider],
	connectedBy: MAYA.id,
	connectedAt: daysAgo(120),
	hasWebhookSecret: true,
	lastSyncAt: ago(4 * 60_000),
	lastSuccessAt: ago(4 * 60_000),
	lastErrorAt: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAt: new Date(NOW.getTime() + 56 * 60_000),
	backfilledAt: daysAgo(119),
	stats: EMPTY_SYNC_STATS,
	disconnectedAt: null,
	createdAt: daysAgo(120),
	updatedAt: ago(4 * 60_000),
	...overrides,
})

/** Clerk connected, Stripe syncing, Maple failing; Autumn is not connected (no row). */
export const CLERK_CONNECTION = connection(1, "clerk", {
	externalAccountName: "Hazel production",
	stats: { ...EMPTY_SYNC_STATS, accounts: 214, contacts: 1_862, events: 48_210 },
})
export const STRIPE_CONNECTION = connection(2, "stripe", {
	externalAccountName: "Hazel Inc.",
	lastSyncAt: ago(2 * 60_000),
	stats: { ...EMPTY_SYNC_STATS, accounts: 198, subscriptions: 203, invoices: 1_204 },
})
/** When Maple's sync last failed. */
export const MAPLE_ERROR_AT = ago(2 * HOUR)
export const MAPLE_CONNECTION = connection(4, "maple", {
	status: "error",
	lastSyncAt: ago(2 * HOUR),
	lastSuccessAt: new Date("2026-11-09T18:42:00Z"),
	lastErrorAt: MAPLE_ERROR_AT,
	lastError: { code: "auth", message: "API key was revoked.", httpStatus: 401 },
	consecutiveFailures: 3,
	config: DEFAULT_CONNECTION_CONFIG.maple,
})
export const CONNECTIONS: ReadonlyArray<Connection> = [CLERK_CONNECTION, STRIPE_CONNECTION, MAPLE_CONNECTION]

/** The Stripe backfill in flight. */
export const STRIPE_PROGRESS: SyncProgress = { step: "invoices", done: 1_204, total: 3_310 }

export const SYNC_RUNS: ReadonlyArray<SyncRun> = [
	{
		id: Schema.decodeSync(CustomerSyncRunId)(uuid(24, 1)),
		organizationId: ORGANIZATION_ID,
		connectionId: STRIPE_CONNECTION.id,
		provider: "stripe",
		trigger: "backfill",
		status: "running",
		startedAt: ago(6 * 60_000),
		finishedAt: null,
		progress: STRIPE_PROGRESS,
		stats: { ...EMPTY_SYNC_STATS, invoices: 1_204 },
		error: null,
		cursor: "in_1Q8f2Lk",
	},
]

// ---------------------------------------------------------------------------
// Overview (`customers.overview`)
// ---------------------------------------------------------------------------

/** Oct 2026's bucket matches the design's tooltip: +$9,400 / +$3,600 / −$1,000 / −$2,600. */
const MONTHLY_MOVEMENTS: ReadonlyArray<
	readonly [newMrr: number, expansion: number, contraction: number, churn: number]
> = [
	[5_200, 2_300, -900, -2_400],
	[4_400, 1_700, -1_300, -3_100],
	[6_100, 2_400, -700, -1_800],
	[5_800, 3_200, -1_400, -2_900],
	[7_400, 2_200, -1_200, -3_400],
	[6_800, 3_400, -800, -2_900],
	[7_900, 3_100, -1_100, -2_600],
	[6_200, 2_800, -1_500, -3_500],
	[7_000, 2_900, -900, -2_200],
	[6_600, 3_000, -1_200, -3_700],
	[9_400, 3_600, -1_000, -2_600],
	[8_600, 4_600, -1_400, -2_200],
]

const movement = (
	start: string,
	values: readonly [number, number, number, number],
	seed: number,
): MrrMovementBucket => {
	const [newMrr, expansion, contraction, churn] = values
	return {
		start,
		new: newMrr * 100,
		expansion: expansion * 100,
		reactivation: seed % 4 === 0 ? 29_000 : 0,
		contraction: contraction * 100,
		churn: churn * 100,
		net: (newMrr + expansion + contraction + churn) * 100 + (seed % 4 === 0 ? 29_000 : 0),
		accounts: {
			new: Math.round(newMrr / 600),
			expansion: Math.round(expansion / 400),
			reactivation: seed % 4 === 0 ? 1 : 0,
			contraction: Math.round(-contraction / 300),
			churn: Math.round(-churn / 500),
		},
	}
}

const monthStart = (monthsAgo: number) => {
	const date = new Date(Date.UTC(2026, 10 - monthsAgo, 1))
	return date.toISOString().slice(0, 10)
}

/** Daily active users for the last `days` days, ending at the design's 444 / 978 / 1,611. */
const activeUsersDaily = (days: number): ReadonlyArray<ActiveUsersPoint> => {
	const random = prng(days)
	return Array.from({ length: days }, (_, index) => {
		const fromEnd = days - 1 - index
		const weekday = new Date(NOW.getTime() - fromEnd * DAY).getUTCDay()
		const weekend = weekday === 0 || weekday === 6
		const drift = 1 - fromEnd * 0.0025
		return {
			day: dayOf(fromEnd),
			dau: fromEnd === 0 ? 444 : Math.round((weekend ? 270 : 410 + random() * 30) * drift),
			wau: fromEnd === 0 ? 978 : Math.round((900 + random() * 40) * drift),
			mau: fromEnd === 0 ? 1_611 : Math.round(1_611 * (1 - fromEnd * 0.0026)),
		}
	})
}

const bucketed = (points: ReadonlyArray<ActiveUsersPoint>, every: number): ReadonlyArray<ActiveUsersPoint> =>
	points.filter((_, index) => (points.length - 1 - index) % every === 0)

export const HEALTH_DISTRIBUTION: ReadonlyArray<HealthDistributionRow> = (
	["healthy", "at_risk", "critical", "unknown"] as const
).map((status) => ({ status, count: HEALTH_TOTALS[status][0], mrrMinor: HEALTH_TOTALS[status][1] * 100 }))

const brief = (key: NamedAccount, at: Date) => {
	const account = ACCOUNTS_BY_KEY[key]
	return {
		accountId: account.id,
		name: account.name,
		logoUrl: null,
		planName: account.planName,
		mrrMinor: account.mrrMinor,
		at,
	}
}

const mover = (key: NamedAccount, changePct: number, values: ReadonlyArray<number>) => ({
	accountId: ACCOUNTS_BY_KEY[key].id,
	name: ACCOUNTS_BY_KEY[key].name,
	logoUrl: null,
	changePct,
	series: series(values),
})

const kpi = (value: number, previous: number) => ({
	value,
	previous,
	deltaPct: previous === 0 ? null : Math.round(((value - previous) / previous) * 1000) / 10,
})

/** `customers.overview` for a range; `partial` = no billing source yet. */
export const overviewFixture = (
	range: CustomersRange,
	options: Readonly<{ partial?: boolean }> = {},
): OverviewResult => {
	const bucket = range === "12m" ? "month" : range === "90d" ? "week" : "day"
	const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
	const daily = activeUsersDaily(range === "12m" ? 360 : days)
	const activeUsers = range === "12m" ? bucketed(daily, 30) : range === "90d" ? bucketed(daily, 7) : daily
	const mrrMovements =
		range === "12m"
			? MONTHLY_MOVEMENTS.map((values, index) => movement(monthStart(11 - index), values, index))
			: Array.from({ length: bucket === "week" ? 13 : days }, (_, index) => {
					const scale = bucket === "week" ? 0.25 : 1 / 30
					const random = prng(index + days)
					const scaled = (value: number) =>
						Math.round((value * scale * (0.4 + random() * 1.2)) / 10) * 10
					const [newMrr, expansion, contraction, churn] = MONTHLY_MOVEMENTS[(index + 3) % 12] ?? [
						0, 0, 0, 0,
					]
					const values = [
						scaled(newMrr),
						scaled(expansion),
						scaled(contraction),
						scaled(churn),
					] as const
					return movement(
						dayOf((bucket === "week" ? 7 : 1) * ((bucket === "week" ? 12 : days - 1) - index)),
						values,
						index + 1,
					)
				})
	const billing = !options.partial
	return {
		range,
		currency: CURRENCY,
		bucket,
		kpis: {
			mrrMinor: kpi(billing ? 4_821_000 : 0, billing ? 4_539_600 : 0),
			payingCustomers: kpi(billing ? 176 : 0, billing ? 171 : 0),
			activeCustomers: kpi(168, 168),
			wau: kpi(978, 951),
			mau: kpi(1_611, 1_602),
			stickinessPct: { value: 61, previous: 59, deltaPct: 2 },
			logoChurn: { value: 2.8, previous: 1.9, deltaPct: 0.9 },
			atRiskMrrMinor: kpi(billing ? 545_000 : 0, billing ? 612_000 : 0),
			nrrPct: billing ? kpi(104.2, 101.8) : null,
		},
		mrrMovements: billing ? mrrMovements : [],
		activeUsers,
		healthDistribution: HEALTH_DISTRIBUTION,
		topMovers: {
			gainers: [
				mover("quarry", 150, [8, 9, 9, 11, 12, 14, 15, 17, 18, 20]),
				mover("northwind", 12.4, [36, 37, 37, 38, 39, 40, 40, 41, 42, 42]),
				mover("halcyon", 4.2, [158, 160, 161, 160, 163, 164, 165, 166, 167, 168]),
			],
			decliners: [
				mover("kestrel", -64, [12, 12, 11, 9, 7, 6, 5, 4, 3, 2]),
				mover("fernway", -55, [5, 5, 4, 4, 3, 3, 2, 2, 2, 2]),
				mover("consolidated", -42.5, [12, 13, 12, 11, 10, 9, 9, 8, 7, 7]),
			],
		},
		recentChurn: [brief("oakridge", daysAgo(20))],
		recentNew: [brief("tidewater", daysAgo(12)), brief("juniper", daysAgo(26))],
		hasData: { activity: true, billing },
	}
}

/** No sources connected yet. */
// ---------------------------------------------------------------------------
// One account (`customers.account.detail`): Acme Robotics, past due
// ---------------------------------------------------------------------------

const contactRow = (
	n: number,
	name: string,
	email: string,
	role: string,
	lastSeenDays: number | null,
	signIns: number,
): ContactRow => ({
	contact: {
		id: Schema.decodeSync(CustomerContactId)(uuid(30, n)),
		accountId: ACCOUNTS_BY_KEY.acme.id,
		email,
		name,
		avatarUrl: null,
		title: null,
		role,
		isBillingContact: role === "admin" && n === 1,
		joinedAt: daysAgo(400),
		firstActiveAt: daysAgo(399),
		lastSeenAt: lastSeenDays === null ? null : daysAgo(lastSeenDays),
		lastSignInAt: lastSeenDays === null ? null : daysAgo(lastSeenDays),
		signInCount30d: signIns,
		eventCount30d: signIns * 41,
		attributes: {},
		fieldSources: { email: "clerk" },
		createdAt: daysAgo(400),
		updatedAt: daysAgo(1),
		deletedAt: null,
	},
	status: lastSeenDays === null ? "never_active" : lastSeenDays <= 30 ? "active" : "dormant",
	activity: series(
		Array.from({ length: 30 }, (_, index) =>
			lastSeenDays !== null && 29 - index >= lastSeenDays ? (index * 7 + n * 3) % 9 : 0,
		),
	),
})

export const ACME_DETAIL: AccountDetail = {
	account: ACCOUNTS_BY_KEY.acme,
	refs: [
		{
			id: Schema.decodeSync(CustomerExternalRefId)(uuid(31, 1)),
			connectionId: CLERK_CONNECTION.id,
			provider: "clerk",
			entityType: "account",
			entityId: ACCOUNTS_BY_KEY.acme.id,
			accountId: ACCOUNTS_BY_KEY.acme.id,
			externalId: "org_2acmeRobotics",
			externalUrl:
				"https://dashboard.clerk.com/apps/app_hazel/instances/ins_prod/organizations/org_2acmeRobotics",
			matchMethod: "created",
			matchedByUserId: null,
			matchedAt: daysAgo(410),
			lastSyncedAt: ago(4 * 60_000),
			staleAt: null,
			createdAt: daysAgo(410),
			updatedAt: ago(4 * 60_000),
		},
		{
			id: Schema.decodeSync(CustomerExternalRefId)(uuid(31, 2)),
			connectionId: STRIPE_CONNECTION.id,
			provider: "stripe",
			entityType: "account",
			entityId: ACCOUNTS_BY_KEY.acme.id,
			accountId: ACCOUNTS_BY_KEY.acme.id,
			externalId: "cus_Q8f2Lk",
			externalUrl: "https://dashboard.stripe.com/customers/cus_Q8f2Lk",
			matchMethod: "shared_id",
			matchedByUserId: null,
			matchedAt: daysAgo(400),
			lastSyncedAt: ago(2 * 60_000),
			staleAt: null,
			createdAt: daysAgo(400),
			updatedAt: ago(2 * 60_000),
		},
	],
	subscriptions: [
		{
			id: Schema.decodeSync(CustomerSubscriptionId)(uuid(32, 1)),
			accountId: ACCOUNTS_BY_KEY.acme.id,
			provider: "stripe",
			externalId: "sub_1Q8f2LkAcme",
			planName: "Growth",
			status: "past_due",
			mrrMinor: 215_000,
			listMrrMinor: 215_000,
			currency: CURRENCY,
			interval: "month",
			quantity: 1,
			startedAt: daysAgo(410),
			trialEndsAt: null,
			currentPeriodEnd: new Date(NOW.getTime() + 21 * DAY),
			cancelAtPeriodEnd: false,
			canceledAt: null,
			cancellationReason: null,
			paymentMethod: { brand: "visa", last4: "4242", expMonth: 8, expYear: 2027 },
			createdAt: daysAgo(410),
			updatedAt: daysAgo(9),
		},
	],
	upcomingInvoice: null,
	openInvoices: [
		{
			id: Schema.decodeSync(CustomerInvoiceId)(uuid(33, 1)),
			accountId: ACCOUNTS_BY_KEY.acme.id,
			subscriptionId: Schema.decodeSync(CustomerSubscriptionId)(uuid(32, 1)),
			provider: "stripe",
			externalId: "in_1Q8f2LkAcme",
			number: "INV-2041",
			status: "open",
			amountDueMinor: 215_000,
			amountPaidMinor: 0,
			currency: CURRENCY,
			issuedAt: daysAgo(39),
			dueAt: daysAgo(9),
			paidAt: null,
			attemptCount: 3,
			nextRetryAt: new Date(NOW.getTime() + 2 * DAY),
			declineReason: "Card declined: insufficient funds",
			hostedUrl: "https://invoice.stripe.com/i/acct_hazel/in_1Q8f2LkAcme",
			createdAt: daysAgo(39),
			updatedAt: daysAgo(1),
		},
	],
	health: {
		score: 54,
		status: "at_risk",
		components: [
			{
				key: "usage",
				score: 55,
				weight: 35,
				effectiveWeight: 35,
				excluded: false,
				why: "18 of 24 contacts active in 30 days; trend −22%",
			},
			{
				key: "engagement",
				score: 90,
				weight: 25,
				effectiveWeight: 25,
				excluded: false,
				why: "Last active 3 days ago",
			},
			{
				key: "billing",
				score: 20,
				weight: 25,
				effectiveWeight: 25,
				excluded: false,
				why: "Subscription past due; INV-2041 9 days overdue",
			},
			{
				key: "signals",
				score: 70,
				weight: 15,
				effectiveWeight: 15,
				excluded: false,
				why: "1 open high-severity risk signal",
			},
		],
	},
	healthSeries: series(
		Array.from({ length: 90 }, (_, index) =>
			index < 75 ? 72 + ((index * 5) % 7) : 72 - (index - 74) * 1.2,
		).map(Math.round),
	),
	activeUsersSeries: series(
		Array.from({ length: 30 }, (_, index) =>
			Math.max(3, Math.round(14 - index * 0.25 + ((index * 7) % 5))),
		),
	),
	contactsToReach: [
		contactRow(1, "Hannah Weiss", "hannah@acmerobotics.io", "admin", 3, 22),
		contactRow(2, "Omar Haddad", "omar@acmerobotics.io", "member", 1, 28),
		contactRow(3, "Lena Fischer", "lena@acmerobotics.io", "admin", 12, 6),
	],
	recentEvents: [
		{
			id: Schema.decodeSync(CustomerEventId)(uuid(34, 1)),
			accountId: ACCOUNTS_BY_KEY.acme.id,
			contactId: null,
			provider: "stripe",
			type: "invoice.payment_failed",
			title: "Payment failed for INV-2041 ($2,150.00)",
			data: { attempt: 3 },
			occurredAt: daysAgo(2),
			externalId: "evt_3",
			actorUserId: null,
			createdAt: daysAgo(2),
		},
		{
			id: Schema.decodeSync(CustomerEventId)(uuid(34, 2)),
			accountId: ACCOUNTS_BY_KEY.acme.id,
			contactId: null,
			provider: "hazel",
			type: "signal.opened",
			title: "Signal opened: Payment failed",
			data: {},
			occurredAt: daysAgo(2),
			externalId: null,
			actorUserId: null,
			createdAt: daysAgo(2),
		},
		{
			id: Schema.decodeSync(CustomerEventId)(uuid(34, 3)),
			accountId: ACCOUNTS_BY_KEY.acme.id,
			contactId: null,
			provider: "clerk",
			type: "contact.joined",
			title: "Omar Haddad joined",
			data: {},
			occurredAt: daysAgo(15),
			externalId: "evt_clerk_1",
			actorUserId: null,
			createdAt: daysAgo(15),
		},
	],
}

/** 14 days of daily active users for an account (bar sparkline evidence). */
export const DAU_14D: ReadonlyArray<number> = [9, 11, 10, 12, 6, 5, 11, 10, 9, 7, 4, 3, 5, 2]
