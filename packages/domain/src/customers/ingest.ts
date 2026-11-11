/**
 * The neutral write API every integration calls (`CustomerIngest`, `docs/customers/tech-design.md`
 * §3): a provider adapter turns webhooks and pulls into these ops, and ingest resolves identities,
 * applies per-field precedence and upserts, idempotently on `(provider, externalId)`.
 *
 * A record names other records by `ProviderRef` (any provider's id), so cross-provider ids resolve
 * through the refs: Autumn's customer id is the Clerk organization id, Maple's `UserId` is the
 * Clerk user id.
 */
import { CustomerIgnoreRuleId, CustomerUnmatchedRecordId } from "@hazel/schema"
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
 * When the source last changed the record (its `updated_at`), so a late delivery cannot undo a
 * newer deletion: a non-deleting op observed at or before the record's deletion changes nothing.
 * Absent: the op is applied whatever the order.
 */
const ObservedAt = optional(IsoTimestamp)

/**
 * When the adapter read the record (taken before the request), so two reads applied out of order
 * cannot regress it: an op observed before the newest one applied to its subscription or invoice
 * changes nothing. Absent: the op is applied whatever the order.
 */
const BillingObservedAt = optional(IsoTimestamp)

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
	/**
	 * Match an existing account by a shared domain when no ref or `sameAs` id places it (billing
	 * sources; Stripe's `matchByDomain` config can still turn it off). Identity sources leave it
	 * unset: two organizations sharing a domain are two customers.
	 */
	matchByDomain: optional(Schema.Boolean),
	/** With no match: create the account (Clerk), or park it as an unmatched record (billing sources). */
	onNoMatch: Schema.Literals(["create", "unmatched"]),
	/** The provider deleted it: its ref goes stale; the account is soft-deleted when no live ref is left. */
	deleted: optional(Schema.Boolean),
	observedAt: ObservedAt,
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
	/** Only ever moves forward: an earlier time (or `null`) than the stored one is ignored. */
	lastSeenAt: optional(When),
	/** Only ever moves forward, like `lastSeenAt`. */
	lastSignInAt: optional(When),
	signInCount30d: optional(Schema.Int),
	attributes: optional(Schema.Record(Schema.String, Schema.Unknown)),
	/** Left the organization: soft-deleted, a `contact.removed` event. */
	removed: optional(Schema.Boolean),
	observedAt: ObservedAt,
})
export type UpsertContact = typeof UpsertContact.Type

export const UpsertSubscription = Schema.TaggedStruct("subscription", {
	externalId: Schema.String,
	account: ProviderRef,
	planName: NullableText,
	status: SubscriptionStatus,
	/** Absent keeps the stored MRR (0 on insert): for a provider that cannot price it right now. */
	mrrMinor: optional(Schema.Int),
	listMrrMinor: optional(Schema.NullOr(Schema.Int)),
	/**
	 * Billed on usage (in arrears) with no fixed price MRR can capture: a live one makes its account
	 * paying even at `mrrMinor: 0`. MRR (and its movements) still come from `mrrMinor` alone.
	 */
	billsByUsage: optional(Schema.Boolean),
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
	observedAt: BillingObservedAt,
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
	observedAt: BillingObservedAt,
})
export type UpsertInvoice = typeof UpsertInvoice.Type

/**
 * A contact's activity on a day. Only the given fields are written (each provider owns its own):
 * `eventCount` replaces, `sessionCount` keeps the highest count seen for the day, `signedIn` once
 * true stays true.
 */
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
	value: Schema.Finite,
	limitValue: optional(Schema.NullOr(Schema.Finite)),
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
	Schema.TaggedStruct("Unmatched", { recordId: CustomerUnmatchedRecordId, reason: Schema.String }),
	/** An ignore rule matched (`null`: the record was ignored by hand). */
	Schema.TaggedStruct("Ignored", { ruleId: Schema.NullOr(CustomerIgnoreRuleId) }),
	/** The store refuses the op (it breaks the contract, a built-in metric key): skipped, not retried. */
	Schema.TaggedStruct("Rejected", { message: Schema.String }),
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
export const FIELD_PRECEDENCE: ReadonlyMap<string, ReadonlyArray<CustomerSource>> = new Map<
	string,
	ReadonlyArray<CustomerSource>
>([
	["name", ["hazel", "clerk", "stripe", "autumn", "maple"]],
	["logoUrl", ["hazel", "clerk", "stripe", "autumn"]],
	["seatsUsed", ["hazel", "autumn", "clerk"]],
	["seatsLimit", ["hazel", "autumn", "clerk"]],
	["email", ["clerk", "stripe", "autumn", "maple"]],
	["avatarUrl", ["clerk", "maple"]],
	["role", ["clerk"]],
])
