/**
 * How the auth client's errors read as `AuthFailure`s, shared by every app that signs in (the web's
 * `auth/flows.ts`, the native app's `apps/ios-hybrid/script/auth.ts`). Spread into an exhaustive
 * `Match.valueTags`, so a new error in the client's contract fails to compile until it is classified.
 */
import { Match } from "effect"
import type { AuthFailure, CommonReason, SignInFailure } from "./AuthFailure"

/** The transport's own reasons: offline and timeouts are worth another try, the rest is a bug. */
export const operationHttpReason = (error: { readonly reason: string }): CommonReason =>
	Match.value(error.reason).pipe(
		Match.when("network", (): CommonReason => "Offline"),
		Match.when("timeout", (): CommonReason => "Timeout"),
		Match.when("unavailable", (): CommonReason => "Unavailable"),
		Match.orElse((): CommonReason => "Unexpected"),
	)

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

/** Browser sign-in's own failures (`@yielded/auth`'s `BrowserLogin`), on top of `operationReasons`. */
export const browserSignInReasons = {
	...operationReasons,
	BrowserLoginPlatformError: ({ reason }: { readonly reason: string }): SignInFailure =>
		Match.value(reason).pipe(
			Match.when("expired", (): SignInFailure => "BrowserTimedOut"),
			Match.when("busy", (): SignInFailure => "BrowserBusy"),
			Match.when("cancelled", (): SignInFailure => "Cancelled"),
			Match.orElse((): SignInFailure => "Unavailable"),
		),
	BrowserLoginIndeterminate: (): SignInFailure => "BrowserIndeterminate",
	BrowserLoginInvalid: (): SignInFailure => "Expired",
	BrowserLoginUnavailable: (): SignInFailure => "Unavailable",
} as const
