import { Effect, Schedule, Schema } from "effect"
import { closeSync } from "~/db/sync-manager"
import { clearAccessToken } from "~/lib/access-token"
import { CommonReason, reasonOfUnknown } from "~/lib/error-messages"
import { HazelAuthClient } from "../auth/client"
import { isDesktop } from "../platform/desktop"
import { runDesktopAuth } from "../platform/desktop-auth"
import type { SessionAnswer } from "./message"

/**
 * The Hazel session, read from the API. In a browser it is an HttpOnly cookie on the API host
 * (`getSession`); the desktop app holds its own session in the OS keychain.
 */

/**
 * The API (or the desktop keychain) could not answer. The auth client's errors are not part of the
 * app's `CommonError` union, so the reason is classified once here: offline, or unavailable.
 */
export class SessionCheckError extends Schema.TaggedError<SessionCheckError>()("SessionCheckError", {
	reason: CommonReason,
}) {}

const toSessionCheckError = (cause: unknown) =>
	new SessionCheckError({ reason: reasonOfUnknown(cause) === "Offline" ? "Offline" : "Unavailable" })

/** A momentary blip right after load is retried before the app says it cannot reach Hazel. */
const retryBlip = Schedule.exponential("500 millis").pipe(Schedule.jittered)

/** The desktop app's own session (OS keychain), checked with the API. */
const readDesktopSession = runDesktopAuth((auth) => auth.session).pipe(
	Effect.map((session): SessionAnswer => (session === null ? "SignedOut" : "SignedIn")),
)

const readBrowserSession = Effect.gen(function* () {
	const client = yield* HazelAuthClient
	const session = yield* client.auth.getSession()
	return session === null ? ("SignedOut" as const) : ("SignedIn" as const)
})

/**
 * Fails only when nothing answered. An unreachable API says nothing about the session, so it must
 * not count as signed out: that would send a signed-in user to sign-in.
 */
export const readSession: Effect.Effect<SessionAnswer, SessionCheckError, HazelAuthClient> = (
	isDesktop ? readDesktopSession : readBrowserSession
).pipe(
	Effect.mapError(toSessionCheckError),
	Effect.tapError((error) => Effect.logWarning("[auth] session check failed", error.reason)),
	Effect.retry({ schedule: retryBlip, times: 2 }),
)

/** The API rejected sign-out or could not be reached; the user stays signed in. */
export class SignOutError extends Schema.TaggedError<SignOutError>()("SignOutError", {
	reason: CommonReason,
}) {}

/** Ends the session on the API, closes every sync connection and drops the cached access token. */
export const signOut: Effect.Effect<void, SignOutError, HazelAuthClient> = Effect.gen(function* () {
	if (isDesktop) {
		// Ends only the desktop app's session; the browser it signed in with stays signed in.
		yield* runDesktopAuth((auth) => auth.signOut)
	} else {
		const client = yield* HazelAuthClient
		yield* client.auth.signOut()
	}
	yield* Effect.sync(() => {
		closeSync()
		clearAccessToken()
	})
}).pipe(Effect.mapError((cause) => new SignOutError({ reason: reasonOfUnknown(cause) })))
