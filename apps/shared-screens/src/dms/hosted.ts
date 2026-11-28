// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The DMs screen with its wiring, for every host: a DM opens through `Navigator`. */
import { Component } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { Context, Effect, Layer } from "effect"
import { Navigator, openRoute } from "../app/navigator"
import { AppRoute } from "../app/route"
import { Dms, dmsLayer } from "./Dms"

/** What the DMs screen leaves to its host: starting a conversation (the web's dialog, a sheet). */
export class DmsHost extends Context.Service<DmsHost, { readonly compose: Effect.Effect<void> }>()(
	"hazel/dms/DmsHost",
) {}

const dmsHostLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const navigator = yield* Navigator
			const host = yield* DmsHost
			return dmsLayer(
				data,
				(channelId) => openRoute(navigator, AppRoute.ChatChannel({ orgSlug, channelId })),
				host.compose,
			)
		}),
	)

export const HostedDms = Component.provide(Dms, (props) => dmsHostLayer(props.orgSlug))
