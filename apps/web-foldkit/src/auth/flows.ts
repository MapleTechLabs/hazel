import type { OperationHttpError } from "@yielded/auth/OperationHttp"
import * as PasskeyBrowser from "@yielded/auth-simplewebauthn/Browser"
import { type Context, Effect, Match, Redacted, Schema } from "effect"
import { load } from "foldkit/navigation"
import { CommonReason } from "~/lib/error-messages"
import { HazelAuthClient, type Provider } from "./client"
import { rememberReturnTo, takeReturnTo } from "./return-to"

/**
 * The sign-in flows the auth pages run: OAuth (leaves for the provider), passkeys and
 * registration (both end with a session cookie, then a full load so the app starts signed in).
 */

/**
 * Why a flow did not finish, beyond the shared reasons. `Cancelled` is the visitor closing the
 * passkey prompt themselves, so it shows nothing.
 */
export const AuthFailure = Schema.Union([
	Schema.Literals([
		"Cancelled",
		"PasskeyUnsupported",
		"Rejected",
		"Expired",
		"Denied",
		"AccountConflict",
		"AccountCreated",
	]),
	CommonReason,
])
export type AuthFailure = typeof AuthFailure.Type

export class AuthFlowError extends Schema.TaggedError<AuthFlowError>()("AuthFlowError", {
	reason: AuthFailure,
}) {}

type AuthApi = Context.Service.Shape<typeof HazelAuthClient>["auth"]

/** Everything the auth client and the browser's passkey prompt can fail with. */
type AuthError =
	| Effect.Error<ReturnType<AuthApi["signIn"]>>
	| Effect.Error<ReturnType<AuthApi["passkeySignIn"]>>
	| Effect.Error<ReturnType<AuthApi["completePasskeySignIn"]>>
	| Effect.Error<ReturnType<AuthApi["register"]>>
	| PasskeyBrowser.PasskeyBrowserFailure

/** The transport's own reasons: offline and timeouts are worth another try, the rest is a bug. */
export const operationHttpReason = (error: OperationHttpError): CommonReason =>
	error.reason === "network"
		? "Offline"
		: error.reason === "timeout"
			? "Timeout"
			: error.reason === "unavailable"
				? "Unavailable"
				: "Unexpected"

const cancelled = (): AuthFailure => "Cancelled"
const rejected = (): AuthFailure => "Rejected"
const expired = (): AuthFailure => "Expired"
const unavailable = (): AuthFailure => "Unavailable"
const unexpected = (): AuthFailure => "Unexpected"

/** The failures every auth operation shares: the transport, the session and the server's hooks. */
export const operationReasons = {
	OperationHttpError: operationHttpReason,
	PendingAuthenticationInvalid: expired,
	StaleAuthentication: expired,
	SessionInvalid: expired,
	SessionStepUpInvalid: expired,
	AuthenticationRequired: expired,
	AssuranceRequired: expired,
	HookDenied: (): AuthFailure => "Denied",
	SessionUnavailable: unavailable,
	SessionSignOutUnavailable: unavailable,
	SessionCapabilityUnsupported: unavailable,
	InvalidOperationInput: unexpected,
	OperationForbidden: unexpected,
	OperationPrivateOutputUnsupported: unexpected,
	SessionConflict: unexpected,
	SessionRenewalTooEarly: unexpected,
} as const

/** Exhaustive: a new error in the client's contract must be classified here. */
export const authFailureOf = (error: AuthError): AuthFailure =>
	Match.valueTags(error, {
		...operationReasons,
		PasskeyBrowserNotCompleted: cancelled,
		PasskeyBrowserBusy: cancelled,
		PasskeyBrowserUnsupported: (): AuthFailure => "PasskeyUnsupported",
		PasskeyBrowserUnavailable: (): AuthFailure => "PasskeyUnsupported",
		// The browser refused the server's options: nothing the visitor can change.
		PasskeyBrowserInputRejected: unexpected,
		PasskeyRejected: rejected,
		OAuthRejected: rejected,
		PasskeyActionRequired: expired,
		IdentityConflict: (): AuthFailure => "AccountConflict",
		PasskeyUnavailable: unavailable,
		PasskeyMethodUnsupported: unavailable,
		OAuthUnavailable: unavailable,
		OAuthMethodUnsupported: unavailable,
	})

const failed = (error: AuthError) => new AuthFlowError({ reason: authFailureOf(error) })

/** A finished call that issued no session: the flow cannot carry on from here. */
type Outcome = { readonly _tag: "Authenticated" | "PendingAuthentication" | "RegistrationAccepted" }

const requireSession = (outcome: Outcome): Effect.Effect<void, AuthFlowError> =>
	Match.value(outcome._tag).pipe(
		Match.when("Authenticated", () => Effect.void),
		// A second factor Hazel does not ask for: the pending sign-in can't be finished here.
		Match.when("PendingAuthentication", () => Effect.fail(new AuthFlowError({ reason: "Expired" }))),
		// The account exists but this call did not sign it in.
		Match.when("RegistrationAccepted", () =>
			Effect.fail(new AuthFlowError({ reason: "AccountCreated" })),
		),
		Match.exhaustive,
	)

const newId = Effect.sync(() => crypto.randomUUID())

/** After a session is issued: a full load of the remembered page, so the app boots signed in. */
const enterApp = (returnTo: string | null) =>
	Effect.gen(function* () {
		const remembered = returnTo ?? (yield* takeReturnTo)
		yield* load(remembered ?? "/")
	})

/** Starts OAuth with `provider` and leaves for its consent screen. */
export const startOAuthSignIn = (provider: Provider, returnTo: string | null) =>
	Effect.gen(function* () {
		if (returnTo !== null) yield* rememberReturnTo(returnTo)
		const client = yield* HazelAuthClient
		const started = yield* client.auth
			.signIn({ provider, returnTarget: "/" })
			.pipe(Effect.mapError(failed))
		yield* load(Redacted.value(started.authorizationUrl))
	})

/** Begin, the browser's passkey prompt, complete; then into the app. */
export const signInWithPasskey = (returnTo: string | null) =>
	Effect.gen(function* () {
		const client = yield* HazelAuthClient
		const result = yield* Effect.gen(function* () {
			const browser = yield* PasskeyBrowser.make()
			const started = yield* client.auth.passkeySignIn({
				flowId: yield* newId,
				commandId: yield* newId,
				profileId: "default",
			})
			const response = yield* browser.authenticate({ started, mediation: "required" })
			return yield* client.auth.completePasskeySignIn({
				flowId: response.flowId,
				response: Redacted.value(response.response),
			})
		}).pipe(Effect.mapError(failed))
		yield* requireSession(result)
		yield* enterApp(returnTo)
	})

export interface RegistrationInput {
	readonly flowId: string
	readonly reference: string
	readonly firstName: string
	readonly lastName: string
}

/** Creates the Hazel account for a verified provider identity; the API signs it in. */
export const register = (input: RegistrationInput) =>
	Effect.gen(function* () {
		const client = yield* HazelAuthClient
		const result = yield* client.auth
			.register({
				flowId: input.flowId,
				reference: input.reference,
				commandId: yield* newId,
				registration: { firstName: input.firstName.trim(), lastName: input.lastName.trim() },
			})
			.pipe(Effect.mapError(failed))
		yield* requireSession(result)
		yield* enterApp(null)
	})
