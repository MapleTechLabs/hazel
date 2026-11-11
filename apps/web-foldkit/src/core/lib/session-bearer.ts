import { Effect, Schema } from "effect"

/**
 * The desktop app's session, for requests that can't carry the API's session cookie. The
 * desktop app registers a provider at startup; in a browser none is set and requests rely
 * on the cookie alone.
 */

let provider: (() => Promise<string | null>) | null = null

export const setSessionBearerProvider = (next: () => Promise<string | null>) => {
	provider = next
}

/** The desktop provider could not read the stored session (keychain or store failure). */
export class SessionBearerError extends Schema.TaggedError<SessionBearerError>()("SessionBearerError", {
	cause: Schema.Defect(),
}) {}

/** `Authorization` for the current session, or `null` (browser, or signed out). */
export const sessionAuthorizationEffect: Effect.Effect<string | null, SessionBearerError> = Effect.suspend(
	() => {
		const current = provider
		if (current === null) return Effect.succeed(null)
		return Effect.tryPromise({ try: current, catch: (cause) => new SessionBearerError({ cause }) }).pipe(
			Effect.map((credential) => (credential === null ? null : `Bearer ${credential}`)),
		)
	},
)

/** `sessionAuthorizationEffect` for Promise callers (fetch wrappers); rejects with `SessionBearerError`. */
export const sessionAuthorization = (): Promise<string | null> =>
	Effect.runPromise(sessionAuthorizationEffect)
