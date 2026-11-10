import {
	type Account,
	DEFAULT_HEALTH_SETTINGS,
	type HealthBreakdown,
	type HealthComponentKey,
	type HealthDistributionRow,
	type HealthDryRunResult,
	type HealthSettings,
	HealthStatus,
} from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { ACCOUNTS, ACCOUNTS_BY_KEY } from "./customers"

/** The health settings page's fixtures: drafts, a dry run of them, and saved breakdowns. */

/** Wonder `mao`: usage up, engagement down, still 100%. */
export const HEALTH_DRAFT: HealthSettings = {
	...DEFAULT_HEALTH_SETTINGS,
	weights: { usage: 40, engagement: 20, billing: 25, signals: 15 },
}

/** Wonder `aal`: usage pushed to 45%, the weights add up to 110%. */
export const HEALTH_INVALID_DRAFT: HealthSettings = {
	...DEFAULT_HEALTH_SETTINGS,
	weights: { usage: 45, engagement: 25, billing: 25, signals: 15 },
}

type Part = readonly [key: HealthComponentKey, score: number | null, why: string]

/** A breakdown as the backend builds it: excluded parts share their weight, the score is banded. */
export const breakdownOf = (settings: HealthSettings, parts: ReadonlyArray<Part>): HealthBreakdown => {
	const available = parts.reduce(
		(sum, [key, score]) => sum + (score === null ? 0 : settings.weights[key]),
		0,
	)
	const components = parts.map(([key, score, why]) => ({
		key,
		score,
		weight: settings.weights[key],
		effectiveWeight: score === null ? 0 : (settings.weights[key] / available) * 100,
		excluded: score === null,
		why,
	}))
	const score = Math.round(
		components.reduce((sum, part) => sum + (part.effectiveWeight / 100) * (part.score ?? 0), 0),
	)
	const { healthyMin, atRiskMin } = settings.bands
	return {
		score,
		status: score >= healthyMin ? "healthy" : score >= atRiskMin ? "at_risk" : "critical",
		components,
	}
}

const NORTHWIND: ReadonlyArray<Part> = [
	["usage", 20, "9 of 51 contacts active in 30 days; trend −41%"],
	["engagement", 100, "Active today"],
	["billing", 100, "Paid up"],
	["signals", 100, "No open risk signals"],
]
const SABLE: ReadonlyArray<Part> = [
	["usage", 85, "7 of 9 contacts active in 30 days; trend +6%"],
	["engagement", 100, "Active today"],
	["billing", 40, "Cancellation scheduled"],
	["signals", 85, "1 open risk signal (1 medium)"],
]
const ACME: ReadonlyArray<Part> = [
	["usage", 10, "4 of 24 contacts active in 30 days; trend −48%"],
	["engagement", 90, "Last active 3 days ago"],
	["billing", 20, "Payment past due"],
	["signals", 70, "1 open risk signal (1 high)"],
]
const KESTREL: ReadonlyArray<Part> = [
	["usage", 31, "9 of 14 contacts active in 30 days; trend −64%"],
	["engagement", 25, "Last active 18 days ago"],
	["billing", 30, "Invoice overdue for over a week"],
	["signals", 55, "2 open risk signals (1 high, 1 medium)"],
]

const PARTS_BY_ACCOUNT = new Map<CustomerAccountId, ReadonlyArray<Part>>([
	[ACCOUNTS_BY_KEY.northwind.id, NORTHWIND],
	[ACCOUNTS_BY_KEY.sable.id, SABLE],
	[ACCOUNTS_BY_KEY.acme.id, ACME],
	[ACCOUNTS_BY_KEY.kestrel.id, KESTREL],
])

/** `customers.account.detail`'s `health` for any account: the named ones by hand, the rest generic. */
export const savedBreakdownOf = (accountId: CustomerAccountId): HealthBreakdown | null => {
	const account = ACCOUNTS.find((candidate) => candidate.id === accountId)
	if (account === undefined || account.healthStatus === "unknown") return null
	return breakdownOf(
		DEFAULT_HEALTH_SETTINGS,
		PARTS_BY_ACCOUNT.get(accountId) ?? [
			[
				"usage",
				account.healthScore,
				`${account.activeUsers30d} of ${account.contactCount} contacts active in 30 days`,
			],
			["engagement", account.healthScore, "Lab fixture: matches its synced score"],
			["billing", null, "No subscription"],
			["signals", account.healthScore, "Lab fixture: matches its synced score"],
		],
	)
}

const distribution = (accounts: ReadonlyArray<Account>): ReadonlyArray<HealthDistributionRow> =>
	HealthStatus.literals.map((status) => {
		const rows = accounts.filter((account) => account.healthStatus === status)
		return { status, count: rows.length, mrrMinor: rows.reduce((sum, row) => sum + row.mrrMinor, 0) }
	})

/** The book as saved, and after `HEALTH_DRAFT`: 6 healthy slip to at risk, 2 at risk to critical. */
const moved = (rows: ReadonlyArray<HealthDistributionRow>): ReadonlyArray<HealthDistributionRow> => {
	const shift = (status: HealthStatus, count: number, mrrMinor: number) => {
		const row = rows.find((candidate) => candidate.status === status)
		return { status, count: (row?.count ?? 0) + count, mrrMinor: (row?.mrrMinor ?? 0) + mrrMinor }
	}
	return [
		shift("healthy", -6, -1_186_000),
		shift("at_risk", 4, 1_186_000 - 345_000),
		shift("critical", 2, 345_000),
		shift("unknown", 0, 0),
	]
}

const CURRENT = distribution(ACCOUNTS)

export const HEALTH_DRY_RUN: HealthDryRunResult = {
	current: CURRENT,
	proposed: moved(CURRENT),
	transitions: [
		{ from: "healthy", to: "at_risk", count: 6 },
		{ from: "at_risk", to: "critical", count: 2 },
	],
	samples: [
		{
			accountId: ACCOUNTS_BY_KEY.northwind.id,
			name: ACCOUNTS_BY_KEY.northwind.name,
			current: breakdownOf(DEFAULT_HEALTH_SETTINGS, NORTHWIND),
			proposed: breakdownOf(HEALTH_DRAFT, NORTHWIND),
		},
		{
			accountId: ACCOUNTS_BY_KEY.acme.id,
			name: ACCOUNTS_BY_KEY.acme.name,
			current: breakdownOf(DEFAULT_HEALTH_SETTINGS, ACME),
			proposed: breakdownOf(HEALTH_DRAFT, ACME),
		},
	],
	evaluatedAccounts: ACCOUNTS.length,
	totalAccounts: ACCOUNTS.length,
}
