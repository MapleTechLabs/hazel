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
import { Clipboard, ClipboardError } from "@hazel/client-data/platform"
import type { Session } from "@hazel/shared-screens/app/session"
import type { ChannelId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { canChooseServer, currentServer, isBuildServer, serverLabel } from "~/config/server"
import { clientData } from "~/db/client"
import { shareHost, shareOrigin } from "~/utils/share-origin"
import { agentRequestOf, installRequestOf } from "../auth/consent-requests"
import { forgetReturnTo, readReturnTo, safeReturnTo } from "../auth/return-to"
import { readLastOrganization } from "../data/last-organization"
import { hasUpdater, isDesktop } from "../platform/desktop"
import { rootRedirect } from "../redirect"
import { AppRoute, hrefOf, organizationRoute, type RouteOf, routeOfPath, signInHref } from "../route"
import { ShellDms } from "./children"
import { pickersWebLayer } from "./pickers"
import { AdoptRegion } from "./foldkit"
import { moreHrefsOf as moreHrefsOfShared } from "@hazel/shared-screens/org/pages/more/hrefs"
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

// Customers settings: Signals (PK7a). The editor holds its own state; PK7b fills its preview seam.
export const SignalsPage = Component.lazy("SignalsPage", () =>
	import("@hazel/shared-screens/customers/pages/settings/signals/SignalsPage").then((module) =>
		withClientData(module.SignalsPage),
	),
)
export const SignalRulePage = Component.lazy("SignalRulePage", () =>
	import("@hazel/shared-screens/customers/pages/settings/signals/SignalRulePage").then((module) =>
		withClientData(module.SignalRulePage),
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

// The Customers pages (PK1), each on the app's data instance.
export const CustomersOverviewPage = Component.lazy("CustomersOverviewPage", () =>
	import("@hazel/shared-screens/customers/pages/OverviewPage").then((module) =>
		withClientData(module.OverviewPage),
	),
)
export const SupportReportPage = Component.lazy("SupportReportPage", () =>
	import("@hazel/shared-screens/customers/pages/support/SupportReportPage").then(
		(module) => module.SupportReportPage,
	),
)

/**
 * A Customers page's column, as today's page drew it (`h-full overflow-y-auto`, then a centred
 * `max-w-*` column with `px-4 py-6 lg:px-8`): the frame's markup until a screen surface says it.
 */
// HAZEL-GAP(p4-screen-page-column): no primitive scrolls a page under a centred, padded column.
const customersColumn =
	<Tag extends AppRoute["_tag"]>(
		id: string,
		width: "max-w-6xl" | "max-w-7xl",
		page: NativePage<Tag>,
	): NativePage<Tag> =>
	(h, inputs) =>
		h.div
			.attr("data-native-page", id)
			.class("h-full overflow-y-auto")
			.children(h.div.class(`mx-auto w-full ${width} px-4 py-6 lg:px-8`).children(page(h, inputs)))

// Needs attention (PK2), with the web's queue keyboard and clipboard.
const customersQueueLayers = () =>
	Promise.all([import("../customers/queue-keyboard"), import("@hazel/client-data/web")]).then(
		([keyboard, web]) => Layer.mergeAll(keyboard.QueueKeyboardWeb, web.ClipboardWeb),
	)
export const AttentionPage = Component.lazy("AttentionPage", () =>
	Promise.all([
		import("@hazel/shared-screens/customers/pages/attention/AttentionPage"),
		customersQueueLayers(),
	]).then(([module, layers]) => withClientData(module.AttentionPage).pipe(Component.provide(layers))),
)

/** The browser's clipboard, for pages that copy (PK5's customer page). */
const webClipboard = Layer.succeed(Clipboard, {
	write: (text) =>
		Effect.tryPromise({
			try: () => navigator.clipboard.writeText(text),
			catch: () => new ClipboardError({ reason: "denied" }),
		}),
})

export const CustomerDetailPage = Component.lazy("CustomerDetailPage", () =>
	import("@hazel/shared-screens/customers/pages/CustomerDetailPage").then((module) =>
		withClientData(module.CustomerDetailPage).pipe(Component.provide(webClipboard)),
	),
)

export const CustomersSourcesPage = Component.lazy("CustomersSourcesPage", () =>
	import("@hazel/shared-screens/customers/pages/settings/sources/SourcesPage").then((module) =>
		withClientData(module.SourcesPage),
	),
)

// PA2: the pages that borrow the auth frame (join, OAuth consent, bot install).
export const JoinPage = Component.lazy("JoinPage", () =>
	import("@hazel/shared-screens/auth/pages/join/JoinPage").then((module) => module.JoinPage),
)
export const OAuthAuthorizePage = Component.lazy("OAuthAuthorizePage", () =>
	Promise.all([
		import("@hazel/shared-screens/auth/pages/oauth/authorize/OAuthAuthorizePage"),
		import("../auth/agent-access-layer"),
	]).then(([module, access]) => module.OAuthAuthorizePage.pipe(Component.provide(access.AgentAccessLive))),
)
export const BotInstallPage = Component.lazy("BotInstallPage", () =>
	import("@hazel/shared-screens/auth/pages/oauth/bot-install/BotInstallPage").then((module) =>
		withClientData(module.BotInstallPage),
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

/** A push of `route` on the shell's Router, from a page's host callback. */
const withPush = <A, E, R>(build: (push: (route: AppRoute) => void) => Layer.Layer<A, E, R>) =>
	Layer.unwrap(
		Effect.map(Effect.service(Router.Router), (router) =>
			build((route) => {
				Effect.runFork(router.push(route))
			}),
		),
	)

// The inbox (PA5): its shared wiring (`notifications/hosted`) on the web's Router and data.
export const NotificationsPage = Component.lazy("NotificationsPage", () =>
	Promise.all([import("@hazel/shared-screens/notifications/hosted"), import("./navigator")]).then(
		([page, navigator]) =>
			Component.provide(
				page.HostedNotificationsPage,
				Layer.mergeAll(navigator.navigatorWeb, Layer.succeed(ClientData, clientData)),
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

export const ProfilePage = Component.lazy("ProfilePage", () =>
	import("@hazel/shared-screens/org/pages/profile/ProfilePage").then((module) =>
		withClientData(module.ProfilePage),
	),
)

// The organization picker (PA5): PH1's switcher query and `SwitchOrganization`, and the create form.
export const SelectOrganizationPage = Component.lazy("SelectOrganizationPage", () =>
	Promise.all([
		import("@hazel/shared-screens/org/pages/select-organization/SelectOrganizationPage"),
		import("@hazel/shared-screens/org/components/CreateWorkspace"),
		import("@hazel/shared-screens/shell/Chrome"),
	]).then(([page, create, chrome]) =>
		Component.provide(page.SelectOrganizationPage, (props) =>
			Layer.mergeAll(
				Layer.succeed(ClientData, clientData),
				create.CreateOrganization.layer,
				withPush((push) =>
					chrome.SwitchOrganization.layerWith((id, slug) =>
						push(organizationRoute({ id, slug }, { isMobile: props.isMobile })),
					),
				),
			),
		),
	),
)

// The member directory (PA5): DMs are found in the synced rows; email copies through the clipboard.
export const HomePage = Component.lazy("HomePage", () =>
	Promise.all([
		import("@hazel/shared-screens/org/pages/HomePage"),
		import("@hazel/client-data/web/ui-services"),
	]).then(([page, web]) =>
		Component.provide(
			page.HomePage,
			Layer.mergeAll(page.FindMemberDm.layer, page.CopyEmail.layer).pipe(
				Layer.provideMerge(Layer.mergeAll(Layer.succeed(ClientData, clientData), web.ClipboardWeb)),
			),
		),
	),
)

/** The native app's install (`~/config/server`), which its sign-in page can change; `null` on the web. */
const initialServer = () =>
	canChooseServer() ? { label: serverLabel(currentServer()), isDefault: isBuildServer(), form: null } : null

const signInRoute = AppRoute.SignIn({ redirectUrl: Option.none(), error: Option.none() })

// The Customers settings pages (PK8), each on the app's data.
export const CustomersSettingsPlansPage = Component.lazy("CustomersSettingsPlansPage", () =>
	import("@hazel/shared-screens/customers/pages/settings/plans/PlansPage").then((module) =>
		withClientData(module.PlansPage),
	),
)
export const CustomersSettingsFeatureFlagsPage = Component.lazy("CustomersSettingsFeatureFlagsPage", () =>
	import("@hazel/shared-screens/customers/pages/settings/feature-flags/FeatureFlagsPage").then((module) =>
		withClientData(module.FeatureFlagsPage),
	),
)
export const CustomersSettingsSlaPage = Component.lazy("CustomersSettingsSlaPage", () =>
	import("@hazel/shared-screens/customers/pages/settings/sla/SlaPage").then((module) =>
		withClientData(module.SlaPage),
	),
)

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

// HAZEL-GAP(p4-section-scroll-column): today's customers settings page scrolls itself in a centred
// `max-w-6xl` column (`settingsPage`); PH2's customers layout takes this over.
const customersSettingsColumn =
	<Tag extends AppRoute["_tag"]>(page: NativePage<Tag>): NativePage<Tag> =>
	(h, inputs) =>
		h.div
			.class("h-full overflow-y-auto")
			.children(
				h.div
					.class("mx-auto flex w-full max-w-6xl flex-col px-4 py-6 lg:px-8")
					.children(page(h, inputs)),
			)

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
	OrgHome: (h, { route, session, isMobile, fallback }) =>
		HomePage(h, {
			key: route.orgSlug,
			props: { session, isMobile },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	SelectOrganization: fillWindow<"SelectOrganization">((h, { session, isMobile, fallback }) =>
		SelectOrganizationPage(h, {
			key: "select-organization",
			props: {
				session,
				isMobile,
				createHref: hrefOf(AppRoute.OnboardingSetupOrganization({ orgId: Option.none() })),
				shareHost: shareHost(),
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
	Profile: (h, { route, session, fallback }) =>
		ProfilePage(h, {
			key: route.userId,
			props: {
				userId: route.userId,
				session,
				editHref: hrefOf(AppRoute.MySettingsProfile({ orgSlug: route.orgSlug })),
			},
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	OrgMore: (h, { route, session, fallback }) =>
		MorePage(h, {
			key: route.orgSlug,
			props: { session, hrefs: moreHrefsOfShared(route.orgSlug) },
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
	// The list, and `/new` with the picker open (its own instance, so the picker opens with it).
	CustomersSettingsSignals: (h, { route, session, nowMs, fallback }) =>
		SignalsPage(h, {
			key: route.orgSlug,
			props: { session, pickerOpen: false, nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	CustomersSettingsSignalNew: (h, { route, session, nowMs, fallback }) =>
		Option.match(route.template, {
			onNone: () =>
				SignalsPage(h, {
					key: `${route.orgSlug}:new`,
					props: { session, pickerOpen: true, nowMs },
					fallback: (result) => fallback(result._tag === "Failure"),
				}),
			onSome: (template) =>
				SignalRulePage(h, {
					key: route.orgSlug,
					props: { session, ruleId: null, template, nowMs },
					fallback: (result) => fallback(result._tag === "Failure"),
				}),
		}),
	CustomersSettingsSignalRule: (h, { route, session, nowMs, fallback }) =>
		SignalRulePage(h, {
			key: route.orgSlug,
			props: { session, ruleId: route.ruleId, template: null, nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	CustomersSettingsPlans: customersSettingsColumn<"CustomersSettingsPlans">(
		(h, { route, session, fallback }) =>
			CustomersSettingsPlansPage(h, {
				key: route.orgSlug,
				props: { session },
				fallback: (result) => fallback(result._tag === "Failure"),
			}),
	),
	CustomersSettingsFeatureFlags: customersSettingsColumn<"CustomersSettingsFeatureFlags">(
		(h, { route, session, fallback }) =>
			CustomersSettingsFeatureFlagsPage(h, {
				key: route.orgSlug,
				props: { session },
				fallback: (result) => fallback(result._tag === "Failure"),
			}),
	),
	CustomersSettingsSla: customersSettingsColumn<"CustomersSettingsSla">((h, { route, session, fallback }) =>
		CustomersSettingsSlaPage(h, {
			key: route.orgSlug,
			props: { session },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
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
	// One instance per org, as today's page keyed by its whole route.
	CustomersAttention: (h, { route, session, nowMs, fallback }) =>
		AttentionPage(h, {
			key: route.orgSlug,
			props: { session, nowMs },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	// The shell is native; until PK6a and PK6b the tab's content is the Foldkit page's, adopted
	// into the page's `tab` slot. One instance per account: a tab change keeps it.
	CustomerDetail: (h, { route, session, isMobile, nowMs, fallback }) =>
		CustomerDetailPage(h, {
			key: `${route.orgSlug}:${route.accountId}`,
			props: {
				accountId: route.accountId,
				tab: Option.getOrElse(route.tab, () => "overview" as const),
				session,
				isMobile,
				nowMs,
			},
			slots: { tab: h.div.class("contents").onMount(AdoptRegion({ region: "page" })) },
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
	// Customers (PK1): one instance per org, inside the Customers layout's page region.
	CustomersOverview: customersColumn<"CustomersOverview">(
		"customers-overview",
		"max-w-6xl",
		(h, { route, session, isMobile, nowMs, fallback }) =>
			CustomersOverviewPage(h, {
				key: route.orgSlug,
				props: { session, isMobile, nowMs },
				fallback: (result) => fallback(result._tag === "Failure"),
			}),
	),
	CustomersSupportReport: customersColumn<"CustomersSupportReport">(
		"customers-support",
		"max-w-7xl",
		(h, { route, session, isMobile, fallback }) =>
			SupportReportPage(h, {
				key: route.orgSlug,
				props: { session, isMobile },
				fallback: (result) => fallback(result._tag === "Failure"),
			}),
	),
	// Customers settings: drawn in the customers frame (its sidebar is the host's, PH2).
	CustomersSettingsSources: (h, { route, session, nowMs, fallback }) =>
		CustomersSourcesPage(h, {
			key: route.orgSlug,
			props: { session, nowMs, canSeedDemo: import.meta.env.DEV },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	Join: fillWindow<"Join">((h, { route, session, fallback }) =>
		JoinPage(h, {
			key: route.slug,
			props: { slug: route.slug, session, signInHref: signInHref(hrefOf(route)) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	OAuthAuthorize: fillWindow<"OAuthAuthorize">((h, { route, session, fallback }) =>
		OAuthAuthorizePage(h, {
			key: hrefOf(route),
			props: { request: agentRequestOf(route), session, signInHref: signInHref(hrefOf(route)) },
			fallback: (result) => fallback(result._tag === "Failure"),
		}),
	),
	BotInstall: fillWindow<"BotInstall">((h, { route, session, fallback }) =>
		BotInstallPage(h, {
			key: hrefOf(route),
			props: { request: installRequestOf(route), session, signInHref: signInHref(hrefOf(route)) },
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
