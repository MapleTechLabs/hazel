// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The inbox with its wiring, for every host: Activity's rows on `Navigator`, Unreads on the RPC. */
import { Component } from "@effect/ui"
import { Layer } from "effect"
import { hostedActivityLayer } from "../activity/hosted"
import { MarkAllChannelsRead, MarkChannelRead, NotificationsPage } from "./pages/NotificationsPage"

export const HostedNotificationsPage = Component.provide(NotificationsPage, (props) =>
	Layer.mergeAll(MarkChannelRead.layer, MarkAllChannelsRead.layer).pipe(
		Layer.provideMerge(hostedActivityLayer(props.session.orgSlug ?? "")),
	),
)
