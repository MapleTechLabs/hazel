/**
 * One authenticated GET against Stripe's API, decoded, with Stripe's failures mapped onto
 * `CustomerProviderError`:
 *
 * - 401/403 → `auth`: a rejected key, or a restricted key without one of the read permissions
 *   Hazel needs. The connection goes to `error` and scheduled pulls stop until the key changes.
 *   The message carries Stripe's own explanation ("does not have the required permissions…"),
 *   truncated, with the masked key Stripe quotes in it removed.
 * - 429 → for a pull, retried in place while the wait is short (cheaper than a whole alarm round
 *   trip), then `rate_limited` carrying the delay. Core keeps the run open at its cursor and resumes
 *   it after. A webhook's requests are never retried in place.
 * - 5xx → `provider`; unreachable, or no answer within the request's timeout (30 s on a pull, 5 s on
 *   the webhook path, which must answer Stripe) → `network`. Both retryable: the run resumes after
 *   core's backoff.
 * - Any other 4xx (a `starting_after` id Stripe no longer knows, say) → `provider`, not retryable:
 *   the same request would be refused again, so the run fails and the next one starts over.
 * - A body Hazel cannot read (Stripe changed its API) → `provider`, not retryable: the run fails
 *   with a message saying so rather than retrying the same page forever. Only the decode's path and
 *   issue kind are logged, never the payload, which is customers' data.
 *
 * Messages reach every member of the organization (`CustomerProviderError`), so beyond a refused
 * key's they carry only the route and status, never Stripe's text. Every request pins
 * `Stripe-Version` ({@link STRIPE_API_VERSION}); the key stays `Redacted` up to the `Authorization`
 * header, and no message or span repeats it.
 */
import { Effect, Redacted, Result, Schema, type SchemaIssue } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { STRIPE_API_VERSION } from "./wire"

export const STRIPE_API_URL = "https://api.stripe.com/v1"

/** Retries inside one page while the wait is no longer than this; longer ones go to the alarm. */
const MAX_INLINE_RETRY_MS = 5_000
const MAX_INLINE_RETRIES = 2
/** Stripe's 429s carry no `Retry-After` of their own as a rule; assume a second. */
const DEFAULT_RETRY_AFTER_MS = 1_000

/** How one GET behaves: 429s waited out in place, and how long one attempt may take. */
interface StripeGetOptions {
	readonly inlineRetries: number
	readonly timeoutMs: number
}

const PULL_REQUESTS: StripeGetOptions = { inlineRetries: MAX_INLINE_RETRIES, timeoutMs: 30_000 }

/** A delivery answers fast: no 429 waited out in place, and a short timeout. */
export const WEBHOOK_REQUESTS: StripeGetOptions = { inlineRetries: 0, timeoutMs: 5_000 }

/** The read endpoints this integration may call. */
type StripePath =
	| "/account"
	| "/customers"
	| "/products"
	| "/subscriptions"
	| "/invoices"
	| `/products/${string}`

export type StripeQuery = ReadonlyArray<readonly [string, string]>

/** The route a path belongs to, for messages, logs and spans: never an object id. */
const routeOf = (path: StripePath): string => (path.startsWith("/products/") ? "/products/{id}" : path)

const issuePaths = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey>): Array<string> => {
	switch (issue._tag) {
		case "Pointer":
			return issuePaths(issue.issue, [...path, ...issue.path])
		case "Composite":
		case "AnyOf":
			return issue.issues.flatMap((inner) => issuePaths(inner, path))
		case "Filter":
		case "Encoding":
			return issuePaths(issue.issue, path)
		default:
			return [`${path.length === 0 ? "(root)" : path.map(String).join(".")}: ${issue._tag}`]
	}
}

/** Where a decode failed, as `path: issue kind`: never the values, which are customers' data. */
export const issueSummary = (error: Schema.SchemaError): string =>
	issuePaths(error.issue, []).slice(0, 5).join("; ")

const StripeErrorBody = Schema.Struct({
	error: Schema.optionalKey(
		Schema.Struct({
			message: Schema.optionalKey(Schema.String),
			code: Schema.optionalKey(Schema.String),
			type: Schema.optionalKey(Schema.String),
		}),
	),
})

const decodeErrorBody = Schema.decodeUnknownEffect(StripeErrorBody)

/** Stripe's explanation of a refused key is at most this long in a message. */
const MAX_DETAIL_LENGTH = 200

/** A key as Stripe quotes it in a refusal (masked, `'rk_live_****…1234'`): never repeated. */
const QUOTED_KEY = /'?\b[a-z]{2}_(?:live|test)_[^\s']*'?/g

/** Stripe's own explanation of a refused key, when it sent one: the key removed, truncated. */
const detailOf = (response: HttpClientResponse.HttpClientResponse) =>
	response.json.pipe(
		Effect.flatMap(decodeErrorBody),
		Effect.map((body) => {
			const detail = (body.error?.message ?? "").replace(QUOTED_KEY, "").replace(/\s+/g, " ").trim()
			return detail.length > MAX_DETAIL_LENGTH ? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` : detail
		}),
		Effect.orElseSucceed(() => ""),
	)

const retryAfterMsOf = (response: HttpClientResponse.HttpClientResponse): number => {
	const seconds = Number(response.headers["retry-after"])
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

const failureOf = (route: string, response: HttpClientResponse.HttpClientResponse) => {
	if (response.status === 401 || response.status === 403) {
		return Effect.flatMap(detailOf(response), (detail) =>
			Effect.fail(
				new CustomerProviderError({
					code: "auth",
					message: `${
						response.status === 401
							? "Stripe rejected the API key (401)"
							: `Stripe refused GET ${route} for this key (403)`
					}${detail === "" ? "" : `: ${detail}`}`,
					httpStatus: response.status,
					retryAfterMs: null,
				}),
			),
		)
	}
	if (response.status === 429) {
		return Effect.fail(
			new CustomerProviderError({
				code: "rate_limited",
				message: "Stripe's rate limit for this account is reached",
				httpStatus: 429,
				retryAfterMs: retryAfterMsOf(response),
			}),
		)
	}
	return Effect.fail(
		response.status >= 500
			? new CustomerProviderError({
					code: "provider",
					message: `Stripe failed on GET ${route} (${response.status})`,
					httpStatus: response.status,
					retryAfterMs: null,
				})
			: new CustomerProviderError({
					code: "provider",
					message: `Stripe refused GET ${route} (${response.status})`,
					httpStatus: response.status,
					retryAfterMs: null,
					retryable: false,
				}),
	)
}

/** A body Hazel cannot read: logged by path and kind only, and not retried. */
const unreadable = (route: string, status: number, detail: string) =>
	Effect.logWarning("Stripe answered with a body Hazel cannot read", { route, status, detail }).pipe(
		Effect.andThen(
			Effect.fail(
				new CustomerProviderError({
					code: "provider",
					message: `Stripe answered GET ${route} with a body Hazel cannot read (has Stripe's API changed?)`,
					httpStatus: status,
					retryAfterMs: null,
					retryable: false,
				}),
			),
		),
	)

/** The caller holds the key; `stripeGet` is curried over the client so the adapter binds it once. */
export const makeStripeGet = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	{ inlineRetries, timeoutMs }: StripeGetOptions = PULL_REQUESTS,
) => {
	/** One request: its JSON body, or the failure Stripe's answer maps to. */
	const once = Effect.fn("Stripe.request")(function* (path: StripePath, query: StripeQuery) {
		const route = routeOf(path)
		const request = HttpClientRequest.get(`${STRIPE_API_URL}${path}`, { urlParams: query }).pipe(
			HttpClientRequest.bearerToken(apiKey),
			HttpClientRequest.setHeader("Stripe-Version", STRIPE_API_VERSION),
			HttpClientRequest.acceptJson,
		)
		const response = yield* client.execute(request).pipe(
			Effect.mapError(
				(error) =>
					new CustomerProviderError({
						code: "network",
						message: `Could not reach Stripe (${error.reason._tag})`,
						httpStatus: null,
						retryAfterMs: null,
					}),
			),
		)
		yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
		if (response.status < 200 || response.status >= 300) return yield* failureOf(route, response)
		const body = yield* response.json.pipe(
			Effect.catchTag("HttpClientError", () => unreadable(route, response.status, "not JSON")),
		)
		return { status: response.status, body }
	})

	/** One GET's JSON body; a rate-limited request waits out a short delay in place. */
	const withRetry = Effect.fn("Stripe.get", { kind: "client" })(function* (
		path: StripePath,
		query: StripeQuery,
	) {
		yield* Effect.annotateCurrentSpan({ "peer.service": "stripe", "url.template": routeOf(path) })
		for (let retries = 0; ; retries++) {
			const result = yield* Effect.result(
				once(path, query).pipe(
					Effect.timeoutOrElse({
						duration: timeoutMs,
						orElse: () =>
							Effect.fail(
								new CustomerProviderError({
									code: "network",
									message: `Stripe did not answer GET ${routeOf(path)} within ${timeoutMs / 1000} s`,
									httpStatus: null,
									retryAfterMs: null,
								}),
							),
					}),
				),
			)
			if (Result.isSuccess(result)) {
				yield* Effect.annotateCurrentSpan("stripe.retries", retries)
				return result.success
			}
			const error = result.failure
			const wait = error.retryAfterMs ?? 0
			if (error.code !== "rate_limited" || retries >= inlineRetries || wait > MAX_INLINE_RETRY_MS) {
				yield* Effect.annotateCurrentSpan("stripe.retries", retries)
				return yield* error
			}
			yield* Effect.sleep(wait)
		}
	})

	return <A>(path: StripePath, query: StripeQuery, schema: Schema.Decoder<A>) =>
		withRetry(path, query).pipe(
			Effect.flatMap(({ status, body }) =>
				Schema.decodeUnknownEffect(schema)(body).pipe(
					Effect.catchTag("SchemaError", (error) =>
						unreadable(routeOf(path), status, issueSummary(error)),
					),
				),
			),
		)
}

export type StripeGet = ReturnType<typeof makeStripeGet>
