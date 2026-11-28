// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel sidebar with its wiring, for every host: rows open through `Navigator`, writes run on
 * the app's data, its menus run the app's own Commands. A host provides only `SidebarHost`.
 */
import { Component } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Context, Effect, Layer, Match } from "effect"
import { Navigator, openRoute } from "../app/navigator"
import { AppRoute } from "../app/route"
import { sidebarWritesLayer } from "./actions"
import { ChannelSidebar, channelSidebarLayer, matchTarget } from "./ChannelSidebar"

/** What the sidebar leaves to its host: where the create-channel hint's dismissal is kept. */
export class SidebarHost extends Context.Service<
	SidebarHost,
	{ readonly dismissHint: Effect.Effect<void> }
>()("hazel/channel-sidebar/SidebarHost") {}

/** The sidebar's services, for it and for screens that embed it (a phone's sidebar sheet). */
export const hostedSidebarLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			const host = yield* SidebarHost
			return Layer.mergeAll(
				channelSidebarLayer(
					data,
					(to) =>
						openRoute(
							navigator,
							matchTarget<AppRoute>(to, {
								Channel: (channelId) => AppRoute.ChatChannel({ orgSlug, channelId }),
								Members: () => AppRoute.OrgHome({ orgSlug }),
							}),
						),
					(action) => Match.valueTags(action, { DismissHint: () => host.dismissHint }),
				),
				sidebarWritesLayer(data, rpc),
			)
		}),
	)

export const HostedChannelSidebar = Component.provide(ChannelSidebar, (props) =>
	hostedSidebarLayer(props.orgSlug),
)
