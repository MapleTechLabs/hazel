/**
 * One authenticated GET against Stripe's API, decoded, with Stripe's failures mapped onto
 * `CustomerProviderError`:
 *
 * - 401/403 → `auth`: a rejected key, or a restricted key without one of the read permissions
 *   Hazel needs. The connection goes to `error` and scheduled pulls stop until the key changes;
 *   Stripe's own explanation ("does not have the required permissions…") reaches the UI.
 * - 429 → retried in place while the wait is short (cheaper than a whole alarm round trip), then
 *   `rate_limited` carrying the delay. Core keeps the run open at its cursor and resumes it after.
 * - 5xx → `provider`; unreachable → `network`. Both retryable: the run resumes after core's backoff.
 * - A body Hazel cannot read (Stripe changed its API) → `provider`, not retryable: the run fails
 *   with a message saying so rather than retrying the same page forever. Only the decode's path and
 *   issue kind are logged, never the payload, which is customers' data.
 *
 * Every request pins `Stripe-Version` ({@link STRIPE_API_VERSION}); the key stays `Redacted` up to
 * the `Authorization` header, and no message or span repeats it.
 */
import { Effect, Redacted, Result, Schema, type SchemaIssue } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { STRIPE_API_VERSION } from "./wire"

export const STRIPE_API_URL = "https://api.stripe.com/v1"

/** Retries inside one page while the wait is no longer than this; longer ones go to the alarm. */
export const MAX_INLINE_RETRY_MS = 5_000
export const MAX_INLINE_RETRIES = 2
/** Stripe's 429s carry no `Retry-After` of their own as a rule; assume a second. */
const DEFAULT_RETRY_AFTER_MS = 1_000

/** The read endpoints this integration may call. */
export type StripePath =
	| "/account"
	| "/customers"
	| "/products"
	| "/subscriptions"
	| "/invoices"
	| `/products/${string}`

export type StripeQuery = ReadonlyArray<readonly [string, string]>

/** The route a path belongs to, for messages, logs and spans: never an object id. */
export const routeOf = (path: StripePath): string => (path.startsWith("/products/") ? "/products/{id}" : path)

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

/** Stripe's own explanation of a refusal, when it sent one. */
const detailOf = (response: HttpClientResponse.HttpClientResponse) =>
	response.json.pipe(
		Effect.flatMap(decodeErrorBody),
		Effect.map((body) => body.error?.message ?? ""),
		Effect.orElseSucceed(() => ""),
	)

const retryAfterMsOf = (response: HttpClientResponse.HttpClientResponse): number => {
	const seconds = Number(response.headers["retry-after"])
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

const failureOf = (route: string, response: HttpClientResponse.HttpClientResponse) =>
	Effect.flatMap(detailOf(response), (detail) => {
		const suffix = detail === "" ? "" : `: ${detail}`
		if (response.status === 401 || response.status === 403) {
			return Effect.fail(
				new CustomerProviderError({
					code: "auth",
					message:
						response.status === 401
							? `Stripe rejected the API key (401)${suffix}`
							: `Stripe refused GET ${route} for this key (403)${suffix}`,
					httpStatus: response.status,
					retryAfterMs: null,
				}),
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
			new CustomerProviderError({
				code: "provider",
				message:
					response.status >= 500
						? `Stripe failed on GET ${route} (${response.status})`
						: `Stripe refused GET ${route} (${response.status})${suffix}`,
				httpStatus: response.status,
				retryAfterMs: null,
			}),
		)
	})

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
export const makeStripeGet = (client: HttpClient.HttpClient, apiKey: Redacted.Redacted<string>) => {
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
			const result = yield* Effect.result(once(path, query))
			if (Result.isSuccess(result)) {
				yield* Effect.annotateCurrentSpan("stripe.retries", retries)
				return result.success
			}
			const error = result.failure
			const wait = error.retryAfterMs ?? 0
			if (
				error.code !== "rate_limited" ||
				retries >= MAX_INLINE_RETRIES ||
				wait > MAX_INLINE_RETRY_MS
			) {
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
