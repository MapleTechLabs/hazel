// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** Activity's wiring, for every host: a notification opens its channel through `Navigator`. */
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Effect, Layer } from "effect"
import { Navigator, openRoute } from "../app/navigator"
import { AppRoute } from "../app/route"
import { activityLayer } from "./Activity"

/** Activity's services, for it and for the screens that embed it (the inbox). */
export const hostedActivityLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			return activityLayer(data, rpc, (channelId) =>
				openRoute(navigator, AppRoute.ChatChannel({ orgSlug, channelId })),
			)
		}),
	)
