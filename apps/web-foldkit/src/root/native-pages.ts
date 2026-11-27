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
import { shareOrigin } from "~/utils/share-origin"
import { safeReturnTo } from "../auth/return-to"
import { hasUpdater, isDesktop } from "../platform/desktop"
import { AppRoute, hrefOf, type RouteOf, signInHref } from "../route"
import { ShellDms } from "./children"
import { pickersWebLayer } from "./pickers"
import type { AppMessage } from "./message"
import type { ThemePreference } from "../theme"
import type { SoundSettings } from "../notification-sound"
import type { DesktopUpdate } from "@hazel/shared-screens/my-settings/platform"

// The `import()`s are the only references to the pages' modules: a static import undoes the split.
export const InvitePage = Component.lazy("InvitePage", () =>
	import("@hazel/shared-screens/auth/pages/invite/InvitePage").then((module) => module.InvitePage),
)

// The channel settings tabs (PS8); the section layout around them is `sections.ts`'s.
export const ChannelSettingsRedirectPage = Component.lazy("ChannelSettingsRedirectPage", () =>
	import("@hazel/shared-screens/channel-settings/pages/RedirectPage").then((module) => module.RedirectPage),
)
export const ChannelSettingsOverviewPage = Component.lazy("ChannelSettingsOverviewPage", () =>
	// The icon's emoji picker reads the web's storage and emoji CDN (`pickers.ts`).
	import("@hazel/shared-screens/channel-settings/pages/overview/OverviewPage").then((module) =>
		withClientData(Component.provide(module.OverviewPage, pickersWebLayer)),
	),
)
export const ChannelSettingsConnectPage = Component.lazy("ChannelSettingsConnectPage", () =>
	import("@hazel/shared-screens/channel-settings/pages/connect/ConnectPage").then((module) =>
		withClientData(module.ConnectPage),
	),
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

// Chat sync (PS3): its page and the migration wizard over the web's chat sync hosts.
export const ChatSyncPage = Component.lazy("ChatSyncPage", () =>
	Promise.all([
		import("@hazel/shared-screens/settings/pages/chat-sync/ChatSyncPage"),
		import("../chat-sync/backend"),
	]).then(([module, backend]) =>
		withClientData(module.ChatSyncPage.pipe(Component.provide(backend.chatSyncWebLayer))),
	),
)

// The organization settings pages (PS1), loaded together with their browser Layers.
const settingsPages = () => import("./settings-pages")
export const SettingsTeamPage = Component.lazy("SettingsTeamPage", () =>
	settingsPages().then((module) => module.SettingsTeamPage),
)
export const SettingsInvitationsPage = Component.lazy("SettingsInvitationsPage", () =>
	settingsPages().then((module) => module.SettingsInvitationsPage),
)
export const SettingsGeneralPage = Component.lazy("SettingsGeneralPage", () =>
	settingsPages().then((module) => module.SettingsGeneralPage),
)
export const SettingsDebugPage = Component.lazy("SettingsDebugPage", () =>
	settingsPages().then((module) => module.SettingsDebugPage),
)

// Settings: Groups, Custom emojis, Connect invites (PS2), inside the native settings layout.
export const SettingsGroupsPage = Component.lazy("SettingsGroupsPage", () =>
	import("@hazel/shared-screens/settings/pages/groups/GroupsPage").then((module) =>
		withClientData(module.GroupsPage),
	),
)

export const SettingsCustomEmojisPage = Component.lazy("SettingsCustomEmojisPage", () =>
	Promise.all([
		import("@hazel/shared-screens/settings/pages/custom-emojis/CustomEmojisPage"),
		import("./emoji-files"),
	]).then(([module, files]) =>
		withClientData(Component.provide(module.CustomEmojisPage, files.emojiFilesLayer)),
	),
)

export const SettingsConnectInvitesPage = Component.lazy("SettingsConnectInvitesPage", () =>
	import("@hazel/shared-screens/settings/pages/connect-invites/ConnectInvitesPage").then((module) =>
		withClientData(module.ConnectInvitesPage),
	),
)

// Settings: Integrations (PS5a); the settings layout (`sections.ts`) wraps each.
export const IntegrationsPage = Component.lazy("IntegrationsPage", () =>
	import("@hazel/shared-screens/settings/pages/integrations/IntegrationsPage").then((module) =>
		withClientData(module.IntegrationsPage),
	),
)
export const InstalledAppsPage = Component.lazy("InstalledAppsPage", () =>
	import("@hazel/shared-screens/settings/pages/integrations/installed/InstalledAppsPage").then((module) =>
		withClientData(module.InstalledAppsPage),
	),
)
export const MarketplacePage = Component.lazy("MarketplacePage", () =>
	import("@hazel/shared-screens/settings/pages/integrations/marketplace/MarketplacePage").then((module) =>
		withClientData(module.MarketplacePage),
	),
)
export const YourAppsPage = Component.lazy("YourAppsPage", () =>
	import("@hazel/shared-screens/settings/pages/integrations/your-apps/YourAppsPage").then((module) =>
		withClientData(module.YourAppsPage),
	),
)

// My settings (PS6): the theme cards' web drawing loads with Appearance.
export const MySettingsAppearancePage = Component.lazy("MySettingsAppearancePage", () =>
	Promise.all([
		import("@hazel/shared-screens/my-settings/pages/appearance/AppearancePage"),
		import("../my-settings/theme-preview-extension"),
	]).then(([module]) => module.AppearancePage),
)

export const MySettingsNotificationsPage = Component.lazy("MySettingsNotificationsPage", () =>
	Promise.all([
		import("@hazel/shared-screens/my-settings/pages/notifications/NotificationsPage"),
		import("../my-settings/platform"),
	]).then(([module, platform]) =>
		withClientData(module.NotificationsPage.pipe(Component.provide(platform.notificationPreviewsLayer))),
	),
)

export const MySettingsDesktopPage = Component.lazy("MySettingsDesktopPage", () =>
	Promise.all([
		import("@hazel/shared-screens/my-settings/pages/desktop/DesktopPage"),
		import("../my-settings/platform"),
	]).then(([module, platform]) =>
		module.DesktopSettingsPage.pipe(Component.provide(platform.desktopAppLayer)),
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
	/** The shell's phone layout (`(max-width: 767px)`), and its clock. */
	readonly isMobile: boolean
	readonly nowMs: number
	/** The app's theme and notification sounds, which my settings change through the app (PS6). */
	readonly theme: ThemePreference
	readonly soundSettings: SoundSettings
	/** The desktop app's update state, as the Foldkit host reports it (PS6). */
	readonly desktopUpdate: DesktopUpdate
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

/**
 * A settings page's column (today's `pageLayout`): the cards 24px apart in the app's side gutter,
 * as `sections.ts` draws it for the integration pages.
 */
// HAZEL-GAP(p4-section-scroll-column): the gutter is the frame's own markup, no primitive pads only the sides.
const settingsColumn =
	<Tag extends AppRoute["_tag"]>(page: NativePage<Tag>): NativePage<Tag> =>
	(h, inputs) =>
		h.div.class("flex flex-col gap-6 px-4 lg:px-8").children(page(h, inputs))

// HAZEL-GAP(p4-section-scroll-column): a section page's side gutter (today's `pageLayout`,
// `px-4 lg:px-8`) is the frame's markup, as the channel settings header's in `sections.ts`.
const sectionGutter =
	<Tag extends AppRoute["_tag"]>(page: NativePage<Tag>): NativePage<Tag> =>
	(h, inputs) =>
		h.div.class("px-4 lg:px-8").children(page(h, inputs))

/** Keyed by what makes a new instance (Foldkit's page `key`): a new token mounts a fresh page. */
const nativePages: Registry = {
	ChannelSettings: (h, { route }) =>
		ChannelSettingsRedirectPage(h, {
			key: route.channelId,
			props: {
				overviewHref: hrefOf(
					AppRoute.ChannelSettingsOverview({ orgSlug: route.orgSlug, channelId: route.channelId }),
				),
			},
		}),
	ChannelSettingsOverview: sectionGutter<"ChannelSettingsOverview">((h, { route, session, fallback }) =>
		ChannelSettingsOverviewPage(h, {
			key: route.channelId,
			props: {
				channelId: route.channelId,
				session,
				// The customer's page is this prefix and its account id (`CustomerDetail`).
				customerHrefPrefix: `${hrefOf(AppRoute.CustomersOverview({ orgSlug: route.orgSlug }))}/`,
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	ChannelSettingsConnect: sectionGutter<"ChannelSettingsConnect">((h, { route, session, fallback }) =>
		ChannelSettingsConnectPage(h, {
			key: route.channelId,
			props: { channelId: route.channelId, session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
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
	TeamSettings: settingsColumn<"TeamSettings">((h, { route, session, fallback }) =>
		SettingsTeamPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	SettingsInvitations: settingsColumn<"SettingsInvitations">((h, { route, session, fallback }) =>
		SettingsInvitationsPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	SettingsGeneral: settingsColumn<"SettingsGeneral">((h, { route, session, nowMs, fallback }) =>
		SettingsGeneralPage(h, {
			key: route.orgSlug,
			props: { session, orgSlug: route.orgSlug, origin: shareOrigin(), nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	SettingsDebug: (h, { route, fallback }) =>
		SettingsDebugPage(h, {
			key: route.orgSlug,
			props: {
				production: import.meta.env.PROD,
				generalHref: hrefOf(AppRoute.SettingsGeneral({ orgSlug: route.orgSlug })),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
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
	// Keyed by organization: another workspace mounts a fresh page.
	SettingsChatSync: (h, { route, session, fallback }) =>
		session.organization === null
			? fallback(false)
			: ChatSyncPage(h, {
					key: session.organization.id,
					props: { organizationId: session.organization.id, orgSlug: route.orgSlug },
					fallback: (result) => fallback(result._tag === "Failure"),
				}),
	SettingsGroups: (h, { route, session, fallback }) =>
		SettingsGroupsPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsIntegrations: (h, { route, session, fallback }) =>
		IntegrationsPage(h, {
			key: route.orgSlug,
			props: { orgSlug: route.orgSlug, session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsIntegrationsInstalled: (h, { route, session, fallback }) =>
		InstalledAppsPage(h, {
			key: route.orgSlug,
			props: { orgSlug: route.orgSlug, session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsIntegrationsMarketplace: (h, { route, session, fallback }) =>
		MarketplacePage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsCustomEmojis: (h, { route, session, nowMs, fallback }) =>
		SettingsCustomEmojisPage(h, {
			key: route.orgSlug,
			props: { session, nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsConnectInvites: (h, { route, session, fallback }) =>
		SettingsConnectInvitesPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SettingsIntegrationsYourApps: (h, { route, session, fallback }) =>
		YourAppsPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	MySettingsAppearance: (h, { route, theme, fallback }) =>
		MySettingsAppearancePage(h, {
			key: route.orgSlug,
			props: { theme },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	MySettingsNotifications: (h, { route, session, soundSettings, nowMs, fallback }) =>
		MySettingsNotificationsPage(h, {
			key: route.orgSlug,
			props: { session, soundSettings, nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	MySettingsDesktop: (h, { route, desktopUpdate, fallback }) =>
		MySettingsDesktopPage(h, {
			key: route.orgSlug,
			props: { hasAutostart: isDesktop, hasUpdates: hasUpdater, update: desktopUpdate },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
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
