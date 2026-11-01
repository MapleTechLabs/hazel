import { desktopClient } from "@hazel/auth/contract"
import { type DesktopAuth, layerVault, makeDesktopAuth } from "@hazel/auth/desktop"
import { getTauriCore, getTauriDeepLink, getTauriOpener } from "@hazel/desktop/bridge"
import { BrowserLogin } from "@yielded/auth"
import * as WebCrypto from "@yielded/auth/WebCrypto"
import { Context, Effect, Exit, Layer, ManagedRuntime, Option, Schema, SynchronizedRef } from "effect"
import { FetchHttpClient } from "effect/http"

/**
 * Desktop sign-in (`@hazel/auth/desktop`) on Tauri: the session lives in the OS keychain (Rust
 * `auth_vault_*` commands), sign-in opens the system browser at `/auth/desktop`, and the
 * browser hands back through the `com.hazel.app://auth/callback` deep link.
 */

const unavailable = (reason: "unavailable" | "storage" = "unavailable") =>
	BrowserLogin.PlatformError.make({ reason })

/** A Tauri command on the keychain vault; outside Tauri the storage is unavailable. */
const invokeVault = <A>(command: string, args?: Record<string, unknown>) =>
	Effect.suspend(() => {
		const core = getTauriCore()
		return core === undefined
			? Effect.fail(unavailable("storage"))
			: Effect.tryPromise({
					try: () => core.invoke<A>(command, args),
					catch: () => unavailable("storage"),
				})
	})

/** One JSON record in the OS keychain; the Rust side never interprets it. */
const KeychainStore = {
	read: invokeVault<string | null>("auth_vault_read"),
	write: (record: string) => invokeVault<void>("auth_vault_write", { record }),
}

/** Only the registered callback, with exactly its query; anything else is ignored. */
const isCallback = (url: string) => url.startsWith(`${desktopClient.returnUrl}?`)

/**
 * Opens the hosted page in the system browser and waits (up to 10 minutes) for the deep
 * link back. A callback that arrived before `open` (cold start) is used first.
 */
export const BrowserLive = Layer.effect(
	BrowserLogin.Browser,
	Effect.gen(function* () {
		const queued: Array<{ url: string; at: number }> = []
		let receive: ((url: string) => void) | undefined

		const capture = (urls: ReadonlyArray<string>) => {
			for (const url of urls) {
				if (!isCallback(url)) continue
				if (receive !== undefined) receive(url)
				else if (!queued.some((entry) => entry.url === url) && queued.length < 8)
					queued.push({ url, at: Date.now() })
			}
		}

		// Without the deep link listener no callback can arrive: `open` then fails at once instead of
		// waiting out its timeout, and the session itself still reads from the vault.
		const deepLink = getTauriDeepLink()
		const isListening =
			deepLink !== undefined &&
			(yield* Effect.acquireRelease(
				Effect.tryPromise({ try: () => deepLink.onOpenUrl(capture), catch: () => unavailable() }),
				(unlisten) => Effect.sync(unlisten),
			).pipe(
				Effect.as(true),
				Effect.catchTag("BrowserLoginPlatformError", () =>
					Effect.logWarning("[desktop-auth] deep link listener unavailable").pipe(Effect.as(false)),
				),
			))
		if (deepLink !== undefined && isListening) {
			// Best effort: a cold-start callback is a convenience; sign-in can always be started again.
			const initial = yield* Effect.tryPromise({
				try: () => deepLink.getCurrent(),
				catch: () => unavailable(),
			}).pipe(Effect.orElseSucceed(() => null))
			if (initial !== null) capture(initial)
		}

		return BrowserLogin.Browser.of({
			open: ({ url }) =>
				Effect.gen(function* () {
					if (!isListening) return yield* Effect.fail(unavailable())
					const json = yield* KeychainStore.read
					if (json === null) return yield* Effect.fail(unavailable("storage"))
					const record = yield* Schema.decodeEffect(
						Schema.fromJsonString(BrowserLogin.VaultRecord),
					)(json).pipe(Effect.mapError(() => unavailable("storage")))
					const attempt = record.attempt
					if (attempt === undefined) return yield* Effect.fail(unavailable("storage"))
					const matches = (callback: string) =>
						new URL(callback).searchParams.get("state") === attempt.state
					return yield* Effect.callback<string, BrowserLogin.PlatformError>((resume) => {
						if (receive !== undefined) {
							resume(Effect.fail(BrowserLogin.PlatformError.make({ reason: "busy" })))
							return
						}
						let active = true
						const finish = (result: Effect.Effect<string, BrowserLogin.PlatformError>) => {
							if (!active) return
							active = false
							receive = undefined
							resume(result)
						}
						receive = (callbackUrl) => {
							if (matches(callbackUrl)) finish(Effect.succeed(callbackUrl))
						}
						const pending = queued.find(
							(entry) => Date.now() - entry.at < 10 * 60_000 && matches(entry.url),
						)
						queued.length = 0
						if (pending !== undefined) receive(pending.url)
						else {
							const opener = getTauriOpener()
							if (opener === undefined) finish(Effect.fail(unavailable()))
							else opener.openUrl(url).catch(() => finish(Effect.fail(unavailable())))
						}
						return Effect.sync(() => {
							active = false
							receive = undefined
						})
					}).pipe(
						Effect.timeout("10 minutes"),
						Effect.catchTag("TimeoutError", () =>
							Effect.fail(BrowserLogin.PlatformError.make({ reason: "expired" })),
						),
					)
				}),
		})
	}),
)

export class DesktopAuthService extends Context.Service<DesktopAuthService, DesktopAuth>()(
	"@hazel/web-foldkit/DesktopAuthService",
) {}

/** The web app's handoff page: where the API and web app live for this build. */
const hostedUrl = () => {
	const appOrigin = import.meta.env.VITE_APP_URL || "https://app.hazel.sh"
	return `${new URL(appOrigin).origin}/auth/desktop`
}

const DesktopAuthLive = Layer.effect(
	DesktopAuthService,
	makeDesktopAuth({
		apiOrigin: import.meta.env.VITE_BACKEND_URL || "http://localhost:3003",
		hostedUrl: hostedUrl(),
	}),
).pipe(
	Layer.provide(Layer.mergeAll(BrowserLive, layerVault(KeychainStore), WebCrypto.layer)),
	Layer.provide(FetchHttpClient.layer),
	// The desktop session travels in headers: never cookies, never redirects.
	Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "omit", redirect: "error" })),
)

/** The desktop auth runtime could not be built (keychain, crypto or deep link setup failed). */
export class DesktopAuthUnavailableError extends Schema.TaggedError<DesktopAuthUnavailableError>()(
	"DesktopAuthUnavailableError",
	{ cause: Schema.Defect() },
) {}

type DesktopAuthRuntime = ManagedRuntime.ManagedRuntime<DesktopAuthService, unknown>

/**
 * Built on first use and kept for the app's life (the deep link listener lives with it). Only a
 * runtime that built is kept: after a failed build the next use tries again.
 */
const desktopAuthRuntime = SynchronizedRef.makeUnsafe(Option.none<DesktopAuthRuntime>())

const buildRuntime: Effect.Effect<readonly [DesktopAuth, DesktopAuthRuntime], DesktopAuthUnavailableError> =
	Effect.suspend(() => {
		const runtime: DesktopAuthRuntime = ManagedRuntime.make(DesktopAuthLive)
		return runtime.contextEffect.pipe(
			Effect.map((context) => [Context.get(context, DesktopAuthService), runtime] as const),
			Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : runtime.disposeEffect)),
			Effect.catchCause((cause) => Effect.fail(new DesktopAuthUnavailableError({ cause }))),
		)
	})

const desktopAuth: Effect.Effect<DesktopAuth, DesktopAuthUnavailableError> = SynchronizedRef.modifyEffect(
	desktopAuthRuntime,
	(current) =>
		Option.match(current, {
			onSome: (runtime) =>
				runtime.contextEffect.pipe(
					Effect.map((context) => [Context.get(context, DesktopAuthService), current] as const),
					Effect.catchCause((cause) => Effect.fail(new DesktopAuthUnavailableError({ cause }))),
				),
			onNone: () =>
				Effect.map(buildRuntime, ([auth, runtime]) => [auth, Option.some(runtime)] as const),
		}),
)

export const runDesktopAuth = <A, E>(
	f: (auth: DesktopAuth) => Effect.Effect<A, E>,
): Effect.Effect<A, E | DesktopAuthUnavailableError> => Effect.flatMap(desktopAuth, f)

/** The session credential for API requests (`Authorization: Bearer`), or `null` signed out. */
export const desktopSessionBearer = (): Promise<string | null> =>
	Effect.runPromise(runDesktopAuth((auth) => auth.credential).pipe(Effect.orElseSucceed(() => null)))
