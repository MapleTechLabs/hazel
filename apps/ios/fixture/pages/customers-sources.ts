import { EMPTY_SYNC_STATS } from "@hazel/domain/customers"
import { adaUserId, orgId } from "../snapshot"
import type { PageFixture } from "../page-fixture"

/**
 * Data sources: Clerk connected, Stripe backfilling (a running run), Maple failing on a revoked
 * key, Autumn not connected; three unmatched records for the coverage card.
 */

/** Each provider's default config, as stored (`@hazel/customer-integrations` `DEFAULT_CONNECTION_CONFIG`). */
const CONFIG = {
	clerk: { _tag: "clerk", createAccounts: true },
	stripe: { _tag: "stripe", clerkOrgMetadataKey: "clerk_org_id", matchByDomain: true, accountId: "" },
	maple: { _tag: "maple", region: "us", activityEvents: [], metricMappings: [], lookbackDays: 90 },
} as const

const NOW = Date.parse("2026-11-26T15:00:00Z")
const MINUTE = 60_000
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString()
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`

const connection = (
	n: number,
	provider: "clerk" | "stripe" | "maple",
	fields: Readonly<Record<string, unknown>>,
) => ({
	id: id("0000000c", n),
	organizationId: orgId,
	provider,
	status: "active",
	externalAccountId: null,
	externalAccountName: null,
	config: CONFIG[provider],
	connectedBy: adaUserId,
	connectedAt: at(-30 * 24 * 60 * MINUTE),
	hasWebhookSecret: true,
	lastSyncAt: at(-12 * MINUTE),
	lastSuccessAt: at(-12 * MINUTE),
	lastErrorAt: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAt: at(48 * MINUTE),
	backfilledAt: at(-29 * 24 * 60 * MINUTE),
	stats: EMPTY_SYNC_STATS,
	disconnectedAt: null,
	createdAt: at(-30 * 24 * 60 * MINUTE),
	updatedAt: at(-12 * MINUTE),
	...fields,
})

const connections = [
	connection(1, "clerk", { stats: { ...EMPTY_SYNC_STATS, accounts: 214, contacts: 1862 } }),
	connection(2, "stripe", {
		hasWebhookSecret: false,
		lastSyncAt: null,
		lastSuccessAt: null,
		nextSyncAt: null,
		backfilledAt: null,
		connectedAt: at(-5 * MINUTE),
	}),
	connection(3, "maple", {
		status: "error",
		lastErrorAt: at(-20 * MINUTE),
		lastError: { code: "auth", message: "revoked", httpStatus: 401 },
		consecutiveFailures: 3,
		lastSuccessAt: at(-3 * 24 * 60 * MINUTE),
		stats: { ...EMPTY_SYNC_STATS, activityDays: 90, metricDays: 30 },
	}),
]

const runs = [
	{
		id: id("0000000d", 1),
		organizationId: orgId,
		connectionId: connections[1]?.id,
		provider: "stripe",
		trigger: "backfill",
		status: "running",
		startedAt: at(-4 * MINUTE),
		finishedAt: null,
		progress: { step: "invoices", done: 1240, total: 4800 },
		stats: EMPTY_SYNC_STATS,
		error: null,
		cursor: null,
	},
]

const fixture: PageFixture = {
	seed: (server) => {
		server.write("customers", orgId, "customer_connections", connections)
		server.write("customers", orgId, "customer_sync_runs", runs)
	},
	rpcs: {
		"customers.unmatched.list": () => ({ items: [], nextCursor: null, openCount: 3 }),
	},
}

export default fixture
