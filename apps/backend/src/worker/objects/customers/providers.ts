/**
 * The seam the integration PRs (Clerk, Stripe, Autumn, Maple) plug into
 * (`docs/customers/tech-design.md` §5). An adapter talks to its provider and produces
 * `IngestOp`s; it never writes the store. Core registers none: connecting answers
 * `CustomerProviderUnavailableError` until a provider's PR adds its adapter to
 * `CustomerProviders.layer`.
 *
 * What an adapter's ops must carry:
 *
 * - `observedAt` on account and contact ops: the record's source-side `updated_at` (or the webhook
 *   event's time), so a late delivery cannot revive a record deleted since.
 * - `matchByDomain: true` on account ops only for billing sources (Stripe, Autumn); identity
 *   sources (Clerk) leave it unset so organizations sharing a domain never merge.
 * - Deletions as `deleted` / `removed` ops; a full listing also sets `PullPage.sweep` on its last
 *   page so records deleted without a webhook are removed.
 * - Links (`externalUrl`, `hostedUrl`) as `https:` URLs on the provider's own hosts; ingest stores
 *   any other as null.
 *
 * Errors are synced: a `CustomerProviderError`'s `message` reaches every member (see there).
 */
import type {
	ConnectionConfig,
	CustomerProvider,
	IngestOp,
	RefEntityType,
	SyncProgress,
} from "@hazel/domain/customers"
import { Context, type Effect, Layer, Option, type Redacted, Schema } from "effect"

/**
 * A provider call failed. `auth` failures mark the connection `error` and stop scheduled pulls.
 * `message` is stored on the run and the connection and synced to every member of the org: it must
 * be client-safe (what went wrong, in words a person can act on), never a raw response body,
 * request URL, header, token or stack.
 */
export class CustomerProviderError extends Schema.TaggedError<CustomerProviderError>()(
	"CustomerProviderError",
	{
		code: Schema.Literals(["auth", "rate_limited", "provider", "network"]),
		message: Schema.String,
		httpStatus: Schema.NullOr(Schema.Int),
		/** For `rate_limited`. */
		retryAfterMs: Schema.NullOr(Schema.Number),
	},
) {}

/** A webhook delivery whose signature or payload does not check out: answered 400, never retried. */
export class CustomerWebhookRejectedError extends Schema.TaggedError<CustomerWebhookRejectedError>()(
	"CustomerWebhookRejectedError",
	{ message: Schema.String },
) {}

export interface ProviderCredentials {
	readonly apiKey: Redacted.Redacted<string>
	readonly webhookSecret: Redacted.Redacted<string> | null
	readonly config: ConnectionConfig
}

export interface PullPage {
	readonly ops: ReadonlyArray<IngestOp>
	/** Null when the pull is complete. */
	readonly nextCursor: string | null
	readonly progress: SyncProgress
	/**
	 * On the last page (`nextCursor` null) of a pull that listed every record of these entity types,
	 * deleted ones excluded: core then removes the ones the run did not see
	 * (`CustomerIngest.completeSweep`). Leave it unset for an incremental or partial pull, or one
	 * whose listing can skip live records: anything not listed is removed.
	 */
	readonly sweep?: ReadonlyArray<RefEntityType>
}

export interface CustomerProviderAdapter {
	readonly provider: CustomerProvider
	/** Check the credentials; the provider account they open. */
	readonly validate: (
		credentials: ProviderCredentials,
	) => Effect.Effect<
		{ readonly externalAccountId: string | null; readonly externalAccountName: string | null },
		CustomerProviderError
	>
	/**
	 * Verify one webhook delivery (raw body, headers) and parse it. Core calls it only with a webhook
	 * secret (`credentials.webhookSecret` is non-null). The adapter must check the signature over the
	 * raw body and refuse a delivery whose signed timestamp is outside a short tolerance (replay
	 * protection), e.g. 5 minutes. `CustomerWebhookRejectedError.message` is answered to the caller
	 * verbatim: keep it client-safe (no secrets, no provider internals).
	 */
	readonly webhook: (
		request: { readonly headers: Readonly<Record<string, string>>; readonly body: string },
		credentials: ProviderCredentials,
	) => Effect.Effect<ReadonlyArray<IngestOp>, CustomerWebhookRejectedError>
	/**
	 * One page of a pull. `since` null: a full backfill; else changes since then (scheduled pulls
	 * overlap the last one by a margin; ingest is idempotent).
	 */
	readonly pull: (input: {
		readonly credentials: ProviderCredentials
		readonly cursor: string | null
		readonly since: Date | null
	}) => Effect.Effect<PullPage, CustomerProviderError>
	/** Scheduled pull period (webhooks cover the rest); e.g. Maple hourly, Stripe daily. */
	readonly pullIntervalMs: number
}

export interface CustomerProvidersApi {
	readonly get: (provider: CustomerProvider) => Option.Option<CustomerProviderAdapter>
}

export class CustomerProviders extends Context.Service<CustomerProviders, CustomerProvidersApi>()(
	"@hazel/backend/CustomerProviders",
) {
	/** The registered adapters. Provider PRs add theirs here. */
	static readonly layer = Layer.succeed(this, CustomerProviders.of({ get: () => Option.none() }))
}
