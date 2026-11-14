/**
 * Push notifications (iOS): the host hands every runtime this device's APNs token once the user
 * allows notifications (`host/ios/src/push.rs`), and the runtime registers it with the API for the
 * signed-in user (`pushDevice.register`), whose pushes then reach the phone. Signing in loads a
 * fresh runtime, which hears the token again; signing out forgets it first
 * (`web-foldkit/src/platform/push-device.ts`). Offline, nothing is registered.
 */
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

/** Makes a call when a session is signed in, resolving `false` when none is. */
export type SendPushCall = (call: PushCall) => Promise<boolean>

/** A failed call is tried again this many times, waiting 1, 2, 4, 8 and 16 seconds. */
const RETRIES = 5

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

/**
 * The API client's call, retried with backoff while the API or the network fails; a signed-out
 * session (no session, or the API's `UnauthorizedError`) is not retried.
 */
const sendWithSession: SendPushCall = async (call) => {
	const { Effect, Schedule } = await import("effect")
	const { sessionAuthorizationEffect } = await import("../../web-foldkit/src/core/lib/session-bearer")
	const { HazelRpc, HazelRpcLive } = await import("../../web-foldkit/src/rpc")
	const program = Effect.gen(function* () {
		if ((yield* sessionAuthorizationEffect) === null) return false
		const client = yield* HazelRpc
		yield* client(call.rpc, call.payload)
		return true
	}).pipe(
		Effect.retry({
			schedule: Schedule.exponential("1 second"),
			times: RETRIES,
			while: (error) => error._tag !== "UnauthorizedError",
		}),
		Effect.provide(HazelRpcLive),
	)
	return Effect.runPromise(program)
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
	/** The registration on its way, which sign-out waits for. */
	let inFlight: { readonly token: string; readonly done: Promise<void> } | undefined

	const registerNow = async (token: string, bundleId: string): Promise<void> => {
		const environment = config.apnsEnvironment
		if (environment === undefined)
			return log("[push] this build names no APNs environment: not registering")
		try {
			const signedIn = await send({
				rpc: "pushDevice.register",
				payload: { token, environment, bundleId },
			})
			if (!signedIn) return log(`[push] signed out: not registering ${short(token)}`)
			registered = token
			log(`[push] registered ${short(token)} (${environment}, ${bundleId})`)
		} catch (error) {
			log(`[push] register failed: ${describe(error)}`)
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
		const done = registerNow(pushToken, bundleId).finally(() => {
			if (inFlight?.done === done) inFlight = undefined
		})
		inFlight = { token: pushToken, done }
		return done
	}

	/**
	 * Forgets this device's token on the API (sign-out), after a registration still on its way:
	 * the host's latest, even if this runtime's registration failed. Never rejects.
	 */
	const unregister = async (): Promise<void> => {
		await inFlight?.done
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
