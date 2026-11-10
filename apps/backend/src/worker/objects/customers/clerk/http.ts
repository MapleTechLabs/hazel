/**
 * One authenticated GET against Clerk's Backend API, decoded, with Clerk's failures mapped onto
 * `CustomerProviderError`:
 *
 * - 401/403 → `auth`: the connection goes to `error` and scheduled pulls stop until the key changes.
 * - 429 → retried in place while Clerk's `Retry-After` is short (a page is cheap to redo and a
 *   failed page restarts the whole sweep), then `rate_limited` carrying `retryAfterMs`, which the
 *   alarm uses as the next pull's delay.
 * - 5xx / unexpected body → `provider`; unreachable → `network`.
 *
 * The key only ever travels in the `Authorization` header, and no message repeats it.
 */
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { CustomerProviderError } from "../provider-errors"

export const CLERK_API_URL = "https://api.clerk.com/v1"

/** Retries inside one page while Clerk asks for no more than this; longer waits go to the alarm. */
export const MAX_INLINE_RETRY_MS = 5_000
export const MAX_INLINE_RETRIES = 2
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

/** Clerk's own explanation of a refusal, when it sent one. */
const detailOf = (response: HttpClientResponse.HttpClientResponse) =>
	response.json.pipe(
		Effect.flatMap(decodeErrors),
		Effect.map((body) => {
			const first = body.errors?.[0]
			return first?.long_message ?? first?.message ?? ""
		}),
		Effect.orElseSucceed(() => ""),
	)

const retryAfterMsOf = (response: HttpClientResponse.HttpClientResponse): number => {
	const seconds = Number(response.headers["retry-after"])
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

const failureOf = (path: ClerkPath, response: HttpClientResponse.HttpClientResponse) =>
	Effect.flatMap(detailOf(response), (detail) => {
		const suffix = detail === "" ? "" : `: ${detail}`
		if (response.status === 401 || response.status === 403) {
			return Effect.fail(
				new CustomerProviderError({
					code: "auth",
					message: `Clerk rejected the secret key (${response.status})${suffix}`,
					httpStatus: response.status,
					retryAfterMs: null,
				}),
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
						? `Clerk failed on GET ${path} (${response.status})`
						: `Clerk refused GET ${path} (${response.status})${suffix}`,
				httpStatus: response.status,
				retryAfterMs: null,
			}),
		)
	})

/** The caller holds the key; `clerkGet` is curried over the client so the adapter binds it once. */
export const makeClerkGet = (client: HttpClient.HttpClient, apiKey: string) => {
	const once = <A>(path: ClerkPath, query: ClerkQuery, schema: Schema.Decoder<A>) =>
		Effect.gen(function* () {
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
			if (response.status < 200 || response.status >= 300) return yield* failureOf(path, response)
			return yield* response.json.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(schema)),
				Effect.mapError(
					() =>
						new CustomerProviderError({
							code: "provider",
							message: `Clerk answered GET ${path} with an unexpected body`,
							httpStatus: response.status,
							retryAfterMs: null,
						}),
				),
			)
		})

	/** A rate-limited page waits out a short `Retry-After` rather than failing the whole sweep. */
	const withRetry = <A>(
		path: ClerkPath,
		query: ClerkQuery,
		schema: Schema.Decoder<A>,
		attempt: number,
	): Effect.Effect<A, CustomerProviderError> =>
		once(path, query, schema).pipe(
			Effect.catchTag("CustomerProviderError", (error) => {
				const wait = error.retryAfterMs ?? 0
				if (
					error.code !== "rate_limited" ||
					attempt >= MAX_INLINE_RETRIES ||
					wait > MAX_INLINE_RETRY_MS
				)
					return Effect.fail(error)
				return Effect.sleep(wait).pipe(
					Effect.andThen(() => withRetry(path, query, schema, attempt + 1)),
				)
			}),
		)

	return <A>(path: ClerkPath, query: ClerkQuery, schema: Schema.Decoder<A>) =>
		withRetry(path, query, schema, 0).pipe(
			Effect.withSpan("Clerk.get", {
				kind: "client",
				attributes: { "peer.service": "clerk", "url.path": path },
			}),
		)
}

export type ClerkGet = ReturnType<typeof makeClerkGet>
