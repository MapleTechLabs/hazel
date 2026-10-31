/**
 * Short-lived access token for what cannot carry the API's session cookie: the sync sockets
 * and the live message sockets (`Sec-WebSocket-Protocol`). The backend exchanges the HttpOnly session
 * cookie for an ES256 JWT at `POST /auth/token`. Requests to the API itself authenticate with
 * the cookie and need no token.
 *
 * The exchange is an Effect; the exports stay Promise functions because their callers live outside
 * any runtime (the sync hub, the live sockets).
 */

import { Duration, Effect, Schedule, Schema } from "effect"
import { sessionAuthorizationEffect } from "./session-bearer"

interface CachedToken {
	readonly token: string
	readonly expiresAtMs: number
}

/**
 * Dispatched on `window` when the API refuses to exchange the session for a token: the session
 * has likely ended. The app re-reads the session and, if it has, sends the user to sign-in.
 */
export const SESSION_REJECTED_EVENT = "hazel:session-rejected"

/** Renew this long before expiry, so a token is never sent seconds from expiring. */
const RENEW_BEFORE_MS = 60_000

let generation = 0
let cached: CachedToken | null = null
let pending: Promise<AccessTokenResult> | null = null

/**
 * A token; `null` when there is no session (or the exchange was superseded by sign-out);
 * `"unavailable"` when the API did not answer, which says nothing about the session.
 */
export type AccessTokenResult = string | null | "unavailable"

/** The API could not answer the exchange: unreachable, a 5xx, or a body that isn't a token. */
export class TokenExchangeError extends Schema.TaggedError<TokenExchangeError>()("TokenExchangeError", {
	reason: Schema.Literals(["Unreachable", "ServerError", "BadResponse"]),
	cause: Schema.optional(Schema.Defect()),
}) {}

const TokenResponse = Schema.Struct({ token: Schema.String, expiresIn: Schema.Number })
const decodeTokenResponse = Schema.decodeUnknownEffect(TokenResponse)

const backendUrl = () => import.meta.env.VITE_BACKEND_URL || "http://localhost:3003"

/** The exchange `index.html` starts before the app's script has loaded. */
interface EarlyToken {
	readonly response: Promise<Response | null>
	readonly startedAtMs: number
}

declare global {
	interface Window {
		__hazelEarlyToken?: EarlyToken | undefined
	}
}

/** Older than this, the early exchange is not reused: the page sat on a screen long enough to matter. */
const EARLY_TOKEN_MAX_AGE_MS = 30_000

/**
 * The early exchange's response, taken once. Only a token is reused: a refused or failed early
 * exchange is asked again here, so it never reports a session that ended in between.
 */
const takeEarlyToken = (): Promise<Response | null> => {
	const early = typeof window === "undefined" ? undefined : window.__hazelEarlyToken
	if (early === undefined) return Promise.resolve(null)
	window.__hazelEarlyToken = undefined
	if (Date.now() - early.startedAtMs > EARLY_TOKEN_MAX_AGE_MS) return Promise.resolve(null)
	return early.response.then((response) => (response?.ok ? response : null))
}

/** Attempts per exchange: a network error or 5xx right after sign-in is usually momentary. */
const EXCHANGE_ATTEMPTS = 3

const unreachable = (cause: unknown) => new TokenExchangeError({ reason: "Unreachable", cause })

/** A token, or `null` when the API answered and there is no session (or sign-out superseded this exchange). */
const exchangeOnce = (startedGeneration: number): Effect.Effect<string | null, TokenExchangeError> =>
	Effect.gen(function* () {
		const early = yield* Effect.promise(takeEarlyToken)
		const authorization = yield* sessionAuthorizationEffect.pipe(Effect.mapError(unreachable))
		const response =
			early ??
			(yield* Effect.tryPromise({
				try: () =>
					fetch(`${backendUrl()}/auth/token`, {
						method: "POST",
						// The desktop app's session is a bearer; a browser's is the API's cookie.
						...(authorization === null
							? { credentials: "include" as const, headers: { "x-effect-auth-csrf": "1" } }
							: { credentials: "omit" as const, headers: { authorization } }),
					}),
				catch: unreachable,
			}))
		if (startedGeneration !== generation) return null
		if (response.status >= 500) return yield* new TokenExchangeError({ reason: "ServerError" })
		if (!response.ok) {
			cached = null
			if (response.status === 401) window.dispatchEvent(new Event(SESSION_REJECTED_EVENT))
			return null
		}
		const body = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: (cause) => new TokenExchangeError({ reason: "BadResponse", cause }),
		}).pipe(
			Effect.flatMap(decodeTokenResponse),
			Effect.catchTag("SchemaError", (cause) =>
				Effect.fail(new TokenExchangeError({ reason: "BadResponse", cause })),
			),
		)
		if (startedGeneration !== generation) return null
		cached = { token: body.token, expiresAtMs: Date.now() + body.expiresIn * 1000 }
		return body.token
	})

/** Retries an exchange the API did not answer (500ms, then 1s), unless sign-out superseded it. */
const exchange = (startedGeneration: number): Effect.Effect<AccessTokenResult> =>
	exchangeOnce(startedGeneration).pipe(
		Effect.retry({
			schedule: Schedule.exponential(Duration.millis(500)),
			times: EXCHANGE_ATTEMPTS - 1,
			while: () => startedGeneration === generation,
		}),
		Effect.catchTag("TokenExchangeError", () =>
			Effect.succeed<AccessTokenResult>(startedGeneration === generation ? "unavailable" : null),
		),
	)

/**
 * The current access token, exchanged again shortly before it expires. Tells a refused session
 * (`null`) apart from an API that did not answer (`"unavailable"`), so callers can retry the latter.
 */
export const readAccessToken = async (): Promise<AccessTokenResult> => {
	if (typeof window === "undefined") return null
	if (cached !== null && cached.expiresAtMs - Date.now() > RENEW_BEFORE_MS) return cached.token
	if (pending === null) {
		const request = Effect.runPromise(exchange(generation)).finally(() => {
			if (pending === request) pending = null
		})
		pending = request
	}
	return pending
}

/** The current access token; `null` when signed out or the API did not answer. */
export const getAccessToken = async (): Promise<string | null> => {
	const result = await readAccessToken()
	return result === "unavailable" ? null : result
}

/** Forgets the cached token so the next request exchanges a new one, after a host rejected it. */
export const invalidateAccessToken = (rejected: string) => {
	if (cached?.token === rejected) cached = null
}

/** Drops the cached token, for sign-out. */
export const clearAccessToken = () => {
	if (typeof window !== "undefined") window.__hazelEarlyToken = undefined
	generation++
	pending = null
	cached = null
}
