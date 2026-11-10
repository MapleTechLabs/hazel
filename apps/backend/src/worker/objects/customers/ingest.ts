/**
 * `CustomerIngest`: the one write path for provider data (`docs/customers/tech-design.md` §3).
 * Provider adapters (`./providers.ts`) turn webhooks and pulls into `IngestOp`s; this service
 * resolves identities, applies field precedence and upserts, inside the org's `CustomersObject`.
 *
 * Contract:
 *
 * - Idempotent: an op keyed by `(provider, externalId)` applied twice changes nothing the second
 *   time (`Unchanged`); replaying a whole page is safe.
 * - Ordered: ops apply in the given order, in transactions of ≤ `INGEST_CHUNK` ops, so a page's
 *   accounts land before the contacts and subscriptions that name them.
 * - Matching (accounts): existing ref → `sameAs` shared id → domain (only with the op's
 *   `matchByDomain`) → create (`onNoMatch: "create"`) or an unmatched record. More than one
 *   candidate at a step is ambiguous: unmatched, with the best candidate as `suggestedAccountId`.
 *   Ignore rules are checked before creating, and an ignored account's members, billing and usage
 *   are ignored with it.
 * - Contacts: ref → same email within the account → create. Billing rows and metrics whose
 *   account does not resolve become unmatched records holding the op (replayed once linked).
 * - Precedence: `FIELD_PRECEDENCE` per field, recorded in `fieldSources`.
 * - Ordering: an op's `observedAt` at or before its record's deletion leaves it deleted.
 * - Removal: `deleted` / `removed` ops, or `completeSweep` after a full pull; a later sighting
 *   revives, unless the delete op was observed at or after it.
 * - It never computes: it marks compute due (`requestComputeAfterIngest`), which the alarm runs
 *   soon after (no sooner than the minimum gap since the last compute).
 */
import type { DatabaseError, schema } from "@hazel/db"
import type { IngestOp, IngestOutcome, IngestReport, SyncError, SyncProgress } from "@hazel/domain/customers"
import type { CustomerProvider, RefEntityType, SyncTrigger } from "@hazel/domain/customers"
import type {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerSyncRunId,
	CustomerUnmatchedRecordId,
	UserId,
} from "@hazel/schema"
import type { Effect } from "effect"
import type { CustomerIngestRejectedError } from "./ingest-live"

// The service and its runtime values live with the implementation (`./ingest-live.ts`), so that
// module imports only types from here.
export { CustomerIngest, CustomerIngestRejectedError } from "./ingest-live"

/** Who is writing: the connection (its provider), and the sync run it belongs to. */
export interface IngestContext {
	readonly connectionId: CustomerConnectionId
	readonly provider: CustomerProvider
	/** Null for a webhook delivery applied outside a run. */
	readonly runId: CustomerSyncRunId | null
	readonly trigger: SyncTrigger
}

export type RunResult =
	| { readonly _tag: "Succeeded"; readonly cursor: string | null }
	| { readonly _tag: "Failed"; readonly error: SyncError }
	/** A retryable failure: the run stays `running` (its cursor resumes), the connection backs off. */
	| { readonly _tag: "Retrying"; readonly error: SyncError }

export interface CustomerIngestApi {
	/**
	 * Apply `ops` in order; the report has one outcome per op and the run's stats so far. An op the
	 * store refuses is skipped (`Rejected`), the rest still land.
	 */
	readonly apply: (
		context: IngestContext,
		ops: ReadonlyArray<IngestOp>,
	) => Effect.Effect<IngestReport, DatabaseError>

	/** Open a run (`customer_sync_runs`, synced: the data sources page shows it live). */
	readonly startRun: (
		connectionId: CustomerConnectionId,
		trigger: SyncTrigger,
	) => Effect.Effect<schema.CustomerSyncRun, DatabaseError>

	readonly progress: (
		runId: CustomerSyncRunId,
		progress: SyncProgress,
	) => Effect.Effect<void, DatabaseError>

	/**
	 * Close a run (or record a retryable failure on it) and update its connection (`lastSuccessAt` /
	 * `lastErrorAt`, `consecutiveFailures`). A successful `backfill` sets `backfilledAt` and arms the
	 * silent baseline evaluation (`docs/customers/tech-design.md` §4.7); the connection's first one
	 * also rebuilds the daily history.
	 */
	readonly finishRun: (runId: CustomerSyncRunId, result: RunResult) => Effect.Effect<void, DatabaseError>

	/** A human linked an unmatched record: record a `manual` ref and apply its op. */
	readonly link: (
		recordId: CustomerUnmatchedRecordId,
		accountId: CustomerAccountId,
		by: UserId,
	) => Effect.Effect<IngestOutcome, CustomerIngestRejectedError | DatabaseError>

	/** Mark a connection's refs stale (disconnect) or fresh again (reconnect). */
	readonly setStale: (
		connectionId: CustomerConnectionId,
		stale: boolean,
	) => Effect.Effect<void, DatabaseError>

	/**
	 * A pull that listed every record of `entityTypes` of the connection's provider finished: the
	 * provider's refs not seen since `since` (the run's start) are gone. An account ref goes stale
	 * (the account is soft-deleted once no live ref is left, as with `deleted`); a contact is
	 * soft-deleted with a `contact.removed` event. Only for a complete listing: a partial or
	 * incremental pull would remove what it did not ask for (the caller's responsibility).
	 */
	readonly completeSweep: (
		connectionId: CustomerConnectionId,
		since: Date,
		entityTypes: ReadonlyArray<RefEntityType>,
	) => Effect.Effect<void, DatabaseError>
}
