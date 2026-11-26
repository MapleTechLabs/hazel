// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Today's route table (`../route.ts`) behind Effect UI's `Router.Routes` contract, so the Router
 * parses, prints and pushes the app's own `AppRoute` values with today's URLs.
 */
import type { Router } from "@effect/ui"
import { Option } from "effect"
import * as Url from "foldkit/url"
import { AppRoute, hrefOf, urlToAppRoute } from "../route"

/** Any absolute origin: only the path and search of a same-origin href reach the table. */
const ORIGIN = "https://hazel.invalid"

/** The route an href names (`/x?y`), or none when it is not a same-origin path. */
export const routeOfHref = (href: string): Option.Option<AppRoute> => {
	if (!href.startsWith("/") || href.startsWith("//")) return Option.none()
	return Option.map(Url.fromString(`${ORIGIN}${href}`), urlToAppRoute)
}

/** The printed path of a route, without its search. */
export const pathOf = (route: AppRoute): string => {
	const href = hrefOf(route)
	const at = href.indexOf("?")
	return at < 0 ? href : href.slice(0, at)
}

let base = ""

/**
 * Every same-origin path resolves (unknown ones to `NotFound`, as today), so every in-app link is
 * a push and only another origin is a full load. Search keys the table does not model are kept.
 */
export const AppRoutes: Router.Routes & { readonly Type: AppRoute } = {
	Type: undefined as unknown as AppRoute,
	parse: (url) => routeOfHref(url),
	resolve: (url) =>
		Option.map(routeOfHref(url), (route) => ({
			route,
			redirected: false,
			notFound: route._tag === "NotFound",
			invalid: [],
		})),
	print: (route: AppRoute) => hrefOf(route),
	printPath: (route: AppRoute) => pathOf(route),
	base: () => base,
	setBase: (next) => {
		base = next
	},
}

export { AppRoute }
