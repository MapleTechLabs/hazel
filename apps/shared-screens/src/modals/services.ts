// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The services a modal's Command bodies run on, captured when the Command's Layer builds: the
 * app's data (its collections and optimistic actions), the RPC client and the app's requests.
 */
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Effect } from "effect"
import { AppRequests } from "../app/requests"

export const modalServices = Effect.gen(function* () {
	const data = yield* ClientData
	const rpc = yield* HazelRpc
	const requests = yield* AppRequests
	return {
		data,
		/** Runs a body with the RPC client and the app's requests in place. */
		run: <A, E>(effect: Effect.Effect<A, E, HazelRpc | AppRequests>): Effect.Effect<A, E> =>
			effect.pipe(Effect.provideService(HazelRpc, rpc), Effect.provideService(AppRequests, requests)),
	}
})
