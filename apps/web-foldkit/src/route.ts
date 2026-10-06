import { Schema, pipe } from "effect"
import { Route } from "foldkit"
import { defineRouteUnion, literal, slash, string } from "foldkit/route"

/** Flat route union mirroring the legacy TanStack routes (grows screen by screen). */
export const AppRoute = defineRouteUnion({
	TeamSettings: { orgSlug: Schema.String },
	NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

export const teamSettingsRouter = pipe(
	string("orgSlug"),
	slash(literal("settings")),
	slash(literal("team")),
	Route.mapTo(AppRoute.TeamSettings),
)

export const urlToAppRoute = Route.parseUrlWithFallback(Route.oneOf(teamSettingsRouter), AppRoute.NotFound)

export const orgSlugOf = (route: AppRoute) => (route._tag === "NotFound" ? undefined : route.orgSlug)
