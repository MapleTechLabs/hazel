import {
	type Connection,
	EMPTY_SYNC_STATS,
	type SyncRun,
	type SyncRunStatus,
	type SyncTrigger,
} from "@hazel/domain/customers"
import {
	CustomerImpersonationId,
	CustomerImpersonatorId,
	CustomerSyncRunId,
	OrganizationMemberId,
} from "@hazel/schema"
import { Schema } from "effect"
import { type ImpersonatorRow, msOf } from "../../customers/queries"
import type { Shared } from "../../page/contract"
import { labShared } from "../../page/customers/lab-shared"
import type { ImpersonationRow } from "../../page/customers/settings/sources/queries"
import {
	DIRECTORY_CONNECTION,
	JONAS,
	ACTIVITY_CONNECTION,
	MAYA,
	ACTIVITY_ERROR_AT,
	NOW,
	ORGANIZATION_ID,
	INVOICES_CONNECTION,
	SYNC_RUNS,
} from "./customers"
import { ACTIVITY } from "./customers-demo-sources"

/**
 * Data sources fixtures beyond `customers.ts`: a week of sync runs for each connection (the
 * directory's history, the activity source's failures, the invoice source's backfill), the activity
 * source's provider settings, and an admin `Shared`.
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

/** The activity source with its settings filled in (Wonder `one`). */
export const ACTIVITY_SETTINGS_CONNECTION: Connection = {
	...ACTIVITY_CONNECTION,
	externalAccountName: "Northwind",
	config: ACTIVITY.demo.sampleConfig,
}

export const SOURCE_CONNECTIONS: ReadonlyArray<Connection> = [
	DIRECTORY_CONNECTION,
	INVOICES_CONNECTION,
	ACTIVITY_SETTINGS_CONNECTION,
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

/** The directory's week (Wonder `loy`): hourly pulls, a manual run, one rate-limited failure. */
const DIRECTORY_RUNS: ReadonlyArray<SyncRun> = [
	run(1, DIRECTORY_CONNECTION, "schedule", "succeeded", 100 * MINUTE, 41_000, {
		accounts: 3,
		contacts: 15,
	}),
	run(2, DIRECTORY_CONNECTION, "manual", "succeeded", 133 * MINUTE, 44_000, { contacts: 6 }),
	run(
		3,
		DIRECTORY_CONNECTION,
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
	run(4, DIRECTORY_CONNECTION, "schedule", "succeeded", 220 * MINUTE, 39_000, {
		accounts: 2,
		contacts: 11,
	}),
	run(5, DIRECTORY_CONNECTION, "schedule", "succeeded", 1 * DAY, 37_000, {
		contacts: 4,
		activityDays: 212,
	}),
	run(6, DIRECTORY_CONNECTION, "backfill", "succeeded", 6 * DAY, 372_000, {
		accounts: 214,
		contacts: 1_862,
	}),
]

/** The activity source's failures since its key was revoked. */
const ACTIVITY_RUNS: ReadonlyArray<SyncRun> = [0, 1, 2].map((attempt) =>
	run(
		10 + attempt,
		ACTIVITY_CONNECTION,
		"schedule",
		"failed",
		NOW.getTime() - ACTIVITY_ERROR_AT.getTime() + attempt * HOUR,
		1_200,
		{},
		{
			code: "auth",
			message: "401 Unauthorized",
			httpStatus: 401,
		},
	),
)

export const SOURCE_SYNC_RUNS: ReadonlyArray<SyncRun> = [
	...SYNC_RUNS,
	...DIRECTORY_RUNS,
	...ACTIVITY_RUNS,
].sort((left, right) => msOf(right.startedAt) - msOf(left.startedAt))

/** `customers.unmatched.list`'s `openCount` (Wonder: 5 billing customers and 9 activity groups). */
export const UNMATCHED_OPEN_COUNT = 14

/** Jonas may impersonate (Maya granted it) and signed in as one of Acme's users. */
export const IMPERSONATORS: ReadonlyArray<ImpersonatorRow> = [
	{
		id: Schema.decodeSync(CustomerImpersonatorId)("00000026-0000-4000-8000-000000000001"),
		userId: JONAS.id,
		grantedBy: MAYA.id,
		grantedAtMs: ago(3 * DAY).getTime(),
	},
]
export const IMPERSONATIONS: ReadonlyArray<ImpersonationRow> = [
	{
		id: Schema.decodeSync(CustomerImpersonationId)("00000027-0000-4000-8000-000000000001"),
		userId: JONAS.id,
		contactLabel: "Priya Shah",
		accountName: "Acme Robotics",
		createdAtMs: ago(2 * HOUR).getTime(),
	},
]
