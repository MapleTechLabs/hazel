/**
 * One authenticated GET against Stripe's API, decoded, with Stripe's failures mapped onto
 * `CustomerProviderError` (`../provider-http.ts` does the mapping):
 *
 * - 401/403 → `auth`: a rejected key, or a restricted key without one of the read permissions
 *   Hazel needs. The connection goes to `error` and scheduled pulls stop until the key changes.
 *   The message carries Stripe's own explanation ("does not have the required permissions…"),
 *   truncated, with the masked key Stripe quotes in it removed.
 * - 429 → for a pull, retried in place while the wait is short, then `rate_limited`.
 * - 5xx → `provider`; unreachable or too slow → `network`. Both retryable.
 * - 404 (an object of another account, or gone) and any other 4xx → `provider`, not retryable.
 * - A body Hazel cannot read (Stripe changed its API) → `provider`, not retryable.
 *
 * Every request pins `Stripe-Version` ({@link STRIPE_API_VERSION}).
 */
import { type Redacted, Schema } from "effect"
import type { HttpClient } from "effect/http"
import { makeProviderGet, type ProviderRequestOptions, type ProviderQuery } from "../provider-http"
import { STRIPE_API_VERSION } from "./wire"

export const STRIPE_API_URL = "https://api.stripe.com/v1"

/** The read endpoints this integration may call. */
type StripePath =
	| "/account"
	| "/customers"
	| "/products"
	| "/subscriptions"
	| "/invoices"
	| "/events"
	| `/customers/${string}`
	| `/subscriptions/${string}`
	| `/invoices/${string}`

export type StripeQuery = ProviderQuery

/** `/customers/cus_…` → `/customers/{id}`: a route never carries an object id. */
const routeOf = (path: StripePath): string => path.replace(/^(\/[a-z_]+)\/[^/]+$/, "$1/{id}")

const StripeErrorBody = Schema.Struct({
	error: Schema.optionalKey(Schema.Struct({ message: Schema.optionalKey(Schema.String) })),
})

/** A key as Stripe quotes it in a refusal (masked, `'rk_live_****…1234'`): never repeated. */
const QUOTED_KEY = /'?\b[a-z]{2}_(?:live|test)_[^\s']*'?/g

const STRIPE = {
	name: "Stripe",
	baseUrl: STRIPE_API_URL,
	routeOf,
	headers: { "Stripe-Version": STRIPE_API_VERSION },
	refusal: StripeErrorBody,
	detailOf: ({ error }: typeof StripeErrorBody.Type) =>
		(error?.message ?? "").replace(QUOTED_KEY, "").replace(/\s+/g, " ").trim(),
	refusedMessage: (route: string, status: number) =>
		status === 401
			? "Stripe rejected the API key (401)"
			: `Stripe refused GET ${route} for this key (403)`,
	rateLimitedMessage: "Stripe's rate limit for this account is reached",
}

/** The caller holds the key; `stripeGet` is curried over the client so the adapter binds it once. */
export const makeStripeGet = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	options?: ProviderRequestOptions,
) => makeProviderGet(STRIPE, client, apiKey, options)

export type StripeGet = ReturnType<typeof makeStripeGet>
