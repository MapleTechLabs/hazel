import { ChannelId } from "@hazel/schema"
import { Schema, pipe } from "effect"
import { Route } from "foldkit"
import { defineRouteUnion, literal, schemaSegment, slash, string } from "foldkit/route"

/** Flat route union mirroring the legacy TanStack routes (grows screen by screen). */
export const AppRoute = defineRouteUnion({
	TeamSettings: { orgSlug: Schema.String },
	ChatChannel: { orgSlug: Schema.String, channelId: ChannelId },
	NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const teamSettingsRouter = pipe(
	string("orgSlug"),
	slash(literal("settings")),
	slash(literal("team")),
	Route.mapTo(AppRoute.TeamSettings),
)

export const chatChannelRouter = pipe(
	string("orgSlug"),
	slash(literal("chat")),
	slash(schemaSegment("channelId", ChannelId)),
	Route.mapTo(AppRoute.ChatChannel),
)

export const urlToAppRoute = Route.parseUrlWithFallback(
	Route.oneOf(teamSettingsRouter, chatChannelRouter),
	AppRoute.NotFound,
)

export const orgSlugOf = (route: AppRoute) => (route._tag === "NotFound" ? undefined : route.orgSlug)
