// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** The shared screens' `Navigator` on the web: the shell's Router, and a new tab for another origin. */
import { Router } from "@effect/ui"
import { isAppHref, Navigator } from "@hazel/shared-screens/app/navigator"
import { Effect, Layer } from "effect"
import { routeOfPath } from "../route"

/** The app's `Navigator` on the shell's Router: an in-app href is a push, any other URL a new tab. */
export const navigatorWeb = Layer.effect(
	Navigator,
	Effect.map(Effect.service(Router.Router), (router) =>
		Navigator.of({
			open: (href) =>
				isAppHref(href)
					? Effect.asVoid(router.push(routeOfPath(href)))
					: Effect.sync(() => void window.open(href, "_blank", "noopener")),
			replace: (href) =>
				isAppHref(href)
					? Effect.asVoid(router.replace(routeOfPath(href)))
					: Effect.sync(() => window.location.assign(href)),
			back: Effect.asVoid(router.back),
		}),
	),
)
