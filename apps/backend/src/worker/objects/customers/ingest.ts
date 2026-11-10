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
 * - Matching (accounts): existing ref → `sameAs` shared id → domain → create (`onNoMatch: "create"`)
 *   or an unmatched record. More than one candidate at a step is ambiguous: unmatched, with the
 *   best candidate as `suggestedAccountId`. Ignore rules are checked before creating.
 * - Contacts: ref → same email within the account → create. Billing rows and metrics whose
 *   account does not resolve become unmatched records holding the op (replayed once linked).
 * - Precedence: `FIELD_PRECEDENCE` per field, recorded in `fieldSources`.
 * - It never computes: it marks compute due (`requestCompute`), which the alarm runs soon after.
 */
import type { DatabaseError, Database } from "@hazel/db"
import type { IngestOp, IngestOutcome, IngestReport, SyncError, SyncProgress } from "@hazel/domain/customers"
import type { CustomerProvider, SyncTrigger } from "@hazel/domain/customers"
import type {
	CustomerAccountId,
	CustomerConnectionId,
	CustomerSyncRunId,
	CustomerUnmatchedRecordId,
	UserId,
} from "@hazel/schema"
import { Context, type Effect, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"

/** Ops per transaction. */
export const INGEST_CHUNK = 500

/** Who is writing: the connection (its provider), and the sync run it belongs to. */
export interface IngestContext {
	readonly connectionId: CustomerConnectionId
	readonly provider: CustomerProvider
	/** Null for a webhook delivery applied outside a run. */
	readonly runId: CustomerSyncRunId | null
	readonly trigger: SyncTrigger
}

/** An op the store cannot take (a built-in metric key, a negative amount). Not retried. */
export class CustomerIngestRejectedError extends Schema.TaggedError<CustomerIngestRejectedError>()(
	"CustomerIngestRejectedError",
	{ index: Schema.Int, op: Schema.String, message: Schema.String },
) {}

export type RunResult =
	| { readonly _tag: "Succeeded"; readonly cursor: string | null }
	| { readonly _tag: "Failed"; readonly error: SyncError }

type Store = Database.Database | SqlClient

export interface CustomerIngestApi {
	/** Apply `ops` in order; the report has one outcome per op and the run's stats so far. */
	readonly apply: (
		context: IngestContext,
		ops: ReadonlyArray<IngestOp>,
	) => Effect.Effect<IngestReport, CustomerIngestRejectedError | DatabaseError, Store>

	/** Open a run (`customer_sync_runs`, synced: the data sources page shows it live). */
	readonly startRun: (
		connectionId: CustomerConnectionId,
		trigger: SyncTrigger,
	) => Effect.Effect<CustomerSyncRunId, DatabaseError, Store>

	readonly progress: (
		runId: CustomerSyncRunId,
		progress: SyncProgress,
	) => Effect.Effect<void, DatabaseError, Store>

	/**
	 * Close a run and update its connection (`lastSuccessAt` / `lastErrorAt`, `consecutiveFailures`,
	 * `nextSyncAt`). A successful `backfill` sets `backfilledAt` and arms the silent baseline
	 * evaluation (`docs/customers/tech-design.md` §4.7).
	 */
	readonly finishRun: (
		runId: CustomerSyncRunId,
		result: RunResult,
	) => Effect.Effect<void, DatabaseError, Store>

	/** A human linked an unmatched record: record a `manual` ref and apply its op. */
	readonly link: (
		recordId: CustomerUnmatchedRecordId,
		accountId: CustomerAccountId,
		by: UserId,
	) => Effect.Effect<IngestOutcome, CustomerIngestRejectedError | DatabaseError, Store>

	/** Mark a connection's refs stale (disconnect) or fresh again (reconnect). */
	readonly setStale: (
		connectionId: CustomerConnectionId,
		stale: boolean,
	) => Effect.Effect<void, DatabaseError, Store>
}

export class CustomerIngest extends Context.Service<CustomerIngest, CustomerIngestApi>()(
	"@hazel/backend/CustomerIngest",
) {}
