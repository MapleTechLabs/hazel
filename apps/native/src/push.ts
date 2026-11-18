/**
 * Push notifications (iOS): the host hands every runtime this device's APNs token once the user
 * allows notifications (`host/ios/src/push.rs`), and the runtime registers it with the API for the
 * signed-in user (`pushDevice.register`), whose pushes then reach the phone. Signing in loads a
 * fresh runtime, which hears the token again; signing out forgets it first
 * (`web-foldkit/src/platform/push-device.ts`). Offline, nothing is registered.
 */
import { Effect, Schedule } from "effect"
import type { RuntimeConfig } from "./config"

/** The host's token, as `push.rs` hands it over. */
export type PushToken = { readonly pushToken: string; readonly bundleId: string }

/** The API calls this module makes. */
export type PushCall =
	| {
			readonly rpc: "pushDevice.register"
			readonly payload: {
				readonly token: string
				readonly environment: "development" | "production"
				readonly bundleId: string
			}
	  }
	| { readonly rpc: "pushDevice.unregister"; readonly payload: { readonly token: string } }

/** Makes a call when a session is signed in, resolving `false` when none is; `signal` stops it. */
export type SendPushCall = (call: PushCall, signal?: AbortSignal) => Promise<boolean>

/** A failed call is tried again this many times, waiting 1, 2, 4, 8 and 16 seconds. */
const RETRIES = 5

/**
 * An API call retried with backoff while the API or the network fails; the API's
 * `UnauthorizedError` (signed out) is not retried. `base` is the backoff (tests shorten it).
 */
export const withRetries = <A, E extends { readonly _tag: string }, R>(
	call: Effect.Effect<A, E, R>,
	base: Schedule.Schedule<unknown> = Schedule.exponential("1 second"),
) =>
	Effect.retry(call, {
		schedule: base,
		times: RETRIES,
		while: (error) => error._tag !== "UnauthorizedError",
	})

/**
 * Whether a notification's `path` is one of the app's own: it resolves against the page's `base`
 * to the same origin (`//host/x`, `/\host/x` and `https:` links do not).
 */
export const isAppPath = (path: string, base: string): boolean => {
	if (!path.startsWith("/")) return false
	const target = URL.parse(path, base)
	return target !== null && target.origin === new URL(base).origin
}

/** A token for the log: its first 8 characters only. */
const short = (token: string) => `${token.slice(0, 8)}…`

const describe = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/** The API client's call (`withRetries`); with no session, none is made. */
const sendWithSession: SendPushCall = async (call, signal) => {
	const { sessionAuthorizationEffect } = await import("../../web-foldkit/src/core/lib/session-bearer")
	const { HazelRpc, HazelRpcLive } = await import("../../web-foldkit/src/rpc")
	const program = Effect.gen(function* () {
		if ((yield* sessionAuthorizationEffect) === null) return false
		const client = yield* HazelRpc
		yield* client(call.rpc, call.payload)
		return true
	}).pipe(withRetries, Effect.provide(HazelRpcLive))
	return Effect.runPromise(program, { signal })
}

export const makePushDevice = (options: {
	readonly config: Pick<RuntimeConfig, "dataMode" | "apnsEnvironment">
	readonly log: (line: string) => void
	/** The API call (tests answer it themselves). */
	readonly send?: SendPushCall
}) => {
	const { config, log, send = sendWithSession } = options
	/** The token the host sent last: what sign-out forgets, registered or not. */
	let latest: string | undefined
	/** The token the API has for this user from this runtime. */
	let registered: string | undefined
	/** The registration on its way, which sign-out stops. */
	let inFlight:
		| { readonly token: string; readonly done: Promise<void>; readonly stop: AbortController }
		| undefined

	const registerNow = async (token: string, bundleId: string, signal: AbortSignal): Promise<void> => {
		const environment = config.apnsEnvironment
		if (environment === undefined)
			return log("[push] this build names no APNs environment: not registering")
		try {
			const signedIn = await send(
				{ rpc: "pushDevice.register", payload: { token, environment, bundleId } },
				signal,
			)
			if (!signedIn) return log(`[push] signed out: not registering ${short(token)}`)
			registered = token
			log(`[push] registered ${short(token)} (${environment}, ${bundleId})`)
		} catch (error) {
			log(`[push] register ${signal.aborted ? "stopped" : "failed"}: ${describe(error)}`)
		}
	}

	const register = ({ pushToken, bundleId }: PushToken): Promise<void> => {
		if (config.dataMode !== "live") {
			log(`[push] offline: not registering ${short(pushToken)}`)
			return Promise.resolve()
		}
		latest = pushToken
		// The same token again: already registered, or on its way.
		if (registered === pushToken) return Promise.resolve()
		if (inFlight?.token === pushToken) return inFlight.done
		const stop = new AbortController()
		const done = registerNow(pushToken, bundleId, stop.signal).finally(() => {
			if (inFlight?.done === done) inFlight = undefined
		})
		inFlight = { token: pushToken, done, stop }
		return done
	}

	/**
	 * Forgets this device's token on the API (sign-out): the host's latest, even if this runtime's
	 * registration failed. A registration on its way (and its retries) stops first, so the call
	 * goes out at once, while the session it needs still exists. Never rejects.
	 */
	const unregister = async (): Promise<void> => {
		inFlight?.stop.abort()
		inFlight = undefined
		const token = latest
		if (token === undefined) return
		try {
			const signedIn = await send({ rpc: "pushDevice.unregister", payload: { token } })
			registered = undefined
			if (signedIn) log(`[push] unregistered ${short(token)}`)
		} catch (error) {
			log(`[push] unregister failed: ${describe(error)}`)
		}
	}

	return { register, unregister }
}
