import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId, userRows } from "../snapshot"

/**
 * `/hazel/customers/attention`: six customers (one with an EU environment) and their signals, open,
 * snoozed and resolved, around the harness's pinned clock; the preview's account detail by RPC.
 */

const NOW = Date.parse("2026-11-26T15:00:00Z")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(ms).toISOString()
const ago = (ms: number) => at(NOW - ms)

const graceUserId = userRows[1]?.id ?? adaUserId
const alanUserId = userRows[2]?.id ?? adaUserId

const accountId = (n: number) => `0000c001-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const signalId = (n: number) => `0000c002-0000-4000-8000-${n.toString(16).padStart(12, "0")}`
const ruleId = (n: number) => `0000c003-0000-4000-8000-${n.toString(16).padStart(12, "0")}`

interface AccountSeed {
	readonly n: number
	readonly name: string
	readonly domain: string
	readonly plan: string | null
	readonly mrr: number
	readonly stage: "lead" | "trialing" | "active" | "past_due" | "churned"
	readonly owner: string | null
	readonly primary?: number
	readonly environment?: string
}

const ACCOUNTS: ReadonlyArray<AccountSeed> = [
	{
		n: 1,
		name: "Northwind Labs",
		domain: "northwind.dev",
		plan: "Scale",
		mrr: 420_000,
		stage: "active",
		owner: adaUserId,
	},
	{
		n: 2,
		name: "Kestrel Analytics",
		domain: "kestrel.io",
		plan: "Growth",
		mrr: 215_000,
		stage: "past_due",
		owner: null,
	},
	{
		n: 3,
		name: "Orbit Health",
		domain: "orbit.health",
		plan: "Growth",
		mrr: 129_900,
		stage: "active",
		owner: adaUserId,
	},
	{
		n: 4,
		name: "Lumen Studio",
		domain: "lumen.studio",
		plan: "Trial",
		mrr: 0,
		stage: "trialing",
		owner: graceUserId,
	},
	{
		n: 5,
		name: "Pinecrest",
		domain: "pinecrest.co",
		plan: "Starter",
		mrr: 49_000,
		stage: "active",
		owner: null,
	},
	{
		n: 6,
		name: "Northwind Labs",
		domain: "eu.northwind.dev",
		plan: "Scale",
		mrr: 180_000,
		stage: "active",
		owner: adaUserId,
		primary: 1,
		environment: "EU",
	},
]

const accountRow = (seed: AccountSeed) => ({
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
	trialEndsAt: seed.stage === "trialing" ? at(NOW + 4 * DAY) : null,
	seatsUsed: 18,
	seatsLimit: 25,
	contactCount: 24,
	activeUsers30d: 11,
	activeUsersTrendPct: -12,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	championContactId: null,
	championInactiveSince: null,
	lastActiveContactId: null,
	firstSeenAt: "2025-03-14T10:00:00.000Z",
	lastActiveAt: ago(2 * DAY),
	customerSince: "2025-04-01T10:00:00.000Z",
	churnedAt: null,
	tags: [],
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
	createdAt: "2025-03-14T10:00:00.000Z",
	updatedAt: ago(DAY),
	deletedAt: null,
})

const series = (from: number, to: number) =>
	Array.from({ length: 14 }, (_, index) => ({
		day: new Date(NOW - (13 - index) * DAY).toISOString().slice(0, 10),
		value: Math.round(from + ((to - from) * index) / 13),
	}))

const EVIDENCE = {
	payment: {
		_tag: "amount",
		step: 2,
		amountMinor: 215_000,
		currency: "USD",
		invoiceId: null,
		invoiceNumber: "INV-2041",
		subscriptionStatus: "past_due",
		dueAt: ago(6 * DAY),
		daysOverdue: 6,
		attemptCount: 3,
		declineReason: "Insufficient funds",
		nextRetryAt: at(NOW + 2 * DAY),
	},
	usage: {
		_tag: "series",
		step: 1,
		metricKey: "events",
		recentAvg: 410,
		baselineAvg: 980,
		changePct: -58.2,
		recentDays: 7,
		baselineDays: 7,
		series: series(1000, 400),
	},
	inactive: {
		_tag: "last_active",
		step: 1,
		lastActiveAt: ago(16 * DAY),
		daysInactive: 16,
		priorActiveUsers: 7,
		contactId: null,
		contactName: null,
		contactEmail: null,
	},
} as const

interface SignalSeed {
	readonly n: number
	readonly account: number
	readonly template:
		| "payment_failed"
		| "usage_drop"
		| "inactive"
		| "trial_ending_low_activation"
		| "seat_growth"
	readonly kind: "risk" | "opportunity"
	readonly severity: "high" | "medium" | "low"
	readonly status: "open" | "snoozed" | "done" | "auto_resolved"
	readonly title: string
	readonly reason: string
	readonly evidence: (typeof EVIDENCE)[keyof typeof EVIDENCE]
	readonly priority: number
	readonly openedAgo: number
	readonly assignee?: string
	readonly snoozedUntil?: number
	readonly snoozeNote?: string
	readonly resolvedAgo?: number
	readonly outcome?: "contacted" | "fixed"
	readonly note?: string
}

const SIGNALS: ReadonlyArray<SignalSeed> = [
	{
		n: 1,
		account: 2,
		template: "payment_failed",
		kind: "risk",
		severity: "high",
		status: "open",
		title: "Payment failed",
		reason: "$2,150 unpaid for 6 days, 3 attempts",
		evidence: EVIDENCE.payment,
		priority: 96,
		openedAgo: 6 * DAY,
	},
	{
		n: 2,
		account: 1,
		template: "usage_drop",
		kind: "risk",
		severity: "medium",
		status: "open",
		title: "Usage dropped",
		reason: "Events down 58% week over week",
		evidence: EVIDENCE.usage,
		priority: 81,
		openedAgo: 2 * DAY,
		assignee: adaUserId,
	},
	{
		n: 3,
		account: 1,
		template: "inactive",
		kind: "risk",
		severity: "low",
		status: "open",
		title: "Gone quiet",
		reason: "No activity for 16 days",
		evidence: EVIDENCE.inactive,
		priority: 64,
		openedAgo: 5 * HOUR,
	},
	{
		n: 4,
		account: 4,
		template: "trial_ending_low_activation",
		kind: "risk",
		severity: "medium",
		status: "open",
		title: "Trial ending, low activation",
		reason: "4 days left, 2 of 12 invited users active",
		evidence: EVIDENCE.inactive,
		priority: 72,
		openedAgo: DAY,
	},
	{
		n: 5,
		account: 3,
		template: "seat_growth",
		kind: "opportunity",
		severity: "low",
		status: "open",
		title: "Seats nearly full",
		reason: "18 of 25 seats used, up 6 this month",
		evidence: EVIDENCE.usage,
		priority: 55,
		openedAgo: 3 * DAY,
	},
	{
		n: 6,
		account: 5,
		template: "usage_drop",
		kind: "risk",
		severity: "medium",
		status: "snoozed",
		title: "Usage dropped",
		reason: "Events down 40% week over week",
		evidence: EVIDENCE.usage,
		priority: 60,
		openedAgo: 4 * DAY,
		snoozedUntil: NOW + 2 * DAY,
		snoozeNote: "Holiday week, check after",
	},
	{
		n: 7,
		account: 3,
		template: "inactive",
		kind: "risk",
		severity: "low",
		status: "snoozed",
		title: "Gone quiet",
		reason: "No activity for 9 days",
		evidence: EVIDENCE.inactive,
		priority: 40,
		openedAgo: 9 * DAY,
		snoozedUntil: NOW + 5 * DAY,
	},
	{
		n: 8,
		account: 6,
		template: "payment_failed",
		kind: "risk",
		severity: "high",
		status: "done",
		title: "Payment failed",
		reason: "$1,800 unpaid for 3 days",
		evidence: EVIDENCE.payment,
		priority: 90,
		openedAgo: 5 * DAY,
		resolvedAgo: 2 * DAY,
		outcome: "fixed",
		note: "Card updated by their finance team",
	},
	{
		n: 9,
		account: 4,
		template: "inactive",
		kind: "risk",
		severity: "low",
		status: "auto_resolved",
		title: "Gone quiet",
		reason: "No activity for 8 days",
		evidence: EVIDENCE.inactive,
		priority: 30,
		openedAgo: 10 * DAY,
		resolvedAgo: 3 * DAY,
	},
]

const signalRow = (seed: SignalSeed) => ({
	id: signalId(seed.n),
	organizationId: orgId,
	accountId: accountId(seed.account),
	ruleId: ruleId(seed.n),
	template: seed.template,
	kind: seed.kind,
	severity: seed.severity,
	status: seed.status,
	title: seed.title,
	reason: seed.reason,
	evidence: seed.evidence,
	openingEvidence: seed.evidence,
	actionEvidence: null,
	priorityScore: seed.priority,
	firstDetectedAt: ago(seed.openedAgo),
	openedAt: ago(seed.openedAgo),
	lastEvaluatedAt: ago(HOUR),
	assigneeUserId: seed.assignee ?? null,
	snoozedUntil: seed.snoozedUntil === undefined ? null : at(seed.snoozedUntil),
	snoozedByUserId: seed.snoozedUntil === undefined ? null : graceUserId,
	snoozedAt: seed.snoozedUntil === undefined ? null : ago(DAY),
	snoozeNote: seed.snoozeNote ?? null,
	resolvedAt:
		seed.resolvedAgo === undefined || seed.status === "auto_resolved" ? null : ago(seed.resolvedAgo),
	resolvedByUserId: seed.status === "done" ? alanUserId : null,
	outcome: seed.outcome ?? null,
	resolutionNote: seed.note ?? null,
	dismissReason: null,
	reopenCount: 0,
	closedAt:
		seed.status === "auto_resolved" && seed.resolvedAgo !== undefined ? ago(seed.resolvedAgo) : null,
	createdAt: ago(seed.openedAgo),
	updatedAt: ago(HOUR),
})

const settingsRow = {
	id: "0000c004-0000-4000-8000-000000000001",
	organizationId: orgId,
	attention: { stages: ["trialing", "active", "past_due"], requiredSources: [] },
	reportingCurrency: "USD",
	addOnPlans: [],
	overageInMrr: false,
	businessHours: { timeZone: "Europe/London", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
	supportTriage: { enabled: true, about: "" },
	lastComputedAt: ago(20 * 60 * 1000),
	updatedBy: null,
	createdAt: "2025-03-14T10:00:00.000Z",
	updatedAt: ago(DAY),
}

export const seedAttention = (server: FixtureServer) => {
	server.write("customers", orgId, "customer_accounts", ACCOUNTS.map(accountRow))
	server.write("customers", orgId, "customer_signals", SIGNALS.map(signalRow))
	server.write("customers", orgId, "customer_settings", [settingsRow])
}

const contact = (
	n: number,
	name: string,
	email: string,
	title: string,
	role: string | null,
	seenAgo: number,
) => ({
	contact: {
		id: `0000c005-0000-4000-8000-${n.toString(16).padStart(12, "0")}`,
		accountId: accountId(2),
		email,
		name,
		avatarUrl: null,
		title,
		role,
		isBillingContact: role === "Billing",
		joinedAt: "2025-04-01T10:00:00.000Z",
		firstActiveAt: "2025-04-01T10:00:00.000Z",
		lastSeenAt: ago(seenAgo),
		lastSignInAt: ago(seenAgo),
		signInCount30d: 9,
		eventCount30d: 120,
		attributes: {},
		fieldSources: {},
		createdAt: "2025-04-01T10:00:00.000Z",
		updatedAt: ago(DAY),
		deletedAt: null,
	},
	status: seenAgo > 14 * DAY ? "dormant" : "active",
	activity: [],
	otherAccounts: [],
})

/** The preview's `customers.account.detail`, for whichever account is asked. */
const accountDetail = (payload: Record<string, unknown>) => {
	const seed = ACCOUNTS.find((account) => accountId(account.n) === payload.accountId) ?? ACCOUNTS[1]
	return {
		account: accountRow(seed as AccountSeed),
		refs: [],
		subscriptions: [],
		upcomingInvoice: null,
		openInvoices: [],
		activeUsersSeries: [],
		contactsToReach: [
			contact(1, "Maya Chen", "maya@kestrel.io", "Head of Data", "Admin", 2 * HOUR),
			contact(2, "Tom Alvarez", "tom@kestrel.io", "Finance lead", "Billing", 20 * DAY),
		],
		recentEvents: [
			{
				id: "0000c006-0000-4000-8000-000000000001",
				accountId: payload.accountId,
				contactId: null,
				provider: "stripe",
				type: "invoice.payment_failed",
				title: "Payment of $2,150.00 failed",
				data: {},
				occurredAt: ago(DAY),
				externalId: null,
				actorUserId: null,
				createdAt: ago(DAY),
			},
		],
	}
}

const fixture: PageFixture = {
	seed: seedAttention,
	rpcs: { "customers.account.detail": accountDetail },
}

export default fixture
