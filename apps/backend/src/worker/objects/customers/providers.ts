/**
 * The seam the integration PRs (Clerk, Stripe, Autumn, Maple) plug into
 * (`docs/customers/tech-design.md` §5). An adapter talks to its provider and produces
 * `IngestOp`s; it never writes the store. Core registers none: connecting answers
 * `CustomerProviderUnavailableError` until a provider's PR adds its adapter to
 * `CustomerProviders.layer`.
 */
import type { ConnectionConfig, CustomerProvider, IngestOp, SyncProgress } from "@hazel/domain/customers"
import { Context, type Effect, Layer, Option, type Redacted, Schema } from "effect"

/** A provider call failed. `auth` failures mark the connection `error` and stop scheduled pulls. */
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
	/** Verify one webhook delivery (raw body, headers) and parse it. */
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
