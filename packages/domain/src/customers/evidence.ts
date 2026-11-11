/**
 * Why a signal fired, as data the UI can draw (`viz`) and compute can compare (`step`).
 *
 * `step` is how far past the rule's threshold the evidence is (0, 1 or 2 escalation steps). The
 * signal's severity is the rule's severity raised by `step` (capped at `high`), and "worse by a
 * full step" (wake a snoozed signal early, reopen a dismissed one) means `step` went up.
 */
import { CustomerContactId, CustomerInvoiceId } from "@hazel/schema"
import { Schema } from "effect"
import { SubscriptionStatus } from "./enums"

/** A UTC calendar day, `YYYY-MM-DD`: the key of every daily table. A real date (no `2026-02-30`). */
export const Day = Schema.String.check(
	Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/),
	Schema.makeFilter((day) => {
		const date = new Date(`${day}T00:00:00Z`)
		return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day) ? undefined : "Not a date"
	}),
).annotate({
	title: "Day",
	description: "A UTC calendar day, YYYY-MM-DD",
})
export type Day = typeof Day.Type

/**
 * An instant inside a JSON document (evidence, breakdowns, configs): ISO-8601 text, so a stored
 * document reads back exactly as written.
 */
export const IsoTimestamp = Schema.String.check(
	Schema.makeFilter((value) => (Number.isNaN(Date.parse(value)) ? "Not a date" : undefined)),
).annotate({ title: "IsoTimestamp", description: "ISO-8601 instant" })
export type IsoTimestamp = typeof IsoTimestamp.Type

export const SeriesPoint = Schema.Struct({ day: Day, value: Schema.Number })
export type SeriesPoint = typeof SeriesPoint.Type

export const EvidenceStep = Schema.Literals([0, 1, 2])
export type EvidenceStep = typeof EvidenceStep.Type

/** `payment_failed`: the unpaid amount and its invoice. */
export const AmountEvidence = Schema.TaggedStruct("amount", {
	step: EvidenceStep,
	amountMinor: Schema.Int,
	currency: Schema.String,
	invoiceId: Schema.NullOr(CustomerInvoiceId),
	invoiceNumber: Schema.NullOr(Schema.String),
	subscriptionStatus: Schema.NullOr(SubscriptionStatus),
	dueAt: Schema.NullOr(IsoTimestamp),
	daysOverdue: Schema.Int,
	attemptCount: Schema.NullOr(Schema.Int),
	declineReason: Schema.NullOr(Schema.String),
	nextRetryAt: Schema.NullOr(IsoTimestamp),
})

/** `inactive`, `champion_inactive`: when the account (or its champion) was last active. */
export const LastActiveEvidence = Schema.TaggedStruct("last_active", {
	step: EvidenceStep,
	lastActiveAt: Schema.NullOr(IsoTimestamp),
	daysInactive: Schema.Int,
	/** Distinct active users in the window before the quiet period. */
	priorActiveUsers: Schema.Int,
	/** `champion_inactive`: the champion. */
	contactId: Schema.NullOr(CustomerContactId),
	contactName: Schema.NullOr(Schema.String),
	contactEmail: Schema.NullOr(Schema.String),
})

/** `usage_drop`: recent vs baseline average of a metric, with the daily series behind it. */
export const SeriesEvidence = Schema.TaggedStruct("series", {
	step: EvidenceStep,
	metricKey: Schema.String,
	recentAvg: Schema.Number,
	baselineAvg: Schema.Number,
	/** Negative for a drop, e.g. -42.5. */
	changePct: Schema.Number,
	recentDays: Schema.Int,
	baselineDays: Schema.Int,
	/** The last `recentDays + baselineDays` days, oldest first. */
	series: Schema.Array(SeriesPoint),
})

/** `near_limit`: a metered feature against its plan limit. */
export const LimitEvidence = Schema.TaggedStruct("limit", {
	step: EvidenceStep,
	metricKey: Schema.String,
	metricName: Schema.String,
	value: Schema.Number,
	limit: Schema.Number,
	pct: Schema.Number,
})

/** `cancel_scheduled`, `health_drop`, `seat_growth`: a value that moved from `from` to `to`. */
export const DeltaEvidence = Schema.TaggedStruct("delta", {
	step: EvidenceStep,
	unit: Schema.Literals(["minor", "points", "users"]),
	from: Schema.Number,
	to: Schema.Number,
	changePct: Schema.NullOr(Schema.Number),
	/** For `unit: "minor"`. */
	currency: Schema.NullOr(Schema.String),
	/** When it takes effect (a scheduled cancellation's period end). */
	effectiveAt: Schema.NullOr(IsoTimestamp),
	/** E.g. plan names, health statuses. */
	fromLabel: Schema.NullOr(Schema.String),
	toLabel: Schema.NullOr(Schema.String),
	reason: Schema.NullOr(Schema.String),
	series: Schema.Array(SeriesPoint),
})

/** `trial_ending_low_activation`, `onboarding_stalled`: a count against the target it misses. */
export const RatioEvidence = Schema.TaggedStruct("ratio", {
	step: EvidenceStep,
	value: Schema.Int,
	target: Schema.Int,
	unit: Schema.Literals(["users", "contacts"]),
	/** The trial end. */
	deadline: Schema.NullOr(IsoTimestamp),
	daysLeft: Schema.NullOr(Schema.Int),
	/** Days since the account was first seen. */
	ageDays: Schema.NullOr(Schema.Int),
})

/** Discriminated by `_tag`, which is the `viz` (`EvidenceViz`). */
export const SignalEvidence = Schema.Union([
	AmountEvidence,
	LastActiveEvidence,
	SeriesEvidence,
	LimitEvidence,
	DeltaEvidence,
	RatioEvidence,
])
export type SignalEvidence = typeof SignalEvidence.Type
