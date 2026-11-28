/**
 * Rows for the Customers settings parity pages (SLA, Plans, Feature flags): the org's customers
 * source, written before the app starts (`server.write("customers", orgId, ...)`).
 */
import * as Customers from "@hazel/domain/customers"
import type { FixtureServer } from "./fixture-socket"
import { adaUserId, orgId } from "./snapshot"

const AT = "2026-11-01T10:00:00.000Z"
const id = (group: number, n: number) =>
	`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`

/** The plans the org's subscriptions name (`customers.plans.list`). */
export const PLANS = ["Enterprise", "Pro", "Seats add-on", "Starter"]

export const settingsRow = (addOnPlans: ReadonlyArray<string>) => ({
	id: id(0xc5, 1),
	organizationId: orgId,
	attention: { stages: ["trialing", "active", "past_due"], requiredSources: [] },
	reportingCurrency: "usd",
	addOnPlans,
	overageInMrr: false,
	businessHours: { timeZone: "Europe/Berlin", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
	supportTriage: {
		enabled: true,
		about: "Hazel is a team chat app. Support covers the apps, billing and workspace access.",
	},
	lastComputedAt: null,
	updatedBy: null,
	createdAt: AT,
	updatedAt: AT,
})

export const accountRow = (
	n: number,
	name: string,
	domain: string | null,
	planName: string | null,
	featureFlags: Readonly<Record<string, boolean>>,
) => ({
	id: id(0xc1, n),
	organizationId: orgId,
	name,
	domains: domain === null ? [] : [domain],
	logoUrl: null,
	ownerUserId: null,
	lifecycleStage: "active",
	lifecycleStageOverride: null,
	planName,
	mrrMinor: 0,
	currency: "usd",
	trialListMrrMinor: null,
	trialEndsAt: null,
	seatsUsed: null,
	seatsLimit: null,
	contactCount: 0,
	activeUsers30d: 0,
	activeUsersTrendPct: null,
	openRiskHigh: 0,
	openRiskMedium: 0,
	openRiskLow: 0,
	openOpportunities: 0,
	championContactId: null,
	championInactiveSince: null,
	lastActiveContactId: null,
	firstSeenAt: AT,
	lastActiveAt: null,
	customerSince: null,
	churnedAt: null,
	tags: [],
	attributes: {},
	featureFlags,
	attentionMutedAt: null,
	attentionMutedUntil: null,
	attentionMutedByUserId: null,
	fieldSources: {},
	primaryAccountId: null,
	environment: null,
	companyProfile: null,
	companyCheckedAt: null,
	createdAt: AT,
	updatedAt: AT,
	deletedAt: null,
})

export const ACCOUNTS = [
	accountRow(1, "Acme", "acme.com", "Enterprise", { beta_inbox: true, sso: true }),
	accountRow(2, "Globex", "globex.com", "Pro", { beta_inbox: true, legacy_billing: false }),
	accountRow(3, "Initech", "initech.com", "Starter", {}),
	accountRow(4, "Umbrella", null, "Pro", { sso: true }),
]

const policyRow = (
	n: number,
	name: string,
	options: Readonly<{
		enabled?: boolean
		hours: Customers.SlaHours
		appliesTo?: Partial<Customers.SlaAppliesTo>
		medium: readonly [number, number]
	}>,
) => ({
	id: id(0xc2, n),
	organizationId: orgId,
	name,
	position: n - 1,
	enabled: options.enabled ?? true,
	appliesTo: { accountIds: [], planNames: [], tagsAny: [], ...options.appliesTo },
	targets: {
		...Customers.DEFAULT_SLA_POLICY.targets,
		medium: { firstResponseMinutes: options.medium[0], resolutionMinutes: options.medium[1] },
	},
	hours: options.hours,
	warnBeforePct: 25,
	createdBy: adaUserId,
	updatedBy: null,
	createdAt: AT,
	updatedAt: AT,
	deletedAt: null,
})

export const POLICIES = [
	policyRow(1, "Enterprise", {
		hours: "always",
		appliesTo: { planNames: ["Enterprise"] },
		medium: [60, 480],
	}),
	policyRow(2, "Acme escalation", {
		hours: "business",
		enabled: false,
		appliesTo: { accountIds: [id(0xc1, 1)], tagsAny: ["vip"] },
		medium: [30, 240],
	}),
	policyRow(3, "Standard", { hours: "business", medium: [240, 1440] }),
]

export const FEATURE_FLAGS = [
	{ id: id(0xc3, 1), organizationId: orgId, key: "new_onboarding", createdBy: adaUserId, createdAt: AT },
]

/** Writes `tables` to the org's customers source. */
export const seedCustomers = (
	server: FixtureServer,
	tables: Readonly<Record<string, ReadonlyArray<unknown>>>,
) => {
	for (const [table, rows] of Object.entries(tables)) server.write("customers", orgId, table, rows)
}
