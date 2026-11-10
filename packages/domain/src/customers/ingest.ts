/**
 * The neutral write API every integration calls (`CustomerIngest`, `docs/customers/tech-design.md`
 * §3): a provider adapter turns webhooks and pulls into these ops, and ingest resolves identities,
 * applies per-field precedence and upserts, idempotently on `(provider, externalId)`.
 *
 * A record names other records by `ProviderRef` (any provider's id), so cross-provider ids resolve
 * through the refs: Autumn's customer id is the Clerk organization id, Maple's `UserId` is the
 * Clerk user id.
 */
import { Schema } from "effect"
import { SyncStats } from "./connections"
import {
	BillingInterval,
	CustomerProvider,
	CustomerSource,
	InvoiceStatus,
	MetricAggregation,
	SubscriptionStatus,
} from "./enums"
import { Day, IsoTimestamp } from "./evidence"

export const ProviderRef = Schema.Struct({ provider: CustomerProvider, externalId: Schema.String })
export type ProviderRef = typeof ProviderRef.Type

const optional = Schema.optionalKey
const NullableText = Schema.NullOr(Schema.String)
const When = Schema.NullOr(IsoTimestamp)

/**
 * A provider's account record (Clerk organization, Stripe customer, Autumn customer). Absent
 * fields are left as they are; `null` clears.
 */
export const UpsertAccount = Schema.TaggedStruct("account", {
	externalId: Schema.String,
	externalUrl: optional(NullableText),
	name: optional(Schema.String),
	/** Merged into the account's domains (never removes one). Free-mail domains are ignored. */
	domains: optional(Schema.Array(Schema.String)),
	logoUrl: optional(NullableText),
	seatsUsed: optional(Schema.NullOr(Schema.Int)),
	seatsLimit: optional(Schema.NullOr(Schema.Int)),
	attributes: optional(Schema.Record(Schema.String, Schema.Unknown)),
	/** When the provider created it: the account's `firstSeenAt` if earlier. */
	createdAt: optional(IsoTimestamp),
	/** Shared ids naming the same customer elsewhere, e.g. Stripe `metadata.clerk_org_id`. */
	sameAs: Schema.Array(ProviderRef),
	/** With no match: create the account (Clerk), or park it as an unmatched record (billing sources). */
	onNoMatch: Schema.Literals(["create", "unmatched"]),
	/** The provider deleted it: its ref goes stale; the account is soft-deleted when no live ref is left. */
	deleted: optional(Schema.Boolean),
})
export type UpsertAccount = typeof UpsertAccount.Type

/** A user of an account (Clerk membership). Matched by ref, then by email within the account. */
export const UpsertContact = Schema.TaggedStruct("contact", {
	externalId: Schema.String,
	account: ProviderRef,
	externalUrl: optional(NullableText),
	email: optional(NullableText),
	name: optional(NullableText),
	avatarUrl: optional(NullableText),
	title: optional(NullableText),
	role: optional(NullableText),
	isBillingContact: optional(Schema.Boolean),
	joinedAt: optional(When),
	lastSeenAt: optional(When),
	lastSignInAt: optional(When),
	signInCount30d: optional(Schema.Int),
	attributes: optional(Schema.Record(Schema.String, Schema.Unknown)),
	/** Left the organization: soft-deleted, a `contact.removed` event. */
	removed: optional(Schema.Boolean),
})
export type UpsertContact = typeof UpsertContact.Type

export const UpsertSubscription = Schema.TaggedStruct("subscription", {
	externalId: Schema.String,
	account: ProviderRef,
	planName: NullableText,
	status: SubscriptionStatus,
	mrrMinor: Schema.Int,
	listMrrMinor: optional(Schema.NullOr(Schema.Int)),
	currency: Schema.String,
	interval: BillingInterval,
	quantity: Schema.Int,
	startedAt: When,
	trialEndsAt: When,
	currentPeriodEnd: When,
	cancelAtPeriodEnd: Schema.Boolean,
	canceledAt: When,
	cancellationReason: optional(NullableText),
	paymentMethod: optional(
		Schema.NullOr(
			Schema.Struct({
				brand: NullableText,
				last4: NullableText,
				expMonth: Schema.NullOr(Schema.Int),
				expYear: Schema.NullOr(Schema.Int),
			}),
		),
	),
})
export type UpsertSubscription = typeof UpsertSubscription.Type

export const UpsertInvoice = Schema.TaggedStruct("invoice", {
	externalId: Schema.String,
	account: ProviderRef,
	subscriptionExternalId: Schema.NullOr(Schema.String),
	number: NullableText,
	status: InvoiceStatus,
	amountDueMinor: Schema.Int,
	amountPaidMinor: Schema.Int,
	currency: Schema.String,
	issuedAt: When,
	dueAt: When,
	paidAt: When,
	attemptCount: Schema.Int,
	nextRetryAt: optional(When),
	declineReason: optional(NullableText),
	hostedUrl: optional(NullableText),
})
export type UpsertInvoice = typeof UpsertInvoice.Type

/** A contact's activity on a day. Only the given fields are written (each provider owns its own). */
export const RecordActivity = Schema.TaggedStruct("activity", {
	contact: ProviderRef,
	account: ProviderRef,
	day: Day,
	eventCount: optional(Schema.Int),
	sessionCount: optional(Schema.Int),
	signedIn: optional(Schema.Boolean),
})
export type RecordActivity = typeof RecordActivity.Type

/** A metric's value for an account on a day (replaces it), with its plan limit when metered. */
export const RecordMetric = Schema.TaggedStruct("metric", {
	account: ProviderRef,
	metricKey: Schema.String,
	day: Day,
	value: Schema.Number,
	limitValue: optional(Schema.NullOr(Schema.Number)),
})
export type RecordMetric = typeof RecordMetric.Type

/** Declares a source metric (idempotent on `key`); built-in keys are refused. */
export const DefineMetric = Schema.TaggedStruct("metric_definition", {
	key: Schema.String,
	name: Schema.String,
	unit: NullableText,
	aggregation: MetricAggregation,
	description: NullableText,
})
export type DefineMetric = typeof DefineMetric.Type

/** A timeline event, deduped on `(provider, externalId)`. */
export const RecordEvent = Schema.TaggedStruct("event", {
	externalId: Schema.String,
	account: ProviderRef,
	contact: optional(ProviderRef),
	/** Dotted, e.g. `invoice.payment_failed`. */
	type: Schema.String,
	title: Schema.String,
	data: optional(Schema.Record(Schema.String, Schema.Unknown)),
	occurredAt: IsoTimestamp,
})
export type RecordEvent = typeof RecordEvent.Type

export const IngestOp = Schema.Union([
	UpsertAccount,
	UpsertContact,
	UpsertSubscription,
	UpsertInvoice,
	RecordActivity,
	RecordMetric,
	DefineMetric,
	RecordEvent,
])
export type IngestOp = typeof IngestOp.Type

/** What one op did. Ids are the store's (account, contact, …) or the unmatched record's. */
export const IngestOutcome = Schema.Union([
	Schema.TaggedStruct("Created", { id: Schema.String }),
	Schema.TaggedStruct("Updated", { id: Schema.String }),
	Schema.TaggedStruct("Unchanged", { id: Schema.String }),
	/** Parked for a human: no match, an ambiguous match, or an unknown account. */
	Schema.TaggedStruct("Unmatched", { recordId: Schema.String, reason: Schema.String }),
	/** An ignore rule matched. */
	Schema.TaggedStruct("Ignored", { ruleId: Schema.String }),
])
export type IngestOutcome = typeof IngestOutcome.Type

export const IngestReport = Schema.Struct({
	stats: SyncStats,
	/** One per op, in order. */
	outcomes: Schema.Array(IngestOutcome),
})
export type IngestReport = typeof IngestReport.Type

/**
 * Who may set an account or contact field, best first. A source writes a field only when no
 * better source set it (`fieldSources`); `hazel` (a manual edit) beats every provider. Fields not
 * listed are written by any source.
 */
export const FIELD_PRECEDENCE: Readonly<Record<string, ReadonlyArray<CustomerSource>>> = {
	name: ["hazel", "clerk", "stripe", "autumn", "maple"],
	logoUrl: ["hazel", "clerk", "stripe", "autumn"],
	seatsUsed: ["hazel", "autumn", "clerk"],
	seatsLimit: ["hazel", "autumn", "clerk"],
	email: ["clerk", "stripe", "autumn", "maple"],
	avatarUrl: ["clerk", "maple"],
	role: ["clerk"],
}
