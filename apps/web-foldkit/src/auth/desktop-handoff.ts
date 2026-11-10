import { desktopLogin } from "@hazel/auth/contract"
import { OperationHttpClient } from "@yielded/auth"
import { type Context, Effect, Layer, Match, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { CommonReason } from "~/lib/error-messages"
import { HazelAuthClient } from "./client"
import { operationHttpReason } from "./flows"

/**
 * The browser half of desktop sign-in: describe the desktop app's attempt, then authorize it
 * with this browser's session. The desktop app receives the callback and makes its own session.
 */

/** The handoff routes take the browser's session cookie, never a redirect. */
const TransportLive = OperationHttpClient.layer({
	baseUrl: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
	csrfHeader: "x-effect-auth-csrf",
	csrfValue: "1",
}).pipe(
	Layer.provide(FetchHttpClient.layer),
	Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include", redirect: "error" })),
	Layer.orDie,
)

/**
 * Why the handoff failed, beyond the shared reasons. `Expired`: the attempt is gone or used, so
 * the desktop app has to start again. `NeedsSignIn`: this browser has no session. `SignInAgain`:
 * the attempt is still open but this browser's session predates it; the apps ask for a fresh
 * sign-in (`browserSession: "reauthenticate"`), so signing in again here and continuing works.
 */
export const HandoffFailure = Schema.Union([
	Schema.Literals(["Expired", "NeedsSignIn", "SignInAgain"]),
	CommonReason,
])
export type HandoffFailure = typeof HandoffFailure.Type

export class HandoffError extends Schema.TaggedError<HandoffError>()("HandoffError", {
	reason: HandoffFailure,
}) {}

type Transport = Context.Service.Shape<typeof OperationHttpClient.Client>
type AuthApi = Context.Service.Shape<typeof HazelAuthClient>["auth"]
type SessionId = NonNullable<Effect.Success<ReturnType<AuthApi["getSession"]>>>["sessionId"]

type HandoffCallError =
	| Effect.Error<ReturnType<typeof callDescribe>>
	| Effect.Error<ReturnType<typeof callAuthorize>>
	| Effect.Error<ReturnType<AuthApi["getSession"]>>

const callDescribe = (transport: Transport, attemptId: string) =>
	transport.call(desktopLogin.routes.describe, { attemptId })

const callAuthorize = (transport: Transport, attemptId: string, expectedSessionId: SessionId) =>
	transport.call(desktopLogin.routes.authorize, { attemptId, decision: "continue", expectedSessionId })

const expired = (): HandoffFailure => "Expired"
const unavailable = (): HandoffFailure => "Unavailable"
const unexpected = (): HandoffFailure => "Unexpected"

/** Exhaustive: a new error in the handoff contract must be classified here. */
const reasonOf = (error: HandoffCallError): HandoffFailure =>
	Match.valueTags(error, {
		OperationHttpError: operationHttpReason,
		BrowserLoginInvalid: expired,
		BrowserLoginIndeterminate: expired,
		PendingAuthenticationInvalid: expired,
		StaleAuthentication: expired,
		SessionInvalid: (): HandoffFailure => "NeedsSignIn",
		AuthenticationRequired: (): HandoffFailure => "NeedsSignIn",
		AssuranceRequired: (): HandoffFailure => "NeedsSignIn",
		SessionStepUpInvalid: (): HandoffFailure => "NeedsSignIn",
		BrowserLoginUnavailable: unavailable,
		SessionUnavailable: unavailable,
		SessionSignOutUnavailable: unavailable,
		SessionCapabilityUnsupported: unavailable,
		HookDenied: unexpected,
		InvalidOperationInput: unexpected,
		OperationForbidden: unexpected,
		OperationPrivateOutputUnsupported: unexpected,
		SessionConflict: unexpected,
		SessionRenewalTooEarly: unexpected,
	})

const failed = (error: HandoffCallError) => new HandoffError({ reason: reasonOf(error) })

/** The app asking to sign in (`displayName`), or a failure if the attempt is gone. */
export const describeAttempt = (attemptId: string) =>
	Effect.gen(function* () {
		const transport = yield* OperationHttpClient.Client
		return yield* callDescribe(transport, attemptId).pipe(Effect.mapError(failed))
	}).pipe(Effect.provide(TransportLive))

/** Authorizes the attempt for this browser's session and returns the app's callback URL. */
export const authorizeAttempt = (attemptId: string) =>
	Effect.gen(function* () {
		const client = yield* HazelAuthClient
		const session = yield* client.auth.getSession().pipe(Effect.mapError(failed))
		if (session === null) return yield* new HandoffError({ reason: "NeedsSignIn" })
		const transport = yield* OperationHttpClient.Client
		const result = yield* callAuthorize(transport, attemptId, session.sessionId).pipe(
			// Refused while the attempt still describes as open: what is left is this browser's
			// session (signed in before the app asked), so a fresh sign-in here fixes it.
			Effect.catchTag("BrowserLoginInvalid", (refused) =>
				callDescribe(transport, attemptId).pipe(
					Effect.matchEffect({
						onSuccess: () => Effect.fail(new HandoffError({ reason: "SignInAgain" })),
						onFailure: () => Effect.fail(refused),
					}),
				),
			),
			Effect.mapError((error) => (Schema.is(HandoffError)(error) ? error : failed(error))),
		)
		return Redacted.value(result.callbackUrl)
	}).pipe(Effect.provide(TransportLive))
