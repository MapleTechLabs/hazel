// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The native app's `AuthFlows` (`shared-screens/src/auth/services/AuthFlows.ts`): browser sign-in
 * (`@hazel/auth/desktop`, as the native client) in JavaScriptCore. The system's sign-in sheet opens
 * the web app's `/auth/desktop`, its callback is exchanged for a session, and the session is kept in
 * the keychain record the hybrid app kept, so one carries over.
 */
import { layerVault, makeDesktopAuth } from "@hazel/auth/desktop"
import { nativeClient } from "@hazel/auth/contract"
import { browserSignInReasons } from "@hazel/shared-screens/auth/domain/classify"
import {
	AuthFlowError,
	AuthFlows,
	BrowserSignInError,
	HandoffError,
	ServerChangeError,
	allSignInMethods,
} from "@hazel/shared-screens/auth/services/AuthFlows"
import type { SignInFailure } from "@hazel/shared-screens/auth/domain/AuthFailure"
import { BrowserLogin } from "@yielded/auth"
import { Effect, Layer, Match } from "effect"
import { HttpClient } from "effect/http"
import { CryptoJsc, openSignInSheet } from "../../../packages/client-data/src/platform/jsc/auth.ts"
import { nativeBridge } from "../../../packages/client-data/src/platform/jsc/bridge.ts"
import { discoveryDocumentOf, discoverServer, sameServer } from "../../web-foldkit/src/core/config/server.ts"
import type { ShellServer } from "./shell"
import { appShell } from "./shell"

const callbackScheme = new URL(nativeClient.returnUrl).protocol.slice(0, -1)

const storage = () => BrowserLogin.PlatformError.make({ reason: "storage" })

/** The keychain's one record (`HazelUI/Runtime/NativeSession.swift`), as `@hazel/auth/desktop` keeps it. */
const KeychainStore = {
	read: Effect.sync(() => nativeBridge().session?.read() ?? null),
	write: (record: string) =>
		Effect.suspend(() =>
			nativeBridge().session?.write(record) === true ? Effect.void : Effect.fail(storage()),
		),
}

/** The sign-in sheet: the library checks the callback's code, state and return URL itself. */
const BrowserJsc = Layer.succeed(
	BrowserLogin.Browser,
	BrowserLogin.Browser.of({
		open: ({ url, ephemeral }) =>
			openSignInSheet(url, callbackScheme, ephemeral).pipe(
				Effect.mapError((reason) => BrowserLogin.PlatformError.make({ reason })),
			),
	}),
)

/** A browser fetch's shape over the native `HttpClient`, for the web's server discovery. */
const fetchOver =
	(http: HttpClient.HttpClient) =>
	(url: string): Promise<Response> =>
		Effect.runPromise(
			http.get(url, { headers: { accept: "application/json" } }).pipe(
				Effect.flatMap((response) =>
					Effect.map(response.text, (text) => ({
						ok: response.status >= 200 && response.status < 300,
						json: async (): Promise<unknown> => JSON.parse(text),
					})),
				),
			),
			// SAFETY: `discoverServer` reads only `ok` and `json()` of the response.
		) as unknown as Promise<Response>

/** `@hazel/auth/desktop` for the native client on `server`, its session in the keychain record. */
const desktopAuthOn = (server: ShellServer) =>
	makeDesktopAuth({
		apiOrigin: server.api,
		hostedUrl: `${server.app}/auth/desktop`,
		client: nativeClient,
	}).pipe(Effect.provide(Layer.mergeAll(BrowserJsc, layerVault(KeychainStore), CryptoJsc)))

/** Ends the session on the API and forgets it in the keychain (the vault's own sign-out). */
export const signOutJsc = (server: ShellServer) =>
	Effect.flatMap(desktopAuthOn(server), (auth) => auth.signOut)

/**
 * `AuthFlows` for the native app on `server`. `signedIn` runs once a browser sign-in has stored its
 * session: the app then leaves the sign-in screen.
 */
export const authFlowsJsc = (server: ShellServer, signedIn: Effect.Effect<void>) =>
	Layer.effect(
		AuthFlows,
		Effect.gen(function* () {
			const http = yield* HttpClient.HttpClient
			const auth = yield* desktopAuthOn(server)
			// The native app signs in only through the sheet: the web's own flows never run here.
			const webOnly = Effect.fail(new AuthFlowError({ reason: "Unavailable" }))
			const handoffOnly = Effect.fail(new HandoffError({ reason: "Unavailable" }))
			return AuthFlows.of({
				signInMethods: Effect.succeed(allSignInMethods),
				startOAuth: () => webOnly,
				signInWithPasskey: () => webOnly,
				register: () => webOnly,
				signInWithBrowser: auth.signIn.pipe(
					Effect.mapError(
						(error) =>
							new BrowserSignInError({
								reason: Match.valueTags(error, browserSignInReasons) satisfies SignInFailure,
							}),
					),
					Effect.andThen(signedIn),
				),
				// Best effort: an attempt that can't be retired expires on its own.
				retireBrowserSignIn: auth.cancel.pipe(Effect.ignore),
				describeAttempt: () => handoffOnly,
				authorizeAttempt: () => handoffOnly,
				changeServer: (address) =>
					discoverServer(address, fetchOver(http)).pipe(
						Effect.mapError(({ reason }) => new ServerChangeError({ problem: reason })),
						Effect.map((found) => {
							const current = { ...server, linkPreview: null }
							if (sameServer(found, current)) return false
							appShell().setServer(JSON.stringify(discoveryDocumentOf(found)))
							return true
						}),
					),
				useDefaultServer: Effect.sync(() => appShell().setServer(null)),
			})
		}),
	)
