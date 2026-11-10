/**
 * Data source connections: per-provider config, and the sync run documents
 * (`docs/customers/tech-design.md` §5). Credentials never appear here: they live encrypted in
 * `customer_connection_secrets`, which is not synced.
 */
import { Schema } from "effect"
import type { CustomerProvider } from "./enums"

/** Clerk: users' sign-ins and sessions drive activity. */
export const ClerkConnectionConfig = Schema.TaggedStruct("clerk", {
	/** Create accounts for Clerk organizations with no match (Clerk is the identity source). */
	createAccounts: Schema.Boolean,
})

/** Stripe: billing. Invoices always come from Stripe; subscriptions only when Autumn is not connected. */
export const StripeConnectionConfig = Schema.TaggedStruct("stripe", {
	/** The customer metadata key holding the Clerk organization id (shared-id matching). */
	clerkOrgMetadataKey: Schema.String,
	/** Match unknown customers to accounts by their email domain. */
	matchByDomain: Schema.Boolean,
})

/** Autumn: products → subscriptions (the MRR source when connected), feature usage and limits → metrics. */
export const AutumnConnectionConfig = Schema.TaggedStruct("autumn", {
	/** Autumn customer id = Clerk organization id. */
	customerIdIsClerkOrgId: Schema.Boolean,
})

/** Maple: product events by GroupId/UserId → activity and per-event metrics, pulled on a schedule. */
export const MapleConnectionConfig = Schema.TaggedStruct("maple", {
	mapleOrgId: Schema.String,
	/** Event names that count as activity; empty = every event. */
	activityEvents: Schema.Array(Schema.String),
	/** Event name → metric key written per account per day. */
	metricMappings: Schema.Array(Schema.Struct({ event: Schema.String, metricKey: Schema.String })),
	/** Which event attribute names the account and the user (default `GroupId` / `UserId`). */
	accountKey: Schema.String,
	userKey: Schema.String,
	/** 1–365. */
	lookbackDays: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 365 })),
})

export const ConnectionConfig = Schema.Union([
	ClerkConnectionConfig,
	StripeConnectionConfig,
	AutumnConnectionConfig,
	MapleConnectionConfig,
])
export type ConnectionConfig = typeof ConnectionConfig.Type

/** A connection config per provider, keyed by its own provider. */
type ConnectionConfigTable = { readonly [P in CustomerProvider]: ConnectionConfig & { _tag: P } }

export const DEFAULT_CONNECTION_CONFIG: ConnectionConfigTable = {
	clerk: { _tag: "clerk", createAccounts: true },
	stripe: { _tag: "stripe", clerkOrgMetadataKey: "clerk_org_id", matchByDomain: true },
	autumn: { _tag: "autumn", customerIdIsClerkOrgId: true },
	maple: {
		_tag: "maple",
		mapleOrgId: "",
		activityEvents: [],
		metricMappings: [],
		accountKey: "GroupId",
		userKey: "UserId",
		lookbackDays: 90,
	},
}

/** Records written by a run (or, on a connection, in total). */
export const SyncStats = Schema.Struct({
	accounts: Schema.Int,
	contacts: Schema.Int,
	subscriptions: Schema.Int,
	invoices: Schema.Int,
	events: Schema.Int,
	activityDays: Schema.Int,
	metricDays: Schema.Int,
	unmatched: Schema.Int,
})
export type SyncStats = typeof SyncStats.Type

export const EMPTY_SYNC_STATS: SyncStats = {
	accounts: 0,
	contacts: 0,
	subscriptions: 0,
	invoices: 0,
	events: 0,
	activityDays: 0,
	metricDays: 0,
	unmatched: 0,
}

export const SyncProgress = Schema.Struct({
	/** E.g. "customers", "subscriptions", "invoices". */
	step: Schema.String,
	done: Schema.Int,
	total: Schema.NullOr(Schema.Int),
})
export type SyncProgress = typeof SyncProgress.Type

export const SyncError = Schema.Struct({
	/** `auth` (bad credentials), `rate_limited`, `provider`, `network`, `internal`. */
	code: Schema.Literals(["auth", "rate_limited", "provider", "network", "internal"]),
	message: Schema.String,
	httpStatus: Schema.NullOr(Schema.Int),
})
export type SyncError = typeof SyncError.Type
