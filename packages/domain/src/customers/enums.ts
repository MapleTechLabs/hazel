/**
 * The closed sets of the Customers area (`docs/customers/tech-design.md`). `@hazel/db` builds its
 * `textEnum` columns from each schema's `.literals`.
 */
import { Schema } from "effect"

/** The providers that write customer data. `hazel` marks what Hazel itself wrote (manual edits, compute). */
export const CustomerProvider = Schema.Literals(["clerk", "stripe", "autumn", "maple"])
export type CustomerProvider = typeof CustomerProvider.Type

export const CustomerSource = Schema.Literals(["clerk", "stripe", "autumn", "maple", "hazel"])
export type CustomerSource = typeof CustomerSource.Type

export const LifecycleStage = Schema.Literals(["lead", "trialing", "active", "past_due", "churned"])
export type LifecycleStage = typeof LifecycleStage.Type

export const HealthStatus = Schema.Literals(["healthy", "at_risk", "critical", "unknown"])
export type HealthStatus = typeof HealthStatus.Type

export const SubscriptionStatus = Schema.Literals([
	"trialing",
	"active",
	"past_due",
	"unpaid",
	"paused",
	"canceled",
])
export type SubscriptionStatus = typeof SubscriptionStatus.Type

export const BillingInterval = Schema.Literals(["month", "year", "other"])
export type BillingInterval = typeof BillingInterval.Type

/** `upcoming`: the provider's preview of the next invoice (one per subscription at most). */
export const InvoiceStatus = Schema.Literals(["draft", "open", "paid", "uncollectible", "void", "upcoming"])
export type InvoiceStatus = typeof InvoiceStatus.Type

export const MetricAggregation = Schema.Literals(["sum", "max", "last"])
export type MetricAggregation = typeof MetricAggregation.Type

export const SignalKind = Schema.Literals(["risk", "opportunity"])
export type SignalKind = typeof SignalKind.Type

export const SignalSeverity = Schema.Literals(["low", "medium", "high"])
export type SignalSeverity = typeof SignalSeverity.Type

export const SignalStatus = Schema.Literals(["open", "snoozed", "done", "dismissed", "auto_resolved"])
export type SignalStatus = typeof SignalStatus.Type

export const SignalOutcome = Schema.Literals(["contacted", "fixed", "not_an_issue", "other"])
export type SignalOutcome = typeof SignalOutcome.Type

export const SignalTemplate = Schema.Literals([
	"inactive",
	"usage_drop",
	"payment_failed",
	"cancel_scheduled",
	"trial_ending_low_activation",
	"onboarding_stalled",
	"health_drop",
	"champion_inactive",
	"near_limit",
	"seat_growth",
])
export type SignalTemplate = typeof SignalTemplate.Type

/** What an external ref points at. */
export const RefEntityType = Schema.Literals(["account", "contact"])
export type RefEntityType = typeof RefEntityType.Type

/** What a full listing can sweep (`PullPage.sweep`): account and contact refs, and subscriptions. */
export const SweepEntityType = Schema.Literals(["account", "contact", "subscription"])
export type SweepEntityType = typeof SweepEntityType.Type

/** What an unmatched record holds: a ref-able entity, or a billing row whose account is unknown. */
export const UnmatchedEntityType = Schema.Literals(["account", "contact", "subscription", "invoice"])
export type UnmatchedEntityType = typeof UnmatchedEntityType.Type

export const MatchMethod = Schema.Literals(["existing", "shared_id", "domain", "manual", "created"])
export type MatchMethod = typeof MatchMethod.Type

/** `disconnected`: the credentials are gone; its records stay, marked stale. */
export const ConnectionStatus = Schema.Literals(["active", "error", "disconnected"])
export type ConnectionStatus = typeof ConnectionStatus.Type

export const SyncTrigger = Schema.Literals(["schedule", "webhook", "manual", "backfill"])
export type SyncTrigger = typeof SyncTrigger.Type

export const SyncRunStatus = Schema.Literals(["running", "succeeded", "failed"])
export type SyncRunStatus = typeof SyncRunStatus.Type

export const UnmatchedStatus = Schema.Literals(["open", "linked", "ignored"])
export type UnmatchedStatus = typeof UnmatchedStatus.Type

export const MrrMovementType = Schema.Literals(["new", "expansion", "contraction", "churn", "reactivation"])
export type MrrMovementType = typeof MrrMovementType.Type

export const HealthComponentKey = Schema.Literals(["usage", "engagement", "billing", "signals"])
export type HealthComponentKey = typeof HealthComponentKey.Type

/** How a signal's evidence is drawn (queue mini-viz, side panel chart). */
export const EvidenceViz = Schema.Literals(["amount", "last_active", "series", "limit", "delta", "ratio"])
export type EvidenceViz = typeof EvidenceViz.Type

/** Derived per contact: active in the last 30 days, seen before but not since, never seen. */
export const ContactActivityStatus = Schema.Literals(["active", "dormant", "never_active"])
export type ContactActivityStatus = typeof ContactActivityStatus.Type

/** The seeded shared views; admins may edit them, nobody deletes them. */
export const BuiltInViewKey = Schema.Literals(["my_customers", "paying", "trialing", "at_risk", "churned"])
export type BuiltInViewKey = typeof BuiltInViewKey.Type

/** The overview's range picker. */
export const CustomersRange = Schema.Literals(["7d", "30d", "90d", "12m"])
export type CustomersRange = typeof CustomersRange.Type

/** Ignore rule targets: what of a provider record the pattern is matched against. */
export const IgnoreRuleField = Schema.Literals(["email", "domain", "name", "external_id"])
export type IgnoreRuleField = typeof IgnoreRuleField.Type
