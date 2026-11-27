/**
 * The sign-in flows the auth pages run, as a platform service: the web app implements it on its auth
 * client, the passkey prompt and the desktop runtime (`web-foldkit/src/auth/flows-layer.ts`) and
 * provides it with each page. A flow that ends in the app leaves the page with a full load, so its
 * success is only "the browser is leaving".
 */
import { Context, type Effect, Schema } from "effect"
import { AuthFailure, HandoffFailure, ServerProblem, SignInFailure } from "../domain/AuthFailure"

/** Every sign-in provider Hazel knows; each install configures some of them. */
export const Provider = Schema.Literals(["github", "google"])
export type Provider = typeof Provider.Type

/** What an install offers (`GET /auth/providers`). */
export const SignInMethods = Schema.Struct({
	providers: Schema.Array(Provider),
	passkeys: Schema.Boolean,
})
export type SignInMethods = typeof SignInMethods.Type

/** What an install offers before it answers, or when it can't: every provider, and passkeys. */
export const allSignInMethods: SignInMethods = { providers: ["github", "google"], passkeys: true }

export class AuthFlowError extends Schema.TaggedError<AuthFlowError, { readonly brand: unique symbol }>()(
	"AuthFlowError",
	{ reason: AuthFailure },
) {}

export class BrowserSignInError extends Schema.TaggedError<
	BrowserSignInError,
	{ readonly brand: unique symbol }
>()("BrowserSignInError", { reason: SignInFailure }) {}

export class HandoffError extends Schema.TaggedError<HandoffError, { readonly brand: unique symbol }>()(
	"HandoffError",
	{ reason: HandoffFailure },
) {}

export class ServerChangeError extends Schema.TaggedError<
	ServerChangeError,
	{ readonly brand: unique symbol }
>()("ServerChangeError", { problem: ServerProblem }) {}

/** The install the methods were asked of did not answer. */
export class SignInMethodsError extends Schema.TaggedError<
	SignInMethodsError,
	{ readonly brand: unique symbol }
>()("SignInMethodsError", {}) {}

export interface RegistrationInput {
	readonly flowId: string
	readonly reference: string
	readonly firstName: string
	readonly lastName: string
}

export class AuthFlows extends Context.Service<
	AuthFlows,
	{
		readonly signInMethods: Effect.Effect<SignInMethods, SignInMethodsError>
		/** Leaves for the provider's consent screen; `returnTo` is where to land once signed in. */
		readonly startOAuth: (
			provider: Provider,
			returnTo: string | null,
		) => Effect.Effect<void, AuthFlowError>
		/** The browser's passkey prompt, then a full load into the app. */
		readonly signInWithPasskey: (returnTo: string | null) => Effect.Effect<void, AuthFlowError>
		/** Creates the account for a verified provider identity, then a full load into the app. */
		readonly register: (input: RegistrationInput) => Effect.Effect<void, AuthFlowError>
		/** Desktop: the system browser signs in, then a full load; interruptible (Cancel). */
		readonly signInWithBrowser: Effect.Effect<void, BrowserSignInError>
		/** After a cancel: retires the browser attempt (best effort). */
		readonly retireBrowserSignIn: Effect.Effect<void>
		/** The desktop app asking to sign in, by its display name. */
		readonly describeAttempt: (attemptId: string) => Effect.Effect<string, HandoffError>
		/** Authorizes the attempt with this browser's session and opens the app's callback link. */
		readonly authorizeAttempt: (attemptId: string) => Effect.Effect<string, HandoffError>
		/** Native: starts over on the install at `address`; `false` when it is the current one. */
		readonly changeServer: (address: string) => Effect.Effect<boolean, ServerChangeError>
		/** Native: back to the build's own install. */
		readonly useDefaultServer: Effect.Effect<void>
	}
>()("hazel/auth/AuthFlows") {}
