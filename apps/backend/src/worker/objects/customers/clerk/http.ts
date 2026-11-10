/**
 * One authenticated GET against Clerk's Backend API, decoded, with Clerk's failures mapped onto
 * `CustomerProviderError`:
 *
 * - 401/403 → `auth`: the connection goes to `error` and scheduled pulls stop until the key changes.
 *   The message carries Clerk's own explanation (truncated): it says what is wrong with the key.
 * - 429 → for a pull, retried in place while Clerk's `Retry-After` is short (cheaper than a whole
 *   alarm round trip), then `rate_limited` carrying `retryAfterMs`. Core keeps the run open at its
 *   cursor and resumes it after that delay. A webhook's requests are never retried in place.
 * - 5xx → `provider`; unreachable → `network`. Both retryable: the run resumes after core's backoff.
 * - A body Hazel cannot read (Clerk changed its API) → `provider`, not retryable: the run fails with
 *   a message saying so rather than retrying the same page forever.
 *
 * Messages reach every member of the organization (`CustomerProviderError`), so beyond a refused
 * key's they carry only the route and status, never Clerk's text. The key stays `Redacted` up to the
 * `Authorization` header, and no message or span repeats it.
 */
import { Effect, Redacted, Result, Schema, type SchemaIssue } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { CustomerProviderError } from "../provider-errors"

export const CLERK_API_URL = "https://api.clerk.com/v1"

/** Retries inside one page while Clerk asks for no more than this; longer waits go to the alarm. */
const MAX_INLINE_RETRY_MS = 5_000
const MAX_INLINE_RETRIES = 2
/** `Retry-After` is optional on a 429; assume a second. */
const DEFAULT_RETRY_AFTER_MS = 1_000

/** The read endpoints this integration may call. */
export type ClerkPath =
	| "/instance"
	| "/organizations"
	| "/organization_memberships"
	| "/organization_domains"
	| "/users"
	| `/users/${string}/organization_memberships`

export type ClerkQuery = ReadonlyArray<readonly [string, string]>

/** The path's route template, for messages, logs and spans: a user's path keeps no user id. */
const routeOf = (path: ClerkPath): string =>
	path.startsWith("/users/") ? "/users/{user_id}/organization_memberships" : path

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

const decodeErrors = Schema.decodeUnknownEffect(ClerkErrors)

/** Clerk's explanation of a refused key is at most this long in a message. */
const MAX_DETAIL_LENGTH = 200

/** Clerk's own explanation of a refusal, when it sent one, truncated. */
const detailOf = (response: HttpClientResponse.HttpClientResponse) =>
	response.json.pipe(
		Effect.flatMap(decodeErrors),
		Effect.map((body) => {
			const first = body.errors?.[0]
			const detail = first?.long_message ?? first?.message ?? ""
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
					message: `Clerk rejected the secret key (${response.status})${detail === "" ? "" : `: ${detail}`}`,
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
				message: "Clerk's rate limit for this instance is reached",
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
					? `Clerk failed on GET ${route} (${response.status})`
					: `Clerk refused GET ${route} (${response.status})`,
			httpStatus: response.status,
			retryAfterMs: null,
		}),
	)
}

/** A body Hazel cannot read: logged by path and kind only, and not retried. */
const unreadable = (route: string, status: number, detail: string) =>
	Effect.logWarning("Clerk answered with a body Hazel cannot read", { route, status, detail }).pipe(
		Effect.andThen(
			Effect.fail(
				new CustomerProviderError({
					code: "provider",
					message: `Clerk answered GET ${route} with a body Hazel cannot read (has Clerk's API changed?)`,
					httpStatus: status,
					retryAfterMs: null,
					retryable: false,
				}),
			),
		),
	)

/**
 * The caller holds the key; `clerkGet` is curried over the client so the adapter binds it once.
 * `inlineRetries`: how many 429s one GET waits out in place (none on the webhook path).
 */
export const makeClerkGet = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	inlineRetries = MAX_INLINE_RETRIES,
) => {
	/** One request: its JSON body, or the failure Clerk's answer maps to. */
	const once = Effect.fn("Clerk.request")(function* (path: ClerkPath, query: ClerkQuery) {
		const route = routeOf(path)
		const request = HttpClientRequest.get(`${CLERK_API_URL}${path}`, { urlParams: query }).pipe(
			HttpClientRequest.bearerToken(apiKey),
			HttpClientRequest.acceptJson,
		)
		const response = yield* client.execute(request).pipe(
			Effect.mapError(
				(error) =>
					new CustomerProviderError({
						code: "network",
						message: `Could not reach Clerk (${error.reason._tag})`,
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

	/** One GET's JSON body; a rate-limited request waits out a short `Retry-After` in place. */
	const withRetry = Effect.fn("Clerk.get")(function* (path: ClerkPath, query: ClerkQuery) {
		yield* Effect.annotateCurrentSpan({ "peer.service": "clerk", "url.template": routeOf(path) })
		for (let retries = 0; ; retries++) {
			const result = yield* Effect.result(once(path, query))
			if (Result.isSuccess(result)) {
				yield* Effect.annotateCurrentSpan("clerk.retries", retries)
				return result.success
			}
			const error = result.failure
			const wait = error.retryAfterMs ?? 0
			if (error.code !== "rate_limited" || retries >= inlineRetries || wait > MAX_INLINE_RETRY_MS) {
				yield* Effect.annotateCurrentSpan("clerk.retries", retries)
				return yield* error
			}
			yield* Effect.sleep(wait)
		}
	})

	return <A>(path: ClerkPath, query: ClerkQuery, schema: Schema.Decoder<A>) =>
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

export type ClerkGet = ReturnType<typeof makeClerkGet>
