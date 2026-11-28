// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The web's `AuthFlows` (`shared-screens/src/auth/services/AuthFlows.ts`): the auth pages' flows on the
 * auth client, the passkey prompt, the desktop runtime and the native server switch. Provided with
 * each auth page in `root/native-pages.ts`, on the app's `HazelAuthClient`.
 */
import type { DesktopAuth } from "@hazel/auth/desktop"
import type { SignInFailure } from "@hazel/shared-screens/auth/domain/AuthFailure"
import {
	AuthFlowError,
	AuthFlows,
	BrowserSignInError,
	HandoffError,
	ServerChangeError,
	SignInMethodsError,
} from "@hazel/shared-screens/auth/services/AuthFlows"
import { Effect, Layer, Match } from "effect"
import { load } from "foldkit/navigation"
import { currentServer, discoverServer, sameServer } from "~/config/server"
import { type DesktopAuthUnavailableError, runDesktopAuth } from "../platform/desktop-auth"
import { switchServer } from "../platform/server-switch"
import { fetchSignInMethods, HazelAuthClient } from "./client"
import { authorizeAttempt, describeAttempt } from "./desktop-handoff"
import { register, signInWithPasskey, startOAuthSignIn } from "./flows"
import { browserSignInReasons } from "@hazel/shared-screens/auth/domain/classify"

type BrowserError = Effect.Error<DesktopAuth["signIn"]> | DesktopAuthUnavailableError

/** Exhaustive over the desktop client's sign-in failures (the library's, then the runtime's own). */
const browserSignInReason = (error: BrowserError): SignInFailure =>
	Match.valueTags(error, {
		...browserSignInReasons,
		// The desktop auth runtime (keychain, deep link) could not start.
		DesktopAuthUnavailableError: (): SignInFailure => "Unavailable",
	})

const asFlowError = (error: { readonly reason: AuthFlowError["reason"] }) =>
	new AuthFlowError({ reason: error.reason })

const asHandoffError = (error: { readonly reason: HandoffError["reason"] }) =>
	new HandoffError({ reason: error.reason })

export const AuthFlowsLive = Layer.effect(
	AuthFlows,
	Effect.gen(function* () {
		const client = yield* HazelAuthClient
		const withClient = Effect.provideService(HazelAuthClient, client)
		return {
			signInMethods: fetchSignInMethods.pipe(Effect.mapError(() => new SignInMethodsError())),
			startOAuth: (provider, returnTo) =>
				startOAuthSignIn(provider, returnTo).pipe(Effect.mapError(asFlowError), withClient),
			signInWithPasskey: (returnTo) =>
				signInWithPasskey(returnTo).pipe(Effect.mapError(asFlowError), withClient),
			register: (input) => register(input).pipe(Effect.mapError(asFlowError), withClient),
			// Opens the browser at `/auth/desktop`, waits for its link back, then reloads signed in.
			signInWithBrowser: runDesktopAuth((auth) => auth.signIn).pipe(
				Effect.mapError((error) => new BrowserSignInError({ reason: browserSignInReason(error) })),
				Effect.andThen(load("/")),
			),
			// Best effort: an attempt that can't be retired expires on its own.
			retireBrowserSignIn: runDesktopAuth((auth) => auth.cancel).pipe(Effect.ignore),
			describeAttempt: (attemptId) =>
				describeAttempt(attemptId).pipe(
					Effect.map((description) => description.displayName),
					Effect.mapError(asHandoffError),
				),
			authorizeAttempt: (attemptId) =>
				authorizeAttempt(attemptId).pipe(
					Effect.tap(load),
					Effect.mapError(asHandoffError),
					withClient,
				),
			changeServer: (address) =>
				discoverServer(address).pipe(
					Effect.mapError(({ reason }) => new ServerChangeError({ problem: reason })),
					Effect.flatMap((server) =>
						sameServer(server, currentServer())
							? Effect.succeed(false)
							: switchServer(server).pipe(Effect.as(true), withClient),
					),
				),
			useDefaultServer: switchServer(null).pipe(withClient),
		}
	}),
)
