/**
 * One authenticated read against Autumn's API, decoded, with Autumn's failures mapped onto
 * `CustomerProviderError` (`../provider-http.ts` does the mapping):
 *
 * - 401/403 → `auth`: a rejected or revoked secret key, or one whose scopes do not cover the route.
 *   The connection goes to `error` and scheduled pulls stop until the key changes. The message
 *   carries Autumn's own explanation (its error body is `{ message, code, env }`), truncated.
 * - 429 → for a pull, retried in place while the wait is short, then `rate_limited`.
 * - 5xx → `provider`; unreachable or too slow → `network`. Both retryable.
 * - Any other 4xx (a cursor Autumn no longer accepts, a customer it does not know) → `provider`,
 *   not retryable.
 * - A body Hazel cannot read (Autumn changed its API) → `provider`, not retryable.
 *
 * Autumn's API is RPC-shaped: the reads are `POST /v1/<resource>.<verb>` with a JSON body, apart
 * from the two organization routes, which are GETs. Every request pins `x-api-version`
 * ({@link AUTUMN_API_VERSION}) — without it Autumn answers in the version implied by the
 * organization's creation date.
 */
import { type Redacted, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { makeProviderGet, makeProviderPost, type ProviderRequestOptions } from "../provider-http"
import { AUTUMN_API_VERSION } from "./wire"

export const AUTUMN_API_URL = "https://api.useautumn.com"

/** The read endpoints this integration may call; none of them carries a record id in its path. */
type AutumnPath =
	| "/v1/organization"
	| "/v1/organization/me"
	| "/v1/customers.list"
	| "/v1/customers.get"
	| "/v1/subscriptions.list"
	| "/v1/plans.list"
	| "/v1/features.list"
	| "/v1/events.aggregate"

const AutumnErrorBody = Schema.Struct({
	message: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(Schema.String),
})

/** A key as a message might quote it: never repeated back to the organization. */
const QUOTED_KEY = /'?\bam_sk_[^\s']*'?/g

const AUTUMN = {
	name: "Autumn",
	baseUrl: AUTUMN_API_URL,
	// Autumn's routes are static; the record being read is in the body, never the path.
	routeOf: (path: AutumnPath) => path,
	headers: { "x-api-version": AUTUMN_API_VERSION },
	refusal: AutumnErrorBody,
	detailOf: ({ message }: typeof AutumnErrorBody.Type) =>
		(message ?? "").replace(QUOTED_KEY, "").replace(/\s+/g, " ").trim(),
	refusedMessage: (route: string, status: number, method: string) =>
		status === 401
			? "Autumn rejected the secret key (401)"
			: `Autumn refused ${method} ${route} for this key (403)`,
	rateLimitedMessage: "Autumn's rate limit for this organization is reached",
}

/** Both verbs bound to one key, which is what every module below the adapter takes. */
export const makeAutumnApi = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	options?: ProviderRequestOptions,
) => ({
	get: makeProviderGet(AUTUMN, client, apiKey, options),
	post: makeProviderPost(AUTUMN, client, apiKey, options),
})

export type AutumnApi = ReturnType<typeof makeAutumnApi>
