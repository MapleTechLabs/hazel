import type { DesktopAuth } from "@hazel/auth/desktop"
import { Effect, Match, Schema } from "effect"
import { Command } from "foldkit"
import { load } from "foldkit/navigation"
import { Provider } from "../../../auth/client"
import { operationReasons, signInWithPasskey, startOAuthSignIn } from "../../../auth/flows"
import { type DesktopAuthUnavailableError, runDesktopAuth } from "../../../platform/desktop-auth"
import { Message } from "./message"
import type { SignInFailure } from "./model"

const failedSignIn = (error: { readonly reason: SignInFailure }) =>
	Effect.succeed(Message.FailedSignIn({ reason: error.reason }))

export const StartOAuthSignIn = Command.define("StartOAuthSignIn", {
	args: { provider: Schema.Literals(Provider), returnTo: Schema.NullOr(Schema.String) },
	messages: [Message.LeftForSignIn, Message.FailedSignIn],
	execute: ({ provider, returnTo }) =>
		startOAuthSignIn(provider, returnTo).pipe(
			Effect.as(Message.LeftForSignIn()),
			Effect.catchTags({ AuthFlowError: failedSignIn }),
		),
})

export const StartPasskeySignIn = Command.define("StartPasskeySignIn", {
	args: { returnTo: Schema.NullOr(Schema.String) },
	messages: [Message.LeftForSignIn, Message.FailedSignIn],
	execute: ({ returnTo }) =>
		signInWithPasskey(returnTo).pipe(
			Effect.as(Message.LeftForSignIn()),
			Effect.catchTags({ AuthFlowError: failedSignIn }),
		),
})

type BrowserSignInError = Effect.Error<DesktopAuth["signIn"]> | DesktopAuthUnavailableError

/** Exhaustive over the desktop client's sign-in failures (the library's `PlatformError` reasons first). */
const browserSignInReason = (error: BrowserSignInError): SignInFailure =>
	Match.valueTags(error, {
		...operationReasons,
		BrowserLoginPlatformError: ({ reason }): SignInFailure =>
			reason === "expired"
				? "BrowserTimedOut"
				: reason === "busy"
					? "BrowserBusy"
					: reason === "cancelled"
						? "Cancelled"
						: "Unavailable",
		BrowserLoginIndeterminate: (): SignInFailure => "BrowserIndeterminate",
		BrowserLoginInvalid: (): SignInFailure => "Expired",
		BrowserLoginUnavailable: (): SignInFailure => "Unavailable",
		// The desktop auth runtime (keychain, deep link) could not start.
		DesktopAuthUnavailableError: (): SignInFailure => "Unavailable",
	})

/**
 * Desktop: opens the browser at `/auth/desktop`, waits for its link back, then reloads into
 * the app with the new session. Interruptible, so Cancel can stop the wait.
 */
export const StartBrowserSignIn = Command.define("StartBrowserSignIn", {
	messages: [Message.LeftForSignIn, Message.FailedSignIn],
	interrupt: true,
	execute: runDesktopAuth((auth) => auth.signIn).pipe(
		Effect.andThen(load("/")),
		Effect.match({
			onSuccess: () => Message.LeftForSignIn(),
			onFailure: (error) => Message.FailedSignIn({ reason: browserSignInReason(error) }),
		}),
	),
})

/** After Cancel stopped the wait: retires the attempt, so the next sign-in starts fresh. */
export const RetireBrowserSignIn = Command.define("RetireBrowserSignIn", {
	messages: [Message.CompletedRetireBrowserSignIn],
	execute: runDesktopAuth((auth) => auth.cancel).pipe(
		// Best effort: an attempt that can't be retired expires on its own.
		Effect.ignore,
		Effect.as(Message.CompletedRetireBrowserSignIn()),
	),
})
