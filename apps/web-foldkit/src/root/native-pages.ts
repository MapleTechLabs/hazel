// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Routes whose page is an Effect UI component (a native page): the shell draws it where the frame
 * shows the page, and the Foldkit host has no page for it. Converting a page is one entry here and
 * deleting its Foldkit page. Each page is `Component.lazy`, so it loads as its own chunk.
 */
import { Component, Router, type View } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { ClientData, HazelRpc } from "@hazel/client-data"
import type { Session } from "@hazel/shared-screens/app/session"
import type { ChannelId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { canChooseServer, currentServer, isBuildServer, serverLabel } from "~/config/server"
import { clientData } from "~/db/client"
import { forgetReturnTo, readReturnTo, safeReturnTo } from "../auth/return-to"
import { readLastOrganization } from "../data/last-organization"
import { rootRedirect } from "../redirect"
import { AppRoute, hrefOf, type RouteOf, routeOfPath, signInHref } from "../route"
import { ShellDms } from "./children"
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

/** A push of `route` on the shell's Router, from a page's host callback. */
const withPush = <A, E, R>(build: (push: (route: AppRoute) => void) => Layer.Layer<A, E, R>) =>
	Layer.unwrap(
		Effect.map(Effect.service(Router.Router), (router) =>
			build((route) => {
				Effect.runFork(router.push(route))
			}),
		),
	)

// The inbox (PA5): Activity's rows open their channel on the Router; Unreads marks read over RPC.
export const NotificationsPage = Component.lazy("NotificationsPage", () =>
	Promise.all([
		import("@hazel/shared-screens/notifications/pages/NotificationsPage"),
		import("@hazel/shared-screens/activity/Activity"),
	]).then(([page, activity]) =>
		Component.provide(page.NotificationsPage, (props) =>
			Layer.unwrap(
				Effect.map(Effect.service(HazelRpc), (rpc) =>
					withPush((push) =>
						Layer.mergeAll(page.MarkChannelRead.layer, page.MarkAllChannelsRead.layer).pipe(
							Layer.provideMerge(
								activity.activityLayer(clientData, rpc, (channelId: ChannelId) =>
									push(
										AppRoute.ChatChannel({
											orgSlug: props.session.orgSlug ?? "",
											channelId,
										}),
									),
								),
							),
						),
					),
				),
			),
		),
	),
)

/** `/` (PA5): this device's remembered page and organization, and the redirect on the shell's Router. */
export const RootPage = Component.lazy("RootPage", () =>
	import("@hazel/shared-screens/org/pages/RootPage").then((page) =>
		Component.provide(
			page.RootPage,
			Layer.mergeAll(
				Layer.succeed(ClientData, clientData),
				page.ReadRootRemembered.layerWith(
					Effect.all({ returnTo: readReturnTo, lastOrganizationId: readLastOrganization }),
				),
				Layer.unwrap(
					Effect.map(Effect.service(Router.Router), (router) =>
						page.RedirectFromRoot.toLayer(
							Effect.succeed(({ returnTo, isOnboarded, membership, isMobile }) => {
								const isReturn = returnTo !== null && isOnboarded
								const route = isReturn
									? routeOfPath(returnTo)
									: rootRedirect({ isOnboarded }, Option.fromNullishOr(membership), {
											isMobile,
										})
								return (isReturn ? forgetReturnTo : Effect.void).pipe(
									Effect.andThen(router.replace(route)),
									Effect.as(Component.noop),
								)
							}),
						),
					),
				),
			),
		),
	),
)

export const MorePage = Component.lazy("MorePage", () =>
	import("@hazel/shared-screens/org/pages/more/MorePage").then((module) => module.MorePage),
)

/** The More tab's rows (PA5). */
const moreHrefsOf = (orgSlug: string) => ({
	profile: hrefOf(AppRoute.MySettingsProfile({ orgSlug })),
	customers: hrefOf(AppRoute.CustomersOverview({ orgSlug })),
	members: hrefOf(AppRoute.OrgHome({ orgSlug })),
	invite: hrefOf(AppRoute.SettingsInvitations({ orgSlug })),
	workspaceSettings: hrefOf(AppRoute.SettingsGeneral({ orgSlug })),
	notifications: hrefOf(AppRoute.MySettingsNotifications({ orgSlug })),
	appearance: hrefOf(AppRoute.MySettingsAppearance({ orgSlug })),
	switchWorkspace: hrefOf(AppRoute.SelectOrganization()),
})

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

/** The inbox's tabs share one instance per org; the former per-source tabs show All until redirected. */
const inbox =
	<Tag extends AppRoute["_tag"]>(tab: "mentions" | "unreads" | "all"): NativePage<Tag> =>
	(h, { route, session, isMobile, nowMs, fallback }) =>
		NotificationsPage(h, {
			key: "orgSlug" in route ? String(route.orgSlug) : route._tag,
			props: { session, tab, nowMs, isMobile },
			fallback: (result) => fallback(result._tag === "Failure"),
		})

/** Keyed by what makes a new instance (Foldkit's page `key`): a new token mounts a fresh page. */
const nativePages: Registry = {
	OrgMore: (h, { route, session, fallback }) =>
		MorePage(h, {
			key: route.orgSlug,
			props: { session, hrefs: moreHrefsOf(route.orgSlug) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	Root: (h, { session, isMobile, fallback }) =>
		RootPage(h, {
			key: "root",
			props: { session, isMobile },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	NotificationsMentions: inbox("mentions"),
	NotificationsUnreads: inbox("unreads"),
	NotificationsAll: inbox("all"),
	NotificationsGeneral: inbox("all"),
	NotificationsThreads: inbox("all"),
	NotificationsDms: inbox("all"),
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
