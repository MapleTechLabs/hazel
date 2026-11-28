import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, orgId } from "../snapshot"

/**
 * The Signals settings (`/hazel/customers/settings/signals`): five rules over Stripe alone, so the
 * billing and built-in rules read as live and the activity ones as waiting for a source.
 */

const NOW = Date.parse("2026-11-26T15:00:00Z")
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const at = (ms: number) => new Date(NOW - ms).toISOString()

export const signalRuleId = (index: number) =>
	`00000000-0000-4000-8000-0000000c${String(index).padStart(4, "0")}`

const rule = (
	index: number,
	fields: {
		readonly name: string
		readonly template: string
		readonly kind: "risk" | "opportunity"
		readonly severity: "low" | "medium" | "high"
		readonly config: object
		readonly scope?: object
		readonly enabled?: boolean
		readonly matchingCount?: number
		readonly lastTriggeredAgoMs?: number
	},
) => ({
	id: signalRuleId(index),
	organizationId: orgId,
	name: fields.name,
	template: fields.template,
	kind: fields.kind,
	severity: fields.severity,
	config: { _tag: fields.template, ...fields.config },
	scope: fields.scope ?? {},
	enabled: fields.enabled ?? true,
	createdBy: adaUserId,
	updatedBy: adaUserId,
	lastTriggeredAt: fields.lastTriggeredAgoMs === undefined ? null : at(fields.lastTriggeredAgoMs),
	matchingCount: fields.matchingCount ?? 0,
	createdAt: at(30 * DAY - index * HOUR),
	updatedAt: at(4 * DAY),
	deletedAt: null,
})

const rules = [
	rule(1, {
		name: "Stopped using the product",
		template: "inactive",
		kind: "risk",
		severity: "high",
		config: { inactiveDays: 14, priorWindowDays: 30, minPriorActiveUsers: 1 },
	}),
	rule(2, {
		name: "Payment failed",
		template: "payment_failed",
		kind: "risk",
		severity: "high",
		config: { overdueDays: 7 },
		scope: { payingOnly: true },
		matchingCount: 3,
		lastTriggeredAgoMs: 2 * HOUR,
	}),
	rule(3, {
		name: "Cancellation scheduled",
		template: "cancel_scheduled",
		kind: "risk",
		severity: "medium",
		config: { includeDowngrades: true, downgradeWindowDays: 30 },
		enabled: false,
	}),
	rule(4, {
		name: "Reply overdue",
		template: "response_overdue",
		kind: "risk",
		severity: "medium",
		config: { graceMinutes: 30 },
		scope: { lifecycleStages: ["active", "past_due"] },
	}),
	rule(5, {
		name: "Seats growing fast",
		template: "seat_growth",
		kind: "opportunity",
		severity: "low",
		config: { growthPct: 25, windowDays: 30, minActiveUsers: 5 },
	}),
]

const stripe = {
	id: "00000000-0000-4000-8000-0000000d0001",
	organizationId: orgId,
	provider: "stripe",
	status: "active",
	externalAccountId: "acct_hazel",
	externalAccountName: "Hazel Labs",
	config: { _tag: "stripe" },
	connectedBy: adaUserId,
	connectedAt: at(60 * DAY),
	hasWebhookSecret: true,
	lastSyncAt: at(HOUR),
	lastSuccessAt: at(HOUR),
	lastErrorAt: null,
	lastError: null,
	consecutiveFailures: 0,
	nextSyncAt: null,
	backfilledAt: at(59 * DAY),
	stats: {
		accounts: 0,
		contacts: 0,
		subscriptions: 0,
		invoices: 0,
		events: 0,
		activityDays: 0,
		metricDays: 0,
		unmatched: 0,
	},
	disconnectedAt: null,
	createdAt: at(60 * DAY),
	updatedAt: at(HOUR),
}

export const seedSignals = (server: FixtureServer) => {
	server.write("customers", orgId, "customer_signal_rules", rules)
	server.write("customers", orgId, "customer_connections", [stripe])
}

const fixture: PageFixture = { seed: seedSignals }

export default fixture
