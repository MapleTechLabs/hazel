import {
	type Connection,
	DEFAULT_CONNECTION_CONFIG,
	EMPTY_SYNC_STATS,
	type SyncRun,
	type SyncRunStatus,
	type SyncTrigger,
} from "@hazel/domain/customers"
import { CustomerSyncRunId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"
import { msOf } from "../../customers/queries"
import type { Shared } from "../../page/contract"
import { labShared } from "../../page/customers/lab-shared"
import {
	CLERK_CONNECTION,
	MAPLE_CONNECTION,
	MAPLE_ERROR_AT,
	NOW,
	ORGANIZATION_ID,
	STRIPE_CONNECTION,
	SYNC_RUNS,
} from "./customers"

/**
 * Data sources fixtures beyond `customers.ts`: a week of sync runs for each connection (Clerk's
 * history, Maple's failures, Stripe's backfill), Maple's provider settings, and an admin `Shared`.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(NOW.getTime() - ms)

/** The lab's signed-in user as an admin (the default `labShared` has no membership). */
const MEMBER_ID = Schema.decodeSync(OrganizationMemberId)("00000025-0000-4000-8000-000000000001")
export const ADMIN_SHARED: Shared = { ...labShared, member: { id: MEMBER_ID, role: "admin" } }
/** A plain member: the read-only view. */
export const MEMBER_SHARED: Shared = { ...labShared, member: { id: MEMBER_ID, role: "member" } }

/** Maple with its settings filled in (Wonder `one`). */
export const MAPLE_SETTINGS_CONNECTION: Connection = {
	...MAPLE_CONNECTION,
	externalAccountName: "Northwind",
	config: {
		...DEFAULT_CONNECTION_CONFIG.maple,
		mapleOrgId: "org_mpl_8HqZZe",
		activityEvents: [
			"query_run",
			"dashboard_viewed",
			"trace_explored",
			"dashboard_created",
			"alert_rule_created",
			"api_key_created",
		],
		metricMappings: [
			{ event: "dashboard_created", metricKey: "dashboards_created" },
			{ event: "alert_rule_created", metricKey: "alert_rules_created" },
			{ event: "query_run", metricKey: "queries_run" },
		],
	},
}

export const SOURCE_CONNECTIONS: ReadonlyArray<Connection> = [
	CLERK_CONNECTION,
	STRIPE_CONNECTION,
	MAPLE_SETTINGS_CONNECTION,
]

const run = (
	n: number,
	connection: Connection,
	trigger: SyncTrigger,
	status: SyncRunStatus,
	startedAgoMs: number,
	durationMs: number,
	stats: Partial<SyncRun["stats"]>,
	error: SyncRun["error"] = null,
): SyncRun => ({
	id: Schema.decodeSync(CustomerSyncRunId)(`00000024-0000-4000-8000-${String(100 + n).padStart(12, "0")}`),
	organizationId: ORGANIZATION_ID,
	connectionId: connection.id,
	provider: connection.provider,
	trigger,
	status,
	startedAt: ago(startedAgoMs),
	finishedAt: ago(startedAgoMs - durationMs),
	progress: null,
	stats: { ...EMPTY_SYNC_STATS, ...stats },
	error,
	cursor: null,
})

/** Clerk's week (Wonder `loy`): hourly pulls, a manual run, one rate-limited failure. */
const CLERK_RUNS: ReadonlyArray<SyncRun> = [
	run(1, CLERK_CONNECTION, "schedule", "succeeded", 100 * MINUTE, 41_000, { accounts: 3, contacts: 15 }),
	run(2, CLERK_CONNECTION, "manual", "succeeded", 133 * MINUTE, 44_000, { contacts: 6 }),
	run(
		3,
		CLERK_CONNECTION,
		"schedule",
		"failed",
		160 * MINUTE,
		12_000,
		{},
		{
			code: "rate_limited",
			message: "429 Too Many Requests",
			httpStatus: 429,
		},
	),
	run(4, CLERK_CONNECTION, "schedule", "succeeded", 220 * MINUTE, 39_000, { accounts: 2, contacts: 11 }),
	run(5, CLERK_CONNECTION, "schedule", "succeeded", 1 * DAY, 37_000, { contacts: 4, activityDays: 212 }),
	run(6, CLERK_CONNECTION, "backfill", "succeeded", 6 * DAY, 372_000, { accounts: 214, contacts: 1_862 }),
]

/** Maple's failures since its key was revoked. */
const MAPLE_RUNS: ReadonlyArray<SyncRun> = [0, 1, 2].map((attempt) =>
	run(
		10 + attempt,
		MAPLE_CONNECTION,
		"schedule",
		"failed",
		NOW.getTime() - MAPLE_ERROR_AT.getTime() + attempt * HOUR,
		1_200,
		{},
		{
			code: "auth",
			message: "401 Unauthorized",
			httpStatus: 401,
		},
	),
)

export const SOURCE_SYNC_RUNS: ReadonlyArray<SyncRun> = [...SYNC_RUNS, ...CLERK_RUNS, ...MAPLE_RUNS].sort(
	(left, right) => msOf(right.startedAt) - msOf(left.startedAt),
)

/** `customers.unmatched.list`'s `openCount` (Wonder: 5 Stripe customers and 9 Maple groups). */
export const UNMATCHED_OPEN_COUNT = 14
