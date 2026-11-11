/**
 * One authenticated GET against Clerk's Backend API, decoded, with Clerk's failures mapped onto
 * `CustomerProviderError` (`../provider-http.ts` does the mapping):
 *
 * - 401/403 → `auth`: the connection goes to `error` and scheduled pulls stop until the key changes.
 *   The message carries Clerk's own explanation (truncated): it says what is wrong with the key.
 * - 429 → for a pull, retried in place while Clerk's `Retry-After` is short (cheaper than a whole
 *   alarm round trip), then `rate_limited` carrying `retryAfterMs`. Core keeps the run open at its
 *   cursor and resumes it after that delay. A webhook's requests are never retried in place.
 * - 5xx → `provider`; unreachable, or no answer within the request's timeout (30 s on a pull, 5 s
 *   on the webhook path, which must answer Svix) → `network`. Both retryable: the run resumes after
 *   core's backoff.
 * - Any other 4xx (a cursor Clerk no longer accepts, say) → `provider`, not retryable: the same
 *   request would be refused again, so the run fails and the next one starts over.
 * - A body Hazel cannot read (Clerk changed its API) → `provider`, not retryable: the run fails with
 *   a message saying so rather than retrying the same page forever.
 *
 * Messages reach every member of the organization (`CustomerProviderError`), so beyond a refused
 * key's they carry only the route and status, never Clerk's text. The key stays `Redacted` up to the
 * `Authorization` header, and no message or span repeats it.
 */
import { type Redacted, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { makeProviderGet, type ProviderRequestOptions } from "../provider-http"

export const CLERK_API_URL = "https://api.clerk.com/v1"

/** The read endpoints this integration may call. */
export type ClerkPath =
	| "/instance"
	| "/organizations"
	| "/organization_memberships"
	| "/organization_domains"
	| "/users"
	| `/users/${string}/organization_memberships`

const ClerkErrors = Schema.Struct({
	errors: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				message: Schema.optionalKey(Schema.String),
				long_message: Schema.optionalKey(Schema.String),
			}),
		),
	),
})

const CLERK = {
	name: "Clerk",
	baseUrl: CLERK_API_URL,
	// A user's path keeps no user id.
	routeOf: (path: ClerkPath) =>
		path.startsWith("/users/") ? "/users/{user_id}/organization_memberships" : path,
	refusal: ClerkErrors,
	detailOf: ({ errors }: typeof ClerkErrors.Type) =>
		errors?.[0]?.long_message ?? errors?.[0]?.message ?? "",
	refusedMessage: (_route: string, status: number) => `Clerk rejected the secret key (${status})`,
	rateLimitedMessage: "Clerk's rate limit for this instance is reached",
}

/** The caller holds the key; `clerkGet` is curried over the client so the adapter binds it once. */
export const makeClerkGet = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	options?: ProviderRequestOptions,
) => makeProviderGet(CLERK, client, apiKey, options)

export type ClerkGet = ReturnType<typeof makeClerkGet>
