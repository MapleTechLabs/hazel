/**
 * The app's routes: the shared table (`@hazel/shared-screens/app/route`, on Effect UI's `Route`), which
 * the native app uses too, and the web's helpers over it.
 */
import type { ChannelId, CustomerAccountId, OrganizationId } from "@hazel/schema"
import { Match, Option } from "effect"
import type { Url } from "foldkit/url"
import { AppRoute, type CustomerTab, hrefOf, orgSlugOf, routeOfPath } from "@hazel/shared-screens/app/route"

export {
	AppRoute,
	CustomerTab,
	hrefOf,
	orgSlugOf,
	pathOf,
	routeOfPath,
	type RouteOf,
	type RouteTag,
} from "@hazel/shared-screens/app/route"

/** The route of a parsed URL (Foldkit's `Url`, the web's navigation). */
export const urlToAppRoute = (url: Url): AppRoute =>
	routeOfPath(
		`${url.pathname}${Option.match(url.search, {
			onNone: () => "",
			onSome: (search) => (search === "" || search.startsWith("?") ? search : `?${search}`),
		})}`,
	)

/** Routes outside `/_app`, which legacy renders without the signed-in gate. */
export const isPublicRoute = AppRoute.isAnyOf([
	"SignIn",
	"SignUp",
	"AuthRegister",
	"AuthContinue",
	"AuthDesktop",
	"Join",
	"Invite",
	"BotInstall",
	"OAuthAuthorize",
	"NotFound",
])

/** `/$orgSlug/settings/*`. */
export const isSettingsRoute = AppRoute.isAnyOf([
	"SettingsGeneral",
	"TeamSettings",
	"SettingsGroups",
	"SettingsInvitations",
	"SettingsCustomEmojis",
	"SettingsDebug",
	"SettingsConnectInvites",
	"SettingsChatSync",
	"SettingsChatSyncConnection",
	"SettingsIntegrations",
	"SettingsIntegrationsInstalled",
	"SettingsIntegrationsMarketplace",
	"SettingsIntegrationsYourApps",
	"SettingsIntegration",
])

/** `/$orgSlug/my-settings/*`. */
export const isMySettingsRoute = AppRoute.isAnyOf([
	"MySettingsAppearance",
	"MySettingsProfile",
	"MySettingsAgents",
	"MySettingsLinkedAccounts",
	"MySettingsNotifications",
	"MySettingsDesktop",
	"MySettingsKeybinds",
])

/** `/$orgSlug/notifications/*`. */
export const isNotificationsRoute = AppRoute.isAnyOf([
	"NotificationsMentions",
	"NotificationsUnreads",
	"NotificationsAll",
	"NotificationsGeneral",
	"NotificationsThreads",
	"NotificationsDms",
])

/** `/$orgSlug/customers/*`: the Customers area, with its own secondary sidebar. */
export const isCustomersRoute = AppRoute.isAnyOf([
	"CustomersOverview",
	"CustomersAttention",
	"CustomersInbox",
	"CustomersSupportReport",
	"CustomersList",
	"CustomerDetail",
	"CustomersSettingsSignals",
	"CustomersSettingsSignalNew",
	"CustomersSettingsSignalRule",
	"CustomersSettingsPlans",
	"CustomersSettingsSla",
	"CustomersSettingsFeatureFlags",
	"CustomersSettingsSources",
	"CustomersSourceDetail",
	"CustomersUnmatched",
])

/** `/$orgSlug/chat/$channelId/*`: a channel's messages, files or media. */
export const isChannelChatRoute = AppRoute.isAnyOf(["ChatChannel", "ChatFiles", "ChatFilesMedia"])

/** `/$orgSlug/chat` and everything below it. */
export const isChatRoute = AppRoute.isAnyOf([
	"ChatIndex",
	"ChatDms",
	"ChatChannel",
	"ChatFiles",
	"ChatFilesMedia",
])

/** The integration and chat sync pages, which sit in a narrower content column. */
export const hasContentColumn = AppRoute.isAnyOf([
	"SettingsIntegrations",
	"SettingsIntegrationsInstalled",
	"SettingsIntegrationsMarketplace",
	"SettingsIntegrationsYourApps",
	"SettingsIntegration",
	"SettingsChatSync",
	"SettingsChatSyncConnection",
])

/** Which secondary sidebar and section layout an org route gets (legacy `AppSidebar`). */
export type OrgSection = "Chat" | "Settings" | "MySettings" | "Notifications" | "Customers"

export const orgSectionOf = (route: AppRoute): OrgSection | undefined => {
	if (orgSlugOf(route) === undefined) return undefined
	if (isSettingsRoute(route)) return "Settings"
	if (isMySettingsRoute(route)) return "MySettings"
	if (isNotificationsRoute(route)) return "Notifications"
	if (isCustomersRoute(route)) return "Customers"
	return "Chat"
}

/** `currentChannelIdAtom`: the channel a chat route shows. */
export const chatChannelIdOf = (route: AppRoute): ChannelId | null =>
	isChannelChatRoute(route) ? route.channelId : null

/** The channel settings layout's tab a route shows (`channels/$channelId/settings/*`). */
export const channelSettingsTabOf = (route: AppRoute): "overview" | "integrations" | "connect" | undefined =>
	AppRoute.matchOrElse(
		route,
		{
			ChannelSettingsOverview: () => "overview" as const,
			ChannelSettingsIntegrations: () => "integrations" as const,
			ChannelSettingsConnect: () => "connect" as const,
		},
		() => undefined,
	)

/** The document title for a route (the tab and window title). */
export const titleOf = (route: AppRoute): string => {
	const section = AppRoute.matchOrElse(
		route,
		{
			SignIn: () => "Sign in",
			SignUp: () => "Sign up",
			Join: () => "Join",
			Invite: () => "Invitation",
			BotInstall: () => "Install an app",
			OAuthAuthorize: () => "Connect an agent",
			Onboarding: () => "Welcome",
			OnboardingSetupOrganization: () => "Welcome",
			SelectOrganization: () => "Select a workspace",
			OrgHome: () => "Home",
			OrgMore: () => "More",
			NotFound: () => "Not found",
		},
		() =>
			Match.value(orgSectionOf(route)).pipe(
				Match.when("Chat", () => (isChatRoute(route) ? "Chat" : "Channel settings")),
				Match.when("Settings", () => "Settings"),
				Match.when("MySettings", () => "Settings"),
				Match.when("Notifications", () => "Activity"),
				Match.when("Customers", () => "Customers"),
				Match.orElse(() => undefined),
			),
	)
	return section === undefined ? "Hazel" : `${section} · Hazel`
}

/** `/onboarding` with its search in legacy order: `navigate({ search: (prev) => ({ ...prev, step }) })`. */
export const onboardingHref = (orgId: OrganizationId | null, step: string): string =>
	hrefOf(AppRoute.Onboarding({ orgId: Option.fromNullishOr(orgId), step: Option.some(step) }))

/** `/sign-in?redirect_url=`: where a signed-out visitor goes, coming back to `returnTo` afterwards. */
export const signInHref = (returnTo: string): string =>
	hrefOf(AppRoute.SignIn({ redirectUrl: Option.some(returnTo), error: Option.none() }))

/**
 * Where entering an organization lands, or its slug setup step while it has no slug yet. On a phone
 * that is the channel list (the Chats tab; the tab bar has no Home), elsewhere the org home.
 */
export const organizationRoute = (
	organization: { readonly id: OrganizationId; readonly slug: string | null },
	options: { readonly isMobile: boolean } = { isMobile: false },
): AppRoute =>
	organization.slug
		? options.isMobile
			? AppRoute.ChatIndex({ orgSlug: organization.slug })
			: AppRoute.OrgHome({ orgSlug: organization.slug })
		: AppRoute.OnboardingSetupOrganization({ orgId: Option.some(organization.id) })

export const organizationHref = (
	organization: { readonly id: OrganizationId; readonly slug: string | null },
	options?: { readonly isMobile: boolean },
): string => hrefOf(organizationRoute(organization, options))

/** A channel scrolled to one message (`?messageId=`, read by the channel page, not the route). */
export const chatMessageHref = (orgSlug: string, channelId: ChannelId, messageId: string): string =>
	`${hrefOf(AppRoute.ChatChannel({ orgSlug, channelId }))}?${new URLSearchParams({ messageId })}`

/** My Settings > Linked Accounts without an OAuth callback result. */
export const linkedAccountsRoute = (orgSlug: string): AppRoute =>
	AppRoute.MySettingsLinkedAccounts({
		orgSlug,
		connectionStatus: Option.none(),
		provider: Option.none(),
		errorCode: Option.none(),
	})

/** An integration's settings page without an OAuth callback result. */
export const integrationRoute = (orgSlug: string, integrationId: string): AppRoute =>
	AppRoute.SettingsIntegration({
		orgSlug,
		integrationId,
		connectionStatus: Option.none(),
		errorCode: Option.none(),
	})

/** The customers list, unfiltered or on a saved view (its id, or a built-in view's key). */
export const customersListRoute = (orgSlug: string, view: string | null = null): AppRoute =>
	AppRoute.CustomersList({ orgSlug, view: Option.fromNullishOr(view) })

/** A customer's page on `tab` (none: the overview tab). */
export const customerRoute = (
	orgSlug: string,
	accountId: CustomerAccountId,
	tab: CustomerTab | null = null,
): AppRoute => AppRoute.CustomerDetail({ orgSlug, accountId, tab: Option.fromNullishOr(tab) })
