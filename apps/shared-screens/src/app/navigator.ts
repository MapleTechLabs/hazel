// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Where every screen's navigation goes, on any host: the web's Router, the phone's stacks
 * (`phone/PhoneShell`'s `ShellIntents`). Screens and their hosted layers (`./hosted`) ask it; no
 * host wires a screen's navigation by hand.
 */
import { Context, type Effect } from "effect"
import { type AppRoute, hrefOf } from "./route"

export class Navigator extends Context.Service<
	Navigator,
	{
		/** An in-app href (`/acme/chat/c1`) opens in the app; any other URL with the system. */
		readonly open: (href: string) => Effect.Effect<void>
		/** One screen back. */
		readonly back: Effect.Effect<void>
	}
>()("hazel/app/Navigator") {}

/** Opens `route` in the app. */
export const openRoute = (navigator: Navigator["Service"], route: AppRoute) => navigator.open(hrefOf(route))

/** Whether `href` is one of the app's own paths, not another origin's URL. */
export const isAppHref = (href: string): boolean => href.startsWith("/") && !href.startsWith("//")
