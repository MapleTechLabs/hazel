/**
 * The `customers` store: one `CustomersObject` per organization (`docs/customers/tech-design.md`).
 *
 * Synced to the org's members (`customers-source.ts`): accounts, signals, signal rules, notes,
 * saved views, settings, metric definitions, connections and sync runs. The rest is read through
 * RPCs (contacts, refs, billing, daily series, events, unmatched records) or internal
 * (`customer_members`, `customer_connection_secrets`).
 *
 * Conventions: money is integer minor units plus an ISO currency code; a `day` is `YYYY-MM-DD`
 * (UTC); JSON documents hold ISO timestamps. Synced tables carry `organizationId`, which the
 * client filters by; internal ones do not (the store is the org).
 */
import type {
	ConnectionConfig,
	HealthBreakdown,
	HealthSettings,
	RuleConfig,
	RuleScope,
	SignalEvidence,
	SyncError,
	SyncProgress,
	SyncStats,
	ViewFilters,
	ViewSort,
	ListColumn,
	CustomerSource,
} from "@hazel/domain/customers"
import {
	EMPTY_SYNC_STATS,
	BillingInterval,
	BuiltInViewKey,
	ConnectionStatus,
	CustomerProvider,
	CustomerSource as CustomerSourceSchema,
	HealthStatus,
	IgnoreRuleField,
	InvoiceStatus,
	LifecycleStage,
	MatchMethod,
	MetricAggregation,
	MrrMovementType,
	RefEntityType,
	SignalKind,
	SignalOutcome,
	SignalSeverity,
	SignalStatus,
	SignalTemplate,
	SubscriptionStatus,
	SyncRunStatus,
	SyncTrigger,
	UnmatchedEntityType,
	UnmatchedStatus,
} from "@hazel/domain/customers"
import {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerContactId,
	CustomerEventId,
	CustomerExternalRefId,
	CustomerIgnoreRuleId,
	CustomerInvoiceId,
	CustomerMetricDefinitionId,
	CustomerMrrMovementId,
	CustomerNoteId,
	CustomerSavedViewId,
	CustomerSettingsId,
	CustomerSignalId,
	CustomerSignalRuleId,
	CustomerSubscriptionId,
	CustomerSyncRunId,
	CustomerUnmatchedRecordId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { jsonb, randomUuid, textEnum, timestamptz, uuid } from "./columns"

const id = <S extends Parameters<typeof uuid>[0]>(brand: S) =>
	SQLite.column(uuid(brand), { defaultExpr: randomUuid })
const createdAt = () => SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow })
const updatedAt = () => SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow })
/** A `YYYY-MM-DD` UTC day. */
const day = SQLite.text
const money = () => SQLite.column(SQLite.integer, { default: 0 })
const count = () => SQLite.column(SQLite.integer, { default: 0 })

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** A B2B customer (a Clerk organization). Billing, usage and health fields are denormalized by compute. */
export const customerAccountsTable = SQLite.table("customer_accounts", {
	columns: {
		id: id(CustomerAccountId),
		organizationId: uuid(OrganizationId),
		name: SQLite.text,
		domains: SQLite.column(jsonb<ReadonlyArray<string>>(), { default: [] }),
		logoUrl: SQLite.nullable(SQLite.text),
		/** The CSM. */
		ownerUserId: SQLite.nullable(uuid(UserId)),
		/** Effective stage: the override when set, else derived from subscriptions. */
		lifecycleStage: SQLite.column(textEnum(LifecycleStage.literals), { default: "lead" }),
		lifecycleStageOverride: SQLite.nullable(textEnum(LifecycleStage.literals)),
		planName: SQLite.nullable(SQLite.text),
		mrrMinor: money(),
		currency: SQLite.column(SQLite.text, { default: "usd" }),
		/** List price of the trial's plan per month: ranks trials in the queue (they have no MRR yet). */
		trialListMrrMinor: SQLite.nullable(SQLite.integer),
		trialEndsAt: SQLite.nullable(timestamptz),
		healthScore: SQLite.nullable(SQLite.integer),
		healthStatus: SQLite.column(textEnum(HealthStatus.literals), { default: "unknown" }),
		healthUpdatedAt: SQLite.nullable(timestamptz),
		seatsUsed: SQLite.nullable(SQLite.integer),
		seatsLimit: SQLite.nullable(SQLite.integer),
		contactCount: count(),
		activeUsers30d: count(),
		/** 7-day average of daily active users vs the 28 days before, percent; null without a baseline. */
		activeUsersTrendPct: SQLite.nullable(SQLite.real),
		openRiskHigh: count(),
		openRiskMedium: count(),
		openRiskLow: count(),
		openOpportunities: count(),
		championContactId: SQLite.nullable(uuid(CustomerContactId)),
		championInactiveSince: SQLite.nullable(timestamptz),
		lastActiveContactId: SQLite.nullable(uuid(CustomerContactId)),
		firstSeenAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastActiveAt: SQLite.nullable(timestamptz),
		/** First paid. */
		customerSince: SQLite.nullable(timestamptz),
		churnedAt: SQLite.nullable(timestamptz),
		tags: SQLite.column(jsonb<ReadonlyArray<string>>(), { default: [] }),
		attributes: SQLite.column(jsonb<Record<string, unknown>>(), { default: {} }),
		/** Field → the source that last set it (per-field precedence, `CustomerIngest`). */
		fieldSources: SQLite.column(jsonb<Readonly<Record<string, CustomerSource>>>(), { default: {} }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("customer_accounts_owner_idx", ["ownerUserId"]),
		SQLite.index("customer_accounts_stage_idx", ["lifecycleStage"]),
		SQLite.index("customer_accounts_health_idx", ["healthStatus"]),
		SQLite.index("customer_accounts_deleted_at_idx", ["deletedAt"]),
	],
})
export type CustomerAccount = SQLite.SelectRowOf<typeof customerAccountsTable>
export type NewCustomerAccount = SQLite.InsertRowOf<typeof customerAccountsTable>

/** An end user of an account (a Clerk user in that organization). RPC-only (per account, paged). */
export const customerContactsTable = SQLite.table("customer_contacts", {
	columns: {
		id: id(CustomerContactId),
		accountId: uuid(CustomerAccountId),
		email: SQLite.nullable(SQLite.text),
		name: SQLite.nullable(SQLite.text),
		avatarUrl: SQLite.nullable(SQLite.text),
		title: SQLite.nullable(SQLite.text),
		/** The provider's role, e.g. Clerk's `org:admin`. */
		role: SQLite.nullable(SQLite.text),
		isBillingContact: SQLite.column(SQLite.boolean, { default: false }),
		joinedAt: SQLite.nullable(timestamptz),
		firstActiveAt: SQLite.nullable(timestamptz),
		lastSeenAt: SQLite.nullable(timestamptz),
		lastSignInAt: SQLite.nullable(timestamptz),
		signInCount30d: count(),
		eventCount30d: count(),
		attributes: SQLite.column(jsonb<Record<string, unknown>>(), { default: {} }),
		fieldSources: SQLite.column(jsonb<Readonly<Record<string, CustomerSource>>>(), { default: {} }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("customer_contacts_account_idx", ["accountId"]),
		SQLite.index("customer_contacts_email_idx", ["email"]),
	],
})
export type CustomerContact = SQLite.SelectRowOf<typeof customerContactsTable>
export type NewCustomerContact = SQLite.InsertRowOf<typeof customerContactsTable>

/**
 * A provider record linked to an account or contact: how four sources merge into one customer.
 * An account may hold several refs of one provider (two Stripe customers). Unique per
 * `(provider, externalId)` for accounts, and per `(provider, externalId, accountId)` for contacts
 * (one Clerk user is a contact of each org it belongs to): partial indexes, `extra-indexes.ts`.
 */
export const customerExternalRefsTable = SQLite.table("customer_external_refs", {
	columns: {
		id: id(CustomerExternalRefId),
		connectionId: uuid(CustomerConnectionId),
		provider: textEnum(CustomerProvider.literals),
		entityType: textEnum(RefEntityType.literals),
		/** The account or contact id. */
		entityId: SQLite.text,
		/** The account itself, or the contact's account. */
		accountId: uuid(CustomerAccountId),
		externalId: SQLite.text,
		/** Deep link to the provider's dashboard. */
		externalUrl: SQLite.nullable(SQLite.text),
		matchMethod: textEnum(MatchMethod.literals),
		matchedByUserId: SQLite.nullable(uuid(UserId)),
		matchedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastSyncedAt: SQLite.nullable(timestamptz),
		/** Set when its connection was disconnected: the data it brought is kept, marked stale. */
		staleAt: SQLite.nullable(timestamptz),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("customer_refs_entity_idx", ["entityType", "entityId"]),
		SQLite.index("customer_refs_account_idx", ["accountId"]),
		SQLite.index("customer_refs_connection_idx", ["connectionId"]),
	],
})
export type CustomerExternalRef = SQLite.SelectRowOf<typeof customerExternalRefsTable>
export type NewCustomerExternalRef = SQLite.InsertRowOf<typeof customerExternalRefsTable>

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export interface PaymentMethodDoc {
	readonly brand: string | null
	readonly last4: string | null
	readonly expMonth: number | null
	readonly expYear: number | null
}

export const customerSubscriptionsTable = SQLite.table("customer_subscriptions", {
	columns: {
		id: id(CustomerSubscriptionId),
		accountId: uuid(CustomerAccountId),
		provider: textEnum(CustomerProvider.literals),
		externalId: SQLite.text,
		planName: SQLite.nullable(SQLite.text),
		status: textEnum(SubscriptionStatus.literals),
		mrrMinor: money(),
		/** What the plan costs per month at list price (trials, discounts). */
		listMrrMinor: SQLite.nullable(SQLite.integer),
		currency: SQLite.text,
		interval: textEnum(BillingInterval.literals),
		quantity: SQLite.column(SQLite.integer, { default: 1 }),
		startedAt: SQLite.nullable(timestamptz),
		trialEndsAt: SQLite.nullable(timestamptz),
		currentPeriodEnd: SQLite.nullable(timestamptz),
		cancelAtPeriodEnd: SQLite.column(SQLite.boolean, { default: false }),
		canceledAt: SQLite.nullable(timestamptz),
		cancellationReason: SQLite.nullable(SQLite.text),
		paymentMethod: SQLite.nullable(jsonb<PaymentMethodDoc>()),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("customer_subscriptions_external_unique", ["provider", "externalId"]),
		SQLite.index("customer_subscriptions_account_idx", ["accountId"]),
		SQLite.index("customer_subscriptions_status_idx", ["status"]),
	],
})
export type CustomerSubscription = SQLite.SelectRowOf<typeof customerSubscriptionsTable>
export type NewCustomerSubscription = SQLite.InsertRowOf<typeof customerSubscriptionsTable>

export const customerInvoicesTable = SQLite.table("customer_invoices", {
	columns: {
		id: id(CustomerInvoiceId),
		accountId: uuid(CustomerAccountId),
		subscriptionId: SQLite.nullable(uuid(CustomerSubscriptionId)),
		provider: textEnum(CustomerProvider.literals),
		/** The upcoming invoice's is `upcoming:<subscription external id>`. */
		externalId: SQLite.text,
		number: SQLite.nullable(SQLite.text),
		status: textEnum(InvoiceStatus.literals),
		amountDueMinor: money(),
		amountPaidMinor: money(),
		currency: SQLite.text,
		issuedAt: SQLite.nullable(timestamptz),
		dueAt: SQLite.nullable(timestamptz),
		paidAt: SQLite.nullable(timestamptz),
		attemptCount: count(),
		nextRetryAt: SQLite.nullable(timestamptz),
		declineReason: SQLite.nullable(SQLite.text),
		hostedUrl: SQLite.nullable(SQLite.text),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("customer_invoices_external_unique", ["provider", "externalId"]),
		SQLite.index("customer_invoices_account_issued_idx", ["accountId", "issuedAt"]),
		SQLite.index("customer_invoices_status_idx", ["status"]),
	],
})
export type CustomerInvoice = SQLite.SelectRowOf<typeof customerInvoicesTable>
export type NewCustomerInvoice = SQLite.InsertRowOf<typeof customerInvoicesTable>

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/**
 * One row per contact per active day: DAU/WAU/MAU need distinct users across days. Each provider
 * writes only its own fields (Clerk `signedIn`/`sessionCount`, Maple `eventCount`).
 */
export const customerActivityDailyTable = SQLite.table("customer_activity_daily", {
	columns: {
		contactId: uuid(CustomerContactId),
		day,
		accountId: uuid(CustomerAccountId),
		eventCount: count(),
		sessionCount: count(),
		signedIn: SQLite.column(SQLite.boolean, { default: false }),
	},
	primaryKey: ["contactId", "day"],
	indexes: [
		SQLite.index("customer_activity_account_day_idx", ["accountId", "day"]),
		SQLite.index("customer_activity_day_idx", ["day"]),
	],
})
export type CustomerActivityDay = SQLite.SelectRowOf<typeof customerActivityDailyTable>

/** Metric keys: sources' own (`api_requests`) and Hazel's built-ins (`active_users`, `mrr`, …). */
export const customerMetricDefinitionsTable = SQLite.table("customer_metric_definitions", {
	columns: {
		id: id(CustomerMetricDefinitionId),
		organizationId: uuid(OrganizationId),
		key: SQLite.text,
		name: SQLite.text,
		/** E.g. "users", "requests", "minor" (money). */
		unit: SQLite.nullable(SQLite.text),
		aggregation: textEnum(MetricAggregation.literals),
		/** Null for a built-in. */
		provider: SQLite.nullable(textEnum(CustomerProvider.literals)),
		description: SQLite.nullable(SQLite.text),
		builtIn: SQLite.column(SQLite.boolean, { default: false }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [SQLite.uniqueIndex("customer_metric_definitions_key_unique", ["key"])],
})
export type CustomerMetricDefinition = SQLite.SelectRowOf<typeof customerMetricDefinitionsTable>

/** Per-account daily series of any metric; `limitValue` is the plan limit of a metered one (Autumn). */
export const customerMetricDailyTable = SQLite.table("customer_metric_daily", {
	columns: {
		accountId: uuid(CustomerAccountId),
		metricKey: SQLite.text,
		day,
		value: SQLite.real,
		limitValue: SQLite.nullable(SQLite.real),
	},
	primaryKey: ["accountId", "metricKey", "day"],
	indexes: [SQLite.index("customer_metric_daily_key_day_idx", ["metricKey", "day"])],
})
export type CustomerMetricDay = SQLite.SelectRowOf<typeof customerMetricDailyTable>

/**
 * The org's own daily rollup, written by compute: what the overview's KPIs and charts read, so a
 * 12-month range is 365 rows rather than a scan of every account's activity.
 */
export const customerOrgDailyTable = SQLite.table("customer_org_daily", {
	columns: {
		day,
		mrrMinor: money(),
		payingAccounts: count(),
		trialingAccounts: count(),
		/** ≥ 1 active user in the 30 days up to `day`. */
		activeAccounts: count(),
		dau: count(),
		wau: count(),
		mau: count(),
		healthy: count(),
		atRisk: count(),
		critical: count(),
		atRiskMrrMinor: money(),
	},
	primaryKey: ["day"],
})
export type CustomerOrgDay = SQLite.SelectRowOf<typeof customerOrgDailyTable>

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export const customerEventsTable = SQLite.table("customer_events", {
	columns: {
		id: id(CustomerEventId),
		accountId: uuid(CustomerAccountId),
		contactId: SQLite.nullable(uuid(CustomerContactId)),
		provider: textEnum(CustomerSourceSchema.literals),
		/** Dotted, e.g. `subscription.canceled`, `signal.opened`, `health.status_changed`. */
		type: SQLite.text,
		title: SQLite.text,
		data: SQLite.column(jsonb<Record<string, unknown>>(), { default: {} }),
		occurredAt: timestamptz,
		/** Dedupe key, unique per provider when set (`extra-indexes.ts`). */
		externalId: SQLite.nullable(SQLite.text),
		/** The Hazel user behind a `hazel` event (assigned, noted, snoozed). */
		actorUserId: SQLite.nullable(uuid(UserId)),
		createdAt: createdAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("customer_events_account_time_idx", ["accountId", "occurredAt"]),
		SQLite.index("customer_events_time_idx", ["occurredAt"]),
	],
})
export type CustomerEvent = SQLite.SelectRowOf<typeof customerEventsTable>
export type NewCustomerEvent = SQLite.InsertRowOf<typeof customerEventsTable>

export const customerMrrMovementsTable = SQLite.table("customer_mrr_movements", {
	columns: {
		id: id(CustomerMrrMovementId),
		accountId: uuid(CustomerAccountId),
		day,
		type: textEnum(MrrMovementType.literals),
		/** `toMrrMinor - fromMrrMinor`. */
		deltaMinor: SQLite.integer,
		fromMrrMinor: SQLite.integer,
		toMrrMinor: SQLite.integer,
		currency: SQLite.text,
		createdAt: createdAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("customer_mrr_movements_account_day_unique", ["accountId", "day"]),
		SQLite.index("customer_mrr_movements_day_idx", ["day"]),
	],
})
export type CustomerMrrMovement = SQLite.SelectRowOf<typeof customerMrrMovementsTable>

// ---------------------------------------------------------------------------
// Signals and queue
// ---------------------------------------------------------------------------

export const customerSignalRulesTable = SQLite.table("customer_signal_rules", {
	columns: {
		id: id(CustomerSignalRuleId),
		organizationId: uuid(OrganizationId),
		name: SQLite.text,
		template: textEnum(SignalTemplate.literals),
		kind: textEnum(SignalKind.literals),
		/** The floor: worse evidence escalates a signal above it. */
		severity: textEnum(SignalSeverity.literals),
		config: jsonb<RuleConfig>(),
		scope: SQLite.column(jsonb<RuleScope>(), { default: {} }),
		enabled: SQLite.column(SQLite.boolean, { default: true }),
		/** Null for a seeded built-in. */
		createdBy: SQLite.nullable(uuid(UserId)),
		updatedBy: SQLite.nullable(uuid(UserId)),
		lastTriggeredAt: SQLite.nullable(timestamptz),
		/** Accounts matching at the last evaluation. */
		matchingCount: count(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("customer_signal_rules_template_idx", ["template"])],
})
export type CustomerSignalRule = SQLite.SelectRowOf<typeof customerSignalRulesTable>
export type NewCustomerSignalRule = SQLite.InsertRowOf<typeof customerSignalRulesTable>

/**
 * A queue item. One row per episode: open → (snoozed ↔ open) → done / dismissed (may reopen) →
 * closed once the condition clears (`closedAt`; `auto_resolved` when nobody acted). At most one
 * unclosed signal per `(ruleId, accountId)` (`extra-indexes.ts`).
 */
export const customerSignalsTable = SQLite.table("customer_signals", {
	columns: {
		id: id(CustomerSignalId),
		organizationId: uuid(OrganizationId),
		accountId: uuid(CustomerAccountId),
		ruleId: uuid(CustomerSignalRuleId),
		template: textEnum(SignalTemplate.literals),
		kind: textEnum(SignalKind.literals),
		/** The rule's severity escalated by the evidence's `step`. */
		severity: textEnum(SignalSeverity.literals),
		status: SQLite.column(textEnum(SignalStatus.literals), { default: "open" }),
		/** "Stopped logging in". */
		title: SQLite.text,
		/** "No activity for 18 days; 12 weekly active users before". */
		reason: SQLite.text,
		evidence: jsonb<SignalEvidence>(),
		openingEvidence: jsonb<SignalEvidence>(),
		/** The evidence at the last snooze, dismiss or done: "worse by a full step" compares to it. */
		actionEvidence: SQLite.nullable(jsonb<SignalEvidence>()),
		priorityScore: SQLite.column(SQLite.real, { default: 0 }),
		firstDetectedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		/** Last time it (re)opened: the queue's age and the priority's freshness. */
		openedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		lastEvaluatedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		assigneeUserId: SQLite.nullable(uuid(UserId)),
		snoozedUntil: SQLite.nullable(timestamptz),
		snoozedByUserId: SQLite.nullable(uuid(UserId)),
		snoozedAt: SQLite.nullable(timestamptz),
		snoozeNote: SQLite.nullable(SQLite.text),
		resolvedAt: SQLite.nullable(timestamptz),
		resolvedByUserId: SQLite.nullable(uuid(UserId)),
		outcome: SQLite.nullable(textEnum(SignalOutcome.literals)),
		resolutionNote: SQLite.nullable(SQLite.text),
		/** `baseline`: recorded silently by the first evaluation after a backfill. */
		dismissReason: SQLite.nullable(SQLite.text),
		/** A done signal whose condition still holds reopens at this time (7-day cooldown). */
		reopenAfter: SQLite.nullable(timestamptz),
		reopenCount: count(),
		/** The episode ended (condition cleared); a recurrence opens a new row. */
		closedAt: SQLite.nullable(timestamptz),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.index("customer_signals_status_idx", ["status"]),
		SQLite.index("customer_signals_account_idx", ["accountId"]),
		SQLite.index("customer_signals_rule_idx", ["ruleId"]),
		SQLite.index("customer_signals_closed_at_idx", ["closedAt"]),
	],
})
export type CustomerSignal = SQLite.SelectRowOf<typeof customerSignalsTable>
export type NewCustomerSignal = SQLite.InsertRowOf<typeof customerSignalsTable>

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/** One row: the org's health configuration, reporting currency and compute bookkeeping. */
export const customerSettingsTable = SQLite.table("customer_settings", {
	columns: {
		id: id(CustomerSettingsId),
		organizationId: uuid(OrganizationId),
		health: jsonb<HealthSettings>(),
		/** MRR in other currencies is left out of org totals (no FX in v1). */
		reportingCurrency: SQLite.column(SQLite.text, { default: "usd" }),
		lastComputedAt: SQLite.nullable(timestamptz),
		updatedBy: SQLite.nullable(uuid(UserId)),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
})
export type CustomerSettings = SQLite.SelectRowOf<typeof customerSettingsTable>

export const customerHealthDailyTable = SQLite.table("customer_health_daily", {
	columns: {
		accountId: uuid(CustomerAccountId),
		day,
		score: SQLite.nullable(SQLite.integer),
		status: textEnum(HealthStatus.literals),
		breakdown: jsonb<HealthBreakdown>(),
	},
	primaryKey: ["accountId", "day"],
	indexes: [SQLite.index("customer_health_daily_day_idx", ["day"])],
})
export type CustomerHealthDay = SQLite.SelectRowOf<typeof customerHealthDailyTable>

// ---------------------------------------------------------------------------
// Notes and views
// ---------------------------------------------------------------------------

export const customerNotesTable = SQLite.table("customer_notes", {
	columns: {
		id: id(CustomerNoteId),
		organizationId: uuid(OrganizationId),
		accountId: uuid(CustomerAccountId),
		authorUserId: uuid(UserId),
		/** Markdown. */
		body: SQLite.text,
		pinned: SQLite.column(SQLite.boolean, { default: false }),
		/** Written while handling this signal. */
		signalId: SQLite.nullable(uuid(CustomerSignalId)),
		editedAt: SQLite.nullable(timestamptz),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("customer_notes_account_idx", ["accountId"])],
})
export type CustomerNote = SQLite.SelectRowOf<typeof customerNotesTable>
export type NewCustomerNote = SQLite.InsertRowOf<typeof customerNotesTable>

export const customerSavedViewsTable = SQLite.table("customer_saved_views", {
	columns: {
		id: id(CustomerSavedViewId),
		organizationId: uuid(OrganizationId),
		name: SQLite.text,
		/** Null = shared with the org. */
		ownerUserId: SQLite.nullable(uuid(UserId)),
		/** Set on the seeded shared views (admins edit them; nobody deletes them). */
		builtInKey: SQLite.nullable(textEnum(BuiltInViewKey.literals)),
		filters: SQLite.column(jsonb<ViewFilters>(), { default: {} }),
		sort: jsonb<ViewSort>(),
		columns: jsonb<ReadonlyArray<ListColumn>>(),
		position: SQLite.column(SQLite.real, { default: 0 }),
		createdBy: SQLite.nullable(uuid(UserId)),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		deletedAt: SQLite.nullable(timestamptz),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("customer_saved_views_owner_idx", ["ownerUserId"])],
})
export type CustomerSavedView = SQLite.SelectRowOf<typeof customerSavedViewsTable>
export type NewCustomerSavedView = SQLite.InsertRowOf<typeof customerSavedViewsTable>

// ---------------------------------------------------------------------------
// Data sources
// ---------------------------------------------------------------------------

/** One per provider (reconnecting reuses it, so the webhook URL is stable). Synced: no secrets here. */
export const customerConnectionsTable = SQLite.table("customer_connections", {
	columns: {
		id: id(CustomerConnectionId),
		organizationId: uuid(OrganizationId),
		provider: textEnum(CustomerProvider.literals),
		status: SQLite.column(textEnum(ConnectionStatus.literals), { default: "active" }),
		/** The provider account it reads, e.g. the Stripe account name. */
		externalAccountId: SQLite.nullable(SQLite.text),
		externalAccountName: SQLite.nullable(SQLite.text),
		config: jsonb<ConnectionConfig>(),
		connectedBy: uuid(UserId),
		connectedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		/** The webhook signing secret is set (else webhooks are refused, pulls still run). */
		hasWebhookSecret: SQLite.column(SQLite.boolean, { default: false }),
		lastSyncAt: SQLite.nullable(timestamptz),
		lastSuccessAt: SQLite.nullable(timestamptz),
		lastErrorAt: SQLite.nullable(timestamptz),
		lastError: SQLite.nullable(jsonb<SyncError>()),
		consecutiveFailures: count(),
		nextSyncAt: SQLite.nullable(timestamptz),
		/** The first full import finished. */
		backfilledAt: SQLite.nullable(timestamptz),
		/** Records written, all time. */
		stats: SQLite.column(jsonb<SyncStats>(), { default: EMPTY_SYNC_STATS }),
		disconnectedAt: SQLite.nullable(timestamptz),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [SQLite.uniqueIndex("customer_connections_provider_unique", ["provider"])],
})
export type CustomerConnection = SQLite.SelectRowOf<typeof customerConnectionsTable>
export type NewCustomerConnection = SQLite.InsertRowOf<typeof customerConnectionsTable>

/** A connection's credentials, AES-GCM encrypted (`IntegrationEncryption`). Never synced. */
export const customerConnectionSecretsTable = SQLite.table("customer_connection_secrets", {
	columns: {
		connectionId: uuid(CustomerConnectionId),
		encryptedApiKey: SQLite.text,
		apiKeyIv: SQLite.text,
		encryptedWebhookSecret: SQLite.nullable(SQLite.text),
		webhookSecretIv: SQLite.nullable(SQLite.text),
		encryptionKeyVersion: SQLite.column(SQLite.integer, { default: 1 }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["connectionId"],
})
export type CustomerConnectionSecret = SQLite.SelectRowOf<typeof customerConnectionSecretsTable>

export const customerSyncRunsTable = SQLite.table("customer_sync_runs", {
	columns: {
		id: id(CustomerSyncRunId),
		organizationId: uuid(OrganizationId),
		connectionId: uuid(CustomerConnectionId),
		provider: textEnum(CustomerProvider.literals),
		trigger: textEnum(SyncTrigger.literals),
		status: SQLite.column(textEnum(SyncRunStatus.literals), { default: "running" }),
		startedAt: SQLite.column(timestamptz, { defaultExpr: SQLite.timestampNow }),
		finishedAt: SQLite.nullable(timestamptz),
		progress: SQLite.nullable(jsonb<SyncProgress>()),
		stats: SQLite.column(jsonb<SyncStats>(), { default: EMPTY_SYNC_STATS }),
		error: SQLite.nullable(jsonb<SyncError>()),
		/** Pull cursor to resume from (provider-specific). */
		cursor: SQLite.nullable(SQLite.text),
	},
	primaryKey: ["id"],
	indexes: [SQLite.index("customer_sync_runs_connection_started_idx", ["connectionId", "startedAt"])],
})
export type CustomerSyncRun = SQLite.SelectRowOf<typeof customerSyncRunsTable>

/** A provider record matching could not place: linked, ignored or turned into an account by hand. */
export const customerUnmatchedRecordsTable = SQLite.table("customer_unmatched_records", {
	columns: {
		id: id(CustomerUnmatchedRecordId),
		connectionId: uuid(CustomerConnectionId),
		provider: textEnum(CustomerProvider.literals),
		entityType: textEnum(UnmatchedEntityType.literals),
		externalId: SQLite.text,
		/** Name or email, for the list. */
		label: SQLite.text,
		email: SQLite.nullable(SQLite.text),
		domain: SQLite.nullable(SQLite.text),
		valueMinor: SQLite.nullable(SQLite.integer),
		currency: SQLite.nullable(SQLite.text),
		eventCount30d: SQLite.nullable(SQLite.integer),
		/** The ingest op that could not land, replayed once linked (`IngestOp`, encoded). */
		payload: jsonb<unknown>(),
		suggestedAccountId: SQLite.nullable(uuid(CustomerAccountId)),
		/** 0–1. */
		confidence: SQLite.nullable(SQLite.real),
		/** "2 accounts share domain acme.com". */
		reason: SQLite.text,
		status: SQLite.column(textEnum(UnmatchedStatus.literals), { default: "open" }),
		resolvedByUserId: SQLite.nullable(uuid(UserId)),
		resolvedAt: SQLite.nullable(timestamptz),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
	},
	primaryKey: ["id"],
	indexes: [
		SQLite.uniqueIndex("customer_unmatched_external_unique", ["provider", "entityType", "externalId"]),
		SQLite.index("customer_unmatched_status_idx", ["status"]),
	],
})
export type CustomerUnmatchedRecord = SQLite.SelectRowOf<typeof customerUnmatchedRecordsTable>

/** Provider records to skip during matching, e.g. `*@gmail.com` contacts or internal test orgs. */
export const customerIgnoreRulesTable = SQLite.table("customer_ignore_rules", {
	columns: {
		id: id(CustomerIgnoreRuleId),
		/** Null = every provider. */
		provider: SQLite.nullable(textEnum(CustomerProvider.literals)),
		entityType: textEnum(UnmatchedEntityType.literals),
		field: textEnum(IgnoreRuleField.literals),
		/** Glob, `*` wildcard, case-insensitive. */
		pattern: SQLite.text,
		createdBy: uuid(UserId),
		createdAt: createdAt(),
	},
	primaryKey: ["id"],
})
export type CustomerIgnoreRule = SQLite.SelectRowOf<typeof customerIgnoreRulesTable>

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/**
 * The org's members and roles, projected by the `OrgObject` (`customers.setMembers`, versioned):
 * who may read (every member) and edit settings (admins and owners).
 */
export const customerMembersTable = SQLite.table("customer_members", {
	columns: {
		userId: uuid(UserId),
		role: textEnum(["owner", "admin", "member"]),
	},
	primaryKey: ["userId"],
})
export type CustomerMember = SQLite.SelectRowOf<typeof customerMembersTable>
