/**
 * The failures a provider adapter can answer with. They live apart from `./providers.ts` so that an
 * adapter's own modules (`./clerk/*`) can raise them without importing the registry that imports
 * the adapters — `providers.ts` re-exports both names, so every existing import keeps working.
 */
import { Schema } from "effect"

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
