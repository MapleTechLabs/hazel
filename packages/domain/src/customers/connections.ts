/**
 * Data source connections: the opaque config, and the sync run documents
 * (`docs/customers/tech-design.md` §5). Credentials never appear here: they live encrypted in
 * `customer_connection_secrets`, which is not synced.
 */
import { Schema } from "effect"
import { SweepEntityType } from "./enums"

/**
 * A connection's config, opaque here: each integration's schema decodes it where it is read
 * (`@hazel/customer-integrations`). Stored configs rely on that decoding, so this keeps every key.
 */
export const ConnectionConfig = Schema.StructWithRest(Schema.Struct({ _tag: Schema.String }), [
	Schema.Record(Schema.String, Schema.Unknown),
])
export type ConnectionConfig = typeof ConnectionConfig.Type

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
	/** Ops the store refused (skipped); absent on stats recorded before it was counted. */
	rejected: Schema.optionalKey(Schema.Int),
	/**
	 * A run's sweep that would have removed too many records of these types (a listing that ended
	 * early, `CustomerIngest.completeSweep`), so it removed none of them.
	 */
	sweepSkipped: Schema.optionalKey(Schema.Array(SweepEntityType)),
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
