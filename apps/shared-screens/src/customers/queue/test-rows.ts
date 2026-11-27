/** Rows the queue's tests share: accounts, signals and members around a pinned clock. */
import { CustomerAccountId, CustomerSignalId, CustomerSignalRuleId, UserId } from "@hazel/schema"
import type { AccountRow, MemberRow, SignalRow } from "../data/queries"

export const NOW = Date.parse("2026-11-26T15:00:00Z")
export const HOUR = 3_600_000
export const DAY = 24 * HOUR

export const ada = UserId.make("00000001-0000-4000-8000-000000000001")
export const grace = UserId.make("00000001-0000-4000-8000-000000000002")

export const accountId = (n: number) => CustomerAccountId.make(`0000c001-0000-4000-8000-00000000000${n}`)
export const signalId = (n: number) => CustomerSignalId.make(`0000c002-0000-4000-8000-00000000000${n}`)

export const account = (n: number, overrides: Partial<AccountRow> = {}): AccountRow => ({
	id: accountId(n),
	name: `Account ${n}`,
	domain: `account${n}.test`,
	logoUrl: null,
	company: null,
	companyCheckedAtMs: null,
	ownerUserId: null,
	lifecycleStage: "active",
	planName: "Growth",
	mrrMinor: 100_000 * n,
	currency: "USD",
	trialListMrrMinor: null,
	trialEndsAtMs: null,
	seatsUsed: 10,
	seatsLimit: 20,
	contactCount: 12,
	activeUsers30d: 8,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	firstSeenAtMs: NOW - 400 * DAY,
	lastActiveAtMs: NOW - DAY,
	customerSinceMs: NOW - 300 * DAY,
	churnedAtMs: null,
	tags: [],
	featureFlags: {},
	primaryAccountId: null,
	environment: null,
	attentionMutedAtMs: null,
	attentionMutedUntilMs: null,
	attentionMutedByUserId: null,
	...overrides,
})

const evidence = {
	_tag: "last_active",
	step: 1,
	lastActiveAt: null,
	daysInactive: 16,
	priorActiveUsers: 7,
	contactId: null,
	contactName: null,
	contactEmail: null,
} as const

export const signal = (n: number, account: number, overrides: Partial<SignalRow> = {}): SignalRow => ({
	id: signalId(n),
	accountId: accountId(account),
	ruleId: CustomerSignalRuleId.make(`0000c003-0000-4000-8000-00000000000${n}`),
	template: "inactive",
	kind: "risk",
	severity: "medium",
	status: "open",
	title: `Signal ${n}`,
	reason: `Reason ${n}`,
	evidence,
	priorityScore: 100 - n,
	openedAtMs: NOW - n * DAY,
	assigneeUserId: null,
	snoozedUntilMs: null,
	snoozedByUserId: null,
	snoozedAtMs: null,
	snoozeNote: null,
	resolvedAtMs: null,
	resolvedByUserId: null,
	outcome: null,
	resolutionNote: null,
	dismissReason: null,
	closedAtMs: null,
	...overrides,
})

export const members: ReadonlyArray<MemberRow> = [
	{ id: ada, name: "Ada Lovelace", email: "ada@hazel.test", avatarUrl: null },
	{ id: grace, name: "Grace Hopper", email: "grace@hazel.test", avatarUrl: null },
]
