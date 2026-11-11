/**
 * One authenticated request against a provider's REST API — a GET (Clerk, Stripe) or, for an
 * RPC-shaped API, a POST with a JSON body (Autumn) — decoded, with the provider's failures mapped
 * onto `CustomerProviderError`:
 *
 * - 401/403 → `auth`: the connection goes to `error` and scheduled pulls stop until the key changes.
 *   The message carries the provider's own explanation (`detailOf`, truncated).
 * - 429 → for a pull, retried in place while `Retry-After` is short (cheaper than a whole alarm
 *   round trip), then `rate_limited` carrying the delay. Core keeps the run open at its cursor and
 *   resumes it after. A webhook's requests are never retried in place. Only reads come through
 *   here, so retrying a POST is as safe as retrying a GET.
 * - 5xx → `provider`; unreachable, or no answer within the request's timeout (30 s on a pull, 5 s on
 *   the webhook path, which must answer the provider) → `network`. Both retryable: the run resumes
 *   after core's backoff.
 * - Any other 4xx (a cursor the provider no longer accepts, an object it does not know) →
 *   `provider`, not retryable: the same request would be refused again.
 * - A body Hazel cannot read (the provider changed its API) → `provider`, not retryable: the run
 *   fails with a message saying so rather than retrying the same page forever. Only the decode's
 *   path and issue kind are logged, never the payload, which is customers' data.
 *
 * Messages reach every member of the organization (`CustomerProviderError`), so beyond a refused
 * key's they carry only the route and status, never the provider's text. The key stays `Redacted`
 * up to the `Authorization` header, and no message or span repeats it. A request body is never
 * logged either: it names the records being read. The HTTP client makes the client span;
 * `<Name>.get` / `<Name>.post` is the logical call around its retries.
 */
import { Effect, type Redacted, Result, Schema, type SchemaIssue } from "effect"
import { type HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http"
import { CustomerProviderError } from "./provider-errors"

/** Retries inside one request while the provider asks for no more than this; longer waits go to the alarm. */
const MAX_INLINE_RETRY_MS = 5_000
/** `Retry-After` is optional on a 429; assume a second. */
const DEFAULT_RETRY_AFTER_MS = 1_000
/** The provider's explanation of a refused key is at most this long in a message. */
const MAX_DETAIL_LENGTH = 200

/** How one request behaves: 429s waited out in place, and how long one attempt may take. */
export interface ProviderRequestOptions {
	readonly inlineRetries: number
	readonly timeoutMs: number
}

const PULL_REQUESTS: ProviderRequestOptions = { inlineRetries: 2, timeoutMs: 30_000 }

/** A delivery answers fast: no 429 waited out in place, and a short timeout. */
export const WEBHOOK_REQUESTS: ProviderRequestOptions = { inlineRetries: 0, timeoutMs: 5_000 }

export type ProviderQuery = ReadonlyArray<readonly [string, string]>

/** The read verbs these integrations use: a REST GET, or an RPC-style POST whose body is the query. */
export type ProviderMethod = "GET" | "POST"

/** One read: where, with which query, and (for a POST) the JSON body naming what to read. */
interface ProviderCall<Path extends string> {
	readonly method: ProviderMethod
	readonly path: Path
	readonly query?: ProviderQuery
	/** Sent as the JSON body of a POST; ignored on a GET. */
	readonly body?: unknown
}

interface ProviderApi<Path extends string, Refusal> {
	/** As messages and spans name it, e.g. `Stripe`. */
	readonly name: string
	readonly baseUrl: string
	/** The path's route template, for messages, logs and spans: never an object id. */
	readonly routeOf: (path: Path) => string
	/** Sent with every request besides the key (Stripe's version pin); overrides `accept`. */
	readonly headers?: Readonly<Record<string, string>>
	/** The provider's error body; one that does not decode explains nothing. */
	readonly refusal: Schema.Decoder<Refusal>
	/** The provider's explanation of a refusal; `""` when there is none. */
	readonly detailOf: (refusal: Refusal) => string
	/** What a 401/403 says before the provider's explanation. */
	readonly refusedMessage: (route: string, status: number, method: ProviderMethod) => string
	readonly rateLimitedMessage: string
}

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

const retryAfterMsOf = (response: HttpClientResponse.HttpClientResponse): number => {
	const seconds = Number(response.headers["retry-after"])
	return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
}

/**
 * The caller holds the key; the result is curried over the client so an adapter binds it once.
 * `makeProviderGet` (Clerk, Stripe) and `makeProviderPost` (Autumn) are the two shapes adapters use.
 */
const makeProviderCall = <Path extends string, Refusal>(
	api: ProviderApi<Path, Refusal>,
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	{ inlineRetries, timeoutMs }: ProviderRequestOptions = PULL_REQUESTS,
) => {
	const service = api.name.toLowerCase()

	const detailOf = (response: HttpClientResponse.HttpClientResponse) =>
		response.json.pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(api.refusal)),
			Effect.map((refusal) => {
				const detail = api.detailOf(refusal)
				return detail.length > MAX_DETAIL_LENGTH
					? `${detail.slice(0, MAX_DETAIL_LENGTH - 1)}…`
					: detail
			}),
			Effect.orElseSucceed(() => ""),
		)

	const failureOf = (
		method: ProviderMethod,
		route: string,
		response: HttpClientResponse.HttpClientResponse,
	) => {
		if (response.status === 401 || response.status === 403) {
			return Effect.flatMap(detailOf(response), (detail) =>
				Effect.fail(
					new CustomerProviderError({
						code: "auth",
						message: `${api.refusedMessage(route, response.status, method)}${detail === "" ? "" : `: ${detail}`}`,
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
					message: api.rateLimitedMessage,
					httpStatus: 429,
					retryAfterMs: retryAfterMsOf(response),
				}),
			)
		}
		return Effect.fail(
			response.status >= 500
				? new CustomerProviderError({
						code: "provider",
						message: `${api.name} failed on ${method} ${route} (${response.status})`,
						httpStatus: response.status,
						retryAfterMs: null,
					})
				: new CustomerProviderError({
						code: "provider",
						message: `${api.name} refused ${method} ${route} (${response.status})`,
						httpStatus: response.status,
						retryAfterMs: null,
						retryable: false,
					}),
		)
	}

	/** A body Hazel cannot read: logged by path and kind only, and not retried. */
	const unreadable = (method: ProviderMethod, route: string, status: number, detail: string) =>
		Effect.logWarning(`${api.name} answered with a body Hazel cannot read`, {
			method,
			route,
			status,
			detail,
		}).pipe(
			Effect.andThen(
				Effect.fail(
					new CustomerProviderError({
						code: "provider",
						message: `${api.name} answered ${method} ${route} with a body Hazel cannot read (has ${api.name}'s API changed?)`,
						httpStatus: status,
						retryAfterMs: null,
						retryable: false,
					}),
				),
			),
		)

	/** One request: its JSON body, or the failure the provider's answer maps to. */
	const once = Effect.fn(`${api.name}.request`)(function* (call: ProviderCall<Path>) {
		const route = api.routeOf(call.path)
		const url = `${api.baseUrl}${call.path}`
		const urlParams = call.query ?? []
		const request = (
			call.method === "GET"
				? HttpClientRequest.get(url, { urlParams })
				: HttpClientRequest.post(url, { urlParams }).pipe(
						HttpClientRequest.bodyJsonUnsafe(call.body ?? {}),
					)
		).pipe(
			HttpClientRequest.bearerToken(apiKey),
			HttpClientRequest.acceptJson,
			// Last, so a provider's own headers win: Maple's MCP endpoint answers 406 unless `accept`
			// offers `text/event-stream` beside JSON.
			HttpClientRequest.setHeaders(api.headers ?? {}),
		)
		const response = yield* client.execute(request).pipe(
			Effect.mapError(
				(error) =>
					new CustomerProviderError({
						code: "network",
						message: `Could not reach ${api.name} (${error.reason._tag})`,
						httpStatus: null,
						retryAfterMs: null,
					}),
			),
		)
		yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
		if (response.status < 200 || response.status >= 300) {
			return yield* failureOf(call.method, route, response)
		}
		const body = yield* response.json.pipe(
			Effect.catchTag("HttpClientError", () =>
				unreadable(call.method, route, response.status, "not JSON"),
			),
		)
		return { status: response.status, body }
	})

	/** One call's JSON body; a rate-limited request waits out a short `Retry-After` in place. */
	const attempt = function* (call: ProviderCall<Path>) {
		const route = api.routeOf(call.path)
		yield* Effect.annotateCurrentSpan({ "peer.service": service, "url.template": route })
		for (let retries = 0; ; retries++) {
			const result = yield* Effect.result(
				once(call).pipe(
					Effect.timeoutOrElse({
						duration: timeoutMs,
						orElse: () =>
							Effect.fail(
								new CustomerProviderError({
									code: "network",
									message: `${api.name} did not answer ${call.method} ${route} within ${timeoutMs / 1000} s`,
									httpStatus: null,
									retryAfterMs: null,
								}),
							),
					}),
				),
			)
			if (Result.isSuccess(result)) {
				yield* Effect.annotateCurrentSpan(`${service}.retries`, retries)
				return result.success
			}
			const error = result.failure
			const wait = error.retryAfterMs ?? 0
			if (error.code !== "rate_limited" || retries >= inlineRetries || wait > MAX_INLINE_RETRY_MS) {
				yield* Effect.annotateCurrentSpan(`${service}.retries`, retries)
				return yield* error
			}
			yield* Effect.sleep(wait)
		}
	}

	// One span name per verb, named at creation: `Autumn.post`, `Stripe.get`.
	const withRetry = {
		GET: Effect.fn(`${api.name}.get`)(attempt),
		POST: Effect.fn(`${api.name}.post`)(attempt),
	} satisfies Record<ProviderMethod, unknown>

	return <A>(call: ProviderCall<Path>, schema: Schema.Decoder<A>) =>
		withRetry[call.method](call).pipe(
			Effect.flatMap(({ status, body }) =>
				Schema.decodeUnknownEffect(schema)(body).pipe(
					Effect.catchTag("SchemaError", (error) =>
						unreadable(call.method, api.routeOf(call.path), status, issueSummary(error)),
					),
				),
			),
		)
}

/** A REST read: `get(path, query, schema)` (Clerk, Stripe). */
export const makeProviderGet = <Path extends string, Refusal>(
	api: ProviderApi<Path, Refusal>,
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	options?: ProviderRequestOptions,
) => {
	const call = makeProviderCall(api, client, apiKey, options)
	return <A>(path: Path, query: ProviderQuery, schema: Schema.Decoder<A>) =>
		call({ method: "GET", path, query }, schema)
}

/** An RPC-shaped read: `post(path, body, schema)` (Autumn). */
export const makeProviderPost = <Path extends string, Refusal>(
	api: ProviderApi<Path, Refusal>,
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	options?: ProviderRequestOptions,
) => {
	const call = makeProviderCall(api, client, apiKey, options)
	return <A>(path: Path, body: unknown, schema: Schema.Decoder<A>) =>
		call({ method: "POST", path, body }, schema)
}
