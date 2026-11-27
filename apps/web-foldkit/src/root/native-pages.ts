// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Routes whose page is an Effect UI component (a native page): the shell draws it where the frame
 * shows the page, and the Foldkit host has no page for it. Converting a page is one entry here and
 * deleting its Foldkit page. Each page is `Component.lazy`, so it loads as its own chunk.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import type { Session } from "@hazel/shared-screens/app/session"
import { Option } from "effect"
import { canChooseServer, currentServer, isBuildServer, serverLabel } from "~/config/server"
import { safeReturnTo } from "../auth/return-to"
import { AppRoute, hrefOf, type RouteOf, signInHref } from "../route"
import type { AppMessage } from "./message"

// The `import()`s are the only references to the pages' modules: a static import undoes the split.
export const InvitePage = Component.lazy("InvitePage", () =>
	import("@hazel/shared-screens/auth/pages/invite/InvitePage").then((module) => module.InvitePage),
)

// The auth pages (PA1), each loaded with the web's `AuthFlows` (`auth/flows-layer.ts`).
const authFlows = () => import("../auth/flows-layer").then((module) => module.AuthFlowsLive)
export const SignInPage = Component.lazy("SignInPage", () =>
	Promise.all([import("@hazel/shared-screens/auth/pages/sign-in/SignInPage"), authFlows()]).then(
		([module, flows]) => module.SignInPage.pipe(Component.provide(flows)),
	),
)
export const RegisterPage = Component.lazy("RegisterPage", () =>
	Promise.all([import("@hazel/shared-screens/auth/pages/auth/register/RegisterPage"), authFlows()]).then(
		([module, flows]) => module.RegisterPage.pipe(Component.provide(flows)),
	),
)
export const ContinuePage = Component.lazy("ContinuePage", () =>
	Promise.all([import("@hazel/shared-screens/auth/pages/auth/continue/ContinuePage"), authFlows()]).then(
		([module, flows]) => module.ContinuePage.pipe(Component.provide(flows)),
	),
)
export const DesktopPage = Component.lazy("DesktopPage", () =>
	Promise.all([import("@hazel/shared-screens/auth/pages/auth/desktop/DesktopPage"), authFlows()]).then(
		([module, flows]) => module.DesktopPage.pipe(Component.provide(flows)),
	),
)

/** The native app's install (`~/config/server`), which its sign-in page can change; `null` on the web. */
const initialServer = () =>
	canChooseServer() ? { label: serverLabel(currentServer()), isDefault: isBuildServer(), form: null } : null

const signInRoute = AppRoute.SignIn({ redirectUrl: Option.none(), error: Option.none() })

/** What a native page reads: its route and the session, from the shell's Model. */
export interface NativeInputs<Tag extends AppRoute["_tag"]> {
	readonly route: RouteOf<Tag>
	readonly session: Session
	/** Shown while the page's chunk loads, and if the load fails. */
	readonly fallback: (failed: boolean) => View.Content<AppMessage, any>
}

type NativePage<Tag extends AppRoute["_tag"]> = (
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
) => View.Content<AppMessage, any>

type Registry = { readonly [Tag in AppRoute["_tag"]]?: NativePage<Tag> }

/** An auth-framed page fills the window, as today's `h-dvh` frame did (`centered` is `min-height: 100%`). */
const fillWindow =
	<Tag extends AppRoute["_tag"]>(page: NativePage<Tag>): NativePage<Tag> =>
	(h, inputs) =>
		h.div.class("h-dvh").children(page(h, inputs))

/** Keyed by what makes a new instance (Foldkit's page `key`): a new token mounts a fresh page. */
const nativePages: Registry = {
	Invite: fillWindow<"Invite">((h, { route, session, fallback }) =>
		InvitePage(h, {
			key: route.token,
			props: { token: route.token, session, signInHref: signInHref(hrefOf(route)) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	// One instance per mode, as today's page keyed by route tag.
	SignIn: fillWindow<"SignIn">((h, { route, fallback }) => {
		const redirectUrl = safeReturnTo(Option.getOrNull(route.redirectUrl))
		return SignInPage(h, {
			key: route._tag,
			props: {
				mode: "SignIn",
				redirectUrl,
				initialError: Option.getOrNull(route.error),
				switchHref: hrefOf(AppRoute.SignUp({ redirectUrl: Option.fromNullishOr(redirectUrl) })),
				initialServer: initialServer(),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		})
	}),
	SignUp: fillWindow<"SignUp">((h, { route, fallback }) => {
		const redirectUrl = safeReturnTo(Option.getOrNull(route.redirectUrl))
		return SignInPage(h, {
			key: route._tag,
			props: {
				mode: "SignUp",
				redirectUrl,
				initialError: null,
				switchHref: hrefOf(
					AppRoute.SignIn({ redirectUrl: Option.fromNullishOr(redirectUrl), error: Option.none() }),
				),
				initialServer: initialServer(),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		})
	}),
	AuthRegister: fillWindow<"AuthRegister">((h, { route, fallback }) =>
		RegisterPage(h, {
			key: hrefOf(route),
			props: {
				flowId: Option.getOrNull(route.flowId),
				reference: Option.getOrNull(route.reference),
				signInHref: hrefOf(signInRoute),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	AuthContinue: fillWindow<"AuthContinue">((h, { route, fallback }) =>
		ContinuePage(h, {
			key: hrefOf(route),
			props: { provider: Option.getOrNull(route.provider), signInHref: hrefOf(signInRoute) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	AuthDesktop: fillWindow<"AuthDesktop">((h, { route, session, fallback }) =>
		DesktopPage(h, {
			key: hrefOf(route),
			props: {
				attempt: Option.getOrNull(route.attempt),
				session,
				signInHref: signInHref(hrefOf(route)),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
}

/** The parity flag of a route's native page: `"0"` draws today's Foldkit page instead (`compare-pages.ts`). */
export const parityFlag = (tag: AppRoute["_tag"]) => `hazel:native:${tag}`

// The parity runner sets the flag before the app loads.
const forcedOff = (tag: AppRoute["_tag"]): boolean =>
	typeof localStorage !== "undefined" && localStorage.getItem(parityFlag(tag)) === "0"

export const isNativeRoute = (route: AppRoute): boolean =>
	nativePages[route._tag] !== undefined && !forcedOff(route._tag)

/** The route's native page, or null when the Foldkit host still draws it. */
export const nativePageOf = <Tag extends AppRoute["_tag"]>(
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
): View.Content<AppMessage, any> | null => {
	const page = nativePages[inputs.route._tag] as NativePage<Tag> | undefined
	return page === undefined || forcedOff(inputs.route._tag) ? null : page(h, inputs)
}
