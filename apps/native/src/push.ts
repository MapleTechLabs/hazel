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
type Call =
	| {
			readonly rpc: "pushDevice.register"
			readonly payload: {
				readonly token: string
				readonly environment: "development" | "production"
				readonly bundleId: string
			}
	  }
	| { readonly rpc: "pushDevice.unregister"; readonly payload: { readonly token: string } }

/** A token for the log: its first 8 characters only. */
const short = (token: string) => `${token.slice(0, 8)}…`

const describe = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export const makePushDevice = (options: {
	readonly config: Pick<RuntimeConfig, "dataMode" | "apnsEnvironment">
	readonly log: (line: string) => void
}) => {
	const { config, log } = options
	/** The token the API has for this user, once registered. */
	let registered: string | undefined

	/** Makes `call` when a session is signed in; `false` when none is. */
	const withSession = async (call: Call): Promise<boolean> => {
		const { Effect } = await import("effect")
		const { sessionAuthorizationEffect } = await import("../../web-foldkit/src/core/lib/session-bearer")
		const { HazelRpc, HazelRpcLive } = await import("../../web-foldkit/src/rpc")
		const program = Effect.gen(function* () {
			if ((yield* sessionAuthorizationEffect) === null) return false
			const client = yield* HazelRpc
			if (call.rpc === "pushDevice.register") yield* client(call.rpc, call.payload)
			else yield* client(call.rpc, call.payload)
			return true
		}).pipe(Effect.provide(HazelRpcLive))
		return Effect.runPromise(program)
	}

	const register = async ({ pushToken, bundleId }: PushToken): Promise<void> => {
		if (config.dataMode !== "live") return log(`[push] offline: not registering ${short(pushToken)}`)
		const environment = config.apnsEnvironment
		if (environment === undefined)
			return log("[push] this build names no APNs environment: not registering")
		try {
			const signedIn = await withSession({
				rpc: "pushDevice.register",
				payload: { token: pushToken, environment, bundleId },
			})
			if (!signedIn) return log(`[push] signed out: not registering ${short(pushToken)}`)
			registered = pushToken
			log(`[push] registered ${short(pushToken)} (${environment}, ${bundleId})`)
		} catch (error) {
			log(`[push] register failed: ${describe(error)}`)
		}
	}

	/** Forgets the registered token (sign-out); never rejects. */
	const unregister = async (): Promise<void> => {
		const token = registered
		if (token === undefined) return
		try {
			await withSession({ rpc: "pushDevice.unregister", payload: { token } })
			registered = undefined
			log(`[push] unregistered ${short(token)}`)
		} catch (error) {
			log(`[push] unregister failed: ${describe(error)}`)
		}
	}

	return { register, unregister }
}
