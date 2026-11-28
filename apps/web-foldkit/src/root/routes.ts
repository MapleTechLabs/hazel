// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Today's route table (`../route.ts`) behind Effect UI's `Router.Routes` contract, so the Router
 * parses, prints and pushes the app's own `AppRoute` values with today's URLs.
 */
import type { Router } from "@effect/ui"
import { Option } from "effect"
import { AppRoute, hrefOf, pathOf, routeOfPath } from "../route"

// SAFETY: a type-only field (`Router.Routes["Type"]`): the Router never reads its value.
const phantom = <A>(): A => undefined as A

/** The route an href names (`/x?y`), or none when it is not a same-origin path. */
export const routeOfHref = (href: string): Option.Option<AppRoute> =>
	!href.startsWith("/") || href.startsWith("//") ? Option.none() : Option.some(routeOfPath(href))

export { pathOf }

/**
 * Every same-origin path resolves (unknown ones to `NotFound`, as today), so every in-app link is
 * a push and only another origin is a full load. Search keys the table does not model are kept.
 */
const table: Omit<Router.Routes, "Type"> = {
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
	// The app lives at the origin's root; only a hash router sets another base.
	base: () => "",
	setBase: () => {},
}

/** `Type` is the route values' type for the Router's signatures; nothing reads it at runtime. */
export const AppRoutes: Router.Routes & { readonly Type: AppRoute } = { ...table, Type: phantom<AppRoute>() }

export { AppRoute }
