// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Routes whose page is an Effect UI component (a native page): the shell draws it where the frame
 * shows the page, and the Foldkit host has no page for it. Converting a page is one entry here and
 * deleting its Foldkit page. Each page is `Component.lazy`, so it loads as its own chunk.
 */
import { Component, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { ClientData } from "@hazel/client-data"
import type { Session } from "@hazel/shared-screens/app/session"
import { Layer, Option } from "effect"
import { canChooseServer, currentServer, isBuildServer, serverLabel } from "~/config/server"
import { clientData } from "~/db/client"
import { safeReturnTo } from "../auth/return-to"
import { AppRoute, hrefOf, type RouteOf, signInHref } from "../route"
import { ShellDms } from "./children"
import { AdoptRegion } from "./foldkit"
import type { AppMessage } from "./message"

// The `import()`s are the only references to the pages' modules: a static import undoes the split.
export const InvitePage = Component.lazy("InvitePage", () =>
	import("@hazel/shared-screens/auth/pages/invite/InvitePage").then((module) => module.InvitePage),
)

/** The app's one data instance, for pages that run live queries. */
const withClientData = <C extends Component.Any>(component: C) =>
	Component.provide(component, Layer.succeed(ClientData, clientData))

export const ChatIndexPage = Component.lazy("ChatIndexPage", () =>
	import("@hazel/shared-screens/chat/pages/ChatIndexPage").then((module) =>
		withClientData(module.ChatIndexPage),
	),
)

export const ChatDmsPage = Component.lazy("ChatDmsPage", () =>
	import("@hazel/shared-screens/chat/pages/dms/ChatDmsPage").then((module) =>
		withClientData(module.ChatDmsPage),
	),
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

// Onboarding (PA3): the flow and its first steps; the later steps are still the Foldkit page's.
export const OnboardingPage = Component.lazy("OnboardingPage", () =>
	import("@hazel/shared-screens/onboarding/pages/onboarding/OnboardingPage").then((module) =>
		withClientData(module.OnboardingPage),
	),
)

/** The Foldkit onboarding page's region, moved into the shell's `legacyStep` slot (until PA4). */
const legacyOnboardingStep = (h: Html.H<AppMessage>) =>
	h.div
		.class("contents")
		.attr("data-foldkit-slot", "page")
		.onMount(AdoptRegion({ region: "page" }))

/** The native app's install (`~/config/server`), which its sign-in page can change; `null` on the web. */
const initialServer = () =>
	canChooseServer() ? { label: serverLabel(currentServer()), isDefault: isBuildServer(), form: null } : null

const signInRoute = AppRoute.SignIn({ redirectUrl: Option.none(), error: Option.none() })

/** What a native page reads: its route and the session, from the shell's Model. */
export interface NativeInputs<Tag extends AppRoute["_tag"]> {
	readonly route: RouteOf<Tag>
	readonly session: Session
	/** The shell's phone layout (`(max-width: 767px)`), and its clock. */
	readonly isMobile: boolean
	readonly nowMs: number
	/** Shown while the page's chunk loads, and if the load fails. */
	readonly fallback: (failed: boolean) => View.Content<AppMessage, any>
}

type NativePage<Tag extends AppRoute["_tag"]> = (
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
) => View.Content<AppMessage, any> | null

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
	// A phone shows the shell's channel list here (`app/view.ts`), so only a wide screen is native.
	ChatIndex: (h, { route, session, isMobile, fallback }) =>
		isMobile
			? null
			: ChatIndexPage(h, {
					key: route.orgSlug,
					props: { session },
					fallback: (result) => fallback(result._tag === "Failure"),
				}),
	// The phone's DMs tab is the shared DMs screen; a wide screen the cards page.
	ChatDms: (h, { route, session, isMobile, nowMs, fallback }) => {
		const { organization, user } = session
		if (!isMobile)
			return ChatDmsPage(h, {
				key: route.orgSlug,
				props: { session },
				fallback: (result) => fallback(result._tag === "Failure"),
			})
		return organization === null || user === null
			? fallback(false)
			: // As today's hole: the screen keeps its content's height, so compose follows the last row.
				h.div.children(
					ShellDms(h, {
						key: `${organization.id}:${user.id}`,
						props: {
							organizationId: organization.id,
							userId: user.id,
							orgSlug: route.orgSlug,
							nowMs,
						},
					}),
				)
	},
	// One instance per visit; `?step=` changes reach it as props.
	Onboarding: fillWindow<"Onboarding">((h, { route, session, fallback }) =>
		OnboardingPage(h, {
			key: route._tag,
			props: {
				session,
				urlStep: Option.getOrNull(route.step),
				orgId: Option.getOrNull(route.orgId),
			},
			slots: { legacyStep: legacyOnboardingStep(h) },
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

/** The route's native page, or null when the Foldkit host still draws it (also at a size a page leaves to it). */
export const nativePageOf = <Tag extends AppRoute["_tag"]>(
	h: Html.H<AppMessage>,
	inputs: NativeInputs<Tag>,
): View.Content<AppMessage, any> | null => {
	const page = nativePages[inputs.route._tag] as NativePage<Tag> | undefined
	return page === undefined || forcedOff(inputs.route._tag) ? null : page(h, inputs)
}
