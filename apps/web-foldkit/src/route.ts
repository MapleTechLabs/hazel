import { ChannelId, OrganizationId, SyncConnectionId, UserId } from "@hazel/schema"
import { Match, Option, Schema, pipe } from "effect"
import { Route } from "foldkit"
import * as Url from "foldkit/url"
import { defineRouteUnion, literal, query, schemaSegment, slash, string } from "foldkit/route"

/** Flat route union mirroring the 39 legacy TanStack routes, plus NotFound. */
export const AppRoute = defineRouteUnion({
	Root: {},
	SignIn: { redirectUrl: Schema.Option(Schema.String) },
	SignUp: { redirectUrl: Schema.Option(Schema.String) },
	/** Where the OAuth callback sends a first-time user to pick their name (`?flowId=&reference=`). */
	AuthRegister: { flowId: Schema.Option(Schema.String), reference: Schema.Option(Schema.String) },
	/** Where the OAuth callback sends a user whose provider account it just linked (`?provider=`). */
	AuthContinue: { provider: Schema.Option(Schema.String) },
	/** The browser half of desktop sign-in (`?attempt=`), opened by the desktop app. */
	AuthDesktop: { attempt: Schema.Option(Schema.String) },
	Join: { slug: Schema.String },
	/** The link in an invitation email. */
	Invite: { token: Schema.String },
	/** A bot's install link (`@hazel/domain/bot-install`): `?bot_id=&redirect_uri=&state=`. */
	BotInstall: {
		botId: Schema.Option(Schema.String),
		redirectUri: Schema.Option(Schema.String),
		state: Schema.Option(Schema.String),
	},
	/** `?orgId=&step=` (`validateSearch` in `onboarding/index.tsx`). */
	Onboarding: { orgId: Schema.Option(OrganizationId), step: Schema.Option(Schema.String) },
	OnboardingSetupOrganization: { orgId: Schema.Option(OrganizationId) },
	SelectOrganization: {},
	OrgHome: { orgSlug: Schema.String },
	ChatIndex: { orgSlug: Schema.String },
	ChatChannel: { orgSlug: Schema.String, channelId: ChannelId },
	ChatFiles: { orgSlug: Schema.String, channelId: ChannelId },
	ChatFilesMedia: { orgSlug: Schema.String, channelId: ChannelId },
	ChannelSettings: { orgSlug: Schema.String, channelId: ChannelId },
	ChannelSettingsOverview: { orgSlug: Schema.String, channelId: ChannelId },
	ChannelSettingsIntegrations: { orgSlug: Schema.String, channelId: ChannelId },
	ChannelSettingsConnect: { orgSlug: Schema.String, channelId: ChannelId },
	MySettingsAppearance: { orgSlug: Schema.String },
	MySettingsProfile: { orgSlug: Schema.String },
	/** The OAuth callback redirect's `?connection_status=&provider=&error_code=`. */
	MySettingsLinkedAccounts: {
		orgSlug: Schema.String,
		connectionStatus: Schema.Option(Schema.String),
		provider: Schema.Option(Schema.String),
		errorCode: Schema.Option(Schema.String),
	},
	MySettingsNotifications: { orgSlug: Schema.String },
	MySettingsDesktop: { orgSlug: Schema.String },
	NotificationsAll: { orgSlug: Schema.String },
	NotificationsGeneral: { orgSlug: Schema.String },
	NotificationsThreads: { orgSlug: Schema.String },
	NotificationsDms: { orgSlug: Schema.String },
	Profile: { orgSlug: Schema.String, userId: UserId },
	SettingsGeneral: { orgSlug: Schema.String },
	TeamSettings: { orgSlug: Schema.String },
	SettingsInvitations: { orgSlug: Schema.String },
	SettingsCustomEmojis: { orgSlug: Schema.String },
	SettingsDebug: { orgSlug: Schema.String },
	SettingsConnectInvites: { orgSlug: Schema.String },
	SettingsChatSync: { orgSlug: Schema.String },
	SettingsChatSyncConnection: { orgSlug: Schema.String, connectionId: SyncConnectionId },
	SettingsIntegrations: { orgSlug: Schema.String },
	SettingsIntegrationsInstalled: { orgSlug: Schema.String },
	SettingsIntegrationsMarketplace: { orgSlug: Schema.String },
	SettingsIntegrationsYourApps: { orgSlug: Schema.String },
	/** The OAuth callback redirect's `?connection_status=&error_code=`. */
	SettingsIntegration: {
		orgSlug: Schema.String,
		integrationId: Schema.String,
		connectionStatus: Schema.Option(Schema.String),
		errorCode: Schema.Option(Schema.String),
	},
	NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type
export type RouteTag = AppRoute["_tag"]
export type RouteOf<Tag extends RouteTag> = Extract<AppRoute, { readonly _tag: Tag }>

// ROUTERS

const RedirectQuery = Schema.Struct({ redirectUrl: Schema.OptionFromOptional(Schema.String) }).pipe(
	Schema.encodeKeys({ redirectUrl: "redirect_url" }),
)
const RegisterQuery = Schema.Struct({
	flowId: Schema.OptionFromOptional(Schema.String),
	reference: Schema.OptionFromOptional(Schema.String),
})
const ContinueQuery = Schema.Struct({ provider: Schema.OptionFromOptional(Schema.String) })
const DesktopQuery = Schema.Struct({ attempt: Schema.OptionFromOptional(Schema.String) })
/** Decoded by the page: a malformed link is a page state, not a 404. */
const BotInstallQuery = Schema.Struct({
	botId: Schema.OptionFromOptional(Schema.String),
	redirectUri: Schema.OptionFromOptional(Schema.String),
	state: Schema.OptionFromOptional(Schema.String),
}).pipe(Schema.encodeKeys({ botId: "bot_id", redirectUri: "redirect_uri" }))
const OrgIdQuery = Schema.Struct({ orgId: Schema.OptionFromOptional(OrganizationId) })
const OnboardingQuery = Schema.Struct({
	orgId: Schema.OptionFromOptional(OrganizationId),
	step: Schema.OptionFromOptional(Schema.String),
})
/** Legacy `validateSearch` passes these through unchecked; pages decode the values they act on. */
const LinkedAccountsCallbackQuery = Schema.Struct({
	connectionStatus: Schema.OptionFromOptional(Schema.String),
	provider: Schema.OptionFromOptional(Schema.String),
	errorCode: Schema.OptionFromOptional(Schema.String),
}).pipe(Schema.encodeKeys({ connectionStatus: "connection_status", errorCode: "error_code" }))
/** The integration callback also carries `provider`, which the route drops like before. */
const IntegrationCallbackQuery = Schema.Struct({
	connectionStatus: Schema.OptionFromOptional(Schema.String),
	errorCode: Schema.OptionFromOptional(Schema.String),
}).pipe(Schema.encodeKeys({ connectionStatus: "connection_status", errorCode: "error_code" }))

const org = string("orgSlug")
const orgPath = (...segments: ReadonlyArray<string>) =>
	segments.reduce((parser, segment) => pipe(parser, slash(literal(segment))), org)
const channel = (base: string) =>
	pipe(org, slash(literal(base)), slash(schemaSegment("channelId", ChannelId)))
const channelSettings = (...segments: ReadonlyArray<string>) =>
	segments.reduce(
		(parser, segment) => pipe(parser, slash(literal(segment))),
		pipe(channel("channels"), slash(literal("settings"))),
	)

/** One router per route tag, used to parse URLs and to build them back (`hrefOf`). */
const routers = {
	Root: pipe(Route.root, Route.mapTo(AppRoute.Root)),
	SignIn: pipe(literal("sign-in"), query(RedirectQuery), Route.mapTo(AppRoute.SignIn)),
	SignUp: pipe(literal("sign-up"), query(RedirectQuery), Route.mapTo(AppRoute.SignUp)),
	AuthRegister: pipe(
		literal("auth"),
		slash(literal("register")),
		query(RegisterQuery),
		Route.mapTo(AppRoute.AuthRegister),
	),
	AuthContinue: pipe(
		literal("auth"),
		slash(literal("continue")),
		query(ContinueQuery),
		Route.mapTo(AppRoute.AuthContinue),
	),
	AuthDesktop: pipe(
		literal("auth"),
		slash(literal("desktop")),
		query(DesktopQuery),
		Route.mapTo(AppRoute.AuthDesktop),
	),
	Join: pipe(literal("join"), slash(string("slug")), Route.mapTo(AppRoute.Join)),
	Invite: pipe(literal("invite"), slash(string("token")), Route.mapTo(AppRoute.Invite)),
	BotInstall: pipe(
		literal("oauth"),
		slash(literal("bot-install")),
		query(BotInstallQuery),
		Route.mapTo(AppRoute.BotInstall),
	),
	Onboarding: pipe(literal("onboarding"), query(OnboardingQuery), Route.mapTo(AppRoute.Onboarding)),
	OnboardingSetupOrganization: pipe(
		literal("onboarding"),
		slash(literal("setup-organization")),
		query(OrgIdQuery),
		Route.mapTo(AppRoute.OnboardingSetupOrganization),
	),
	SelectOrganization: pipe(literal("select-organization"), Route.mapTo(AppRoute.SelectOrganization)),
	OrgHome: pipe(org, Route.mapTo(AppRoute.OrgHome)),
	ChatIndex: pipe(orgPath("chat"), Route.mapTo(AppRoute.ChatIndex)),
	ChatChannel: pipe(channel("chat"), Route.mapTo(AppRoute.ChatChannel)),
	ChatFiles: pipe(channel("chat"), slash(literal("files")), Route.mapTo(AppRoute.ChatFiles)),
	ChatFilesMedia: pipe(
		channel("chat"),
		slash(literal("files")),
		slash(literal("media")),
		Route.mapTo(AppRoute.ChatFilesMedia),
	),
	ChannelSettings: pipe(channelSettings(), Route.mapTo(AppRoute.ChannelSettings)),
	ChannelSettingsOverview: pipe(channelSettings("overview"), Route.mapTo(AppRoute.ChannelSettingsOverview)),
	ChannelSettingsIntegrations: pipe(
		channelSettings("integrations"),
		Route.mapTo(AppRoute.ChannelSettingsIntegrations),
	),
	ChannelSettingsConnect: pipe(channelSettings("connect"), Route.mapTo(AppRoute.ChannelSettingsConnect)),
	MySettingsAppearance: pipe(orgPath("my-settings"), Route.mapTo(AppRoute.MySettingsAppearance)),
	MySettingsProfile: pipe(orgPath("my-settings", "profile"), Route.mapTo(AppRoute.MySettingsProfile)),
	MySettingsLinkedAccounts: pipe(
		orgPath("my-settings", "linked-accounts"),
		query(LinkedAccountsCallbackQuery),
		Route.mapTo(AppRoute.MySettingsLinkedAccounts),
	),
	MySettingsNotifications: pipe(
		orgPath("my-settings", "notifications"),
		Route.mapTo(AppRoute.MySettingsNotifications),
	),
	MySettingsDesktop: pipe(orgPath("my-settings", "desktop"), Route.mapTo(AppRoute.MySettingsDesktop)),
	NotificationsAll: pipe(orgPath("notifications"), Route.mapTo(AppRoute.NotificationsAll)),
	NotificationsGeneral: pipe(
		orgPath("notifications", "general"),
		Route.mapTo(AppRoute.NotificationsGeneral),
	),
	NotificationsThreads: pipe(
		orgPath("notifications", "threads"),
		Route.mapTo(AppRoute.NotificationsThreads),
	),
	NotificationsDms: pipe(orgPath("notifications", "dms"), Route.mapTo(AppRoute.NotificationsDms)),
	Profile: pipe(orgPath("profile"), slash(schemaSegment("userId", UserId)), Route.mapTo(AppRoute.Profile)),
	SettingsGeneral: pipe(orgPath("settings"), Route.mapTo(AppRoute.SettingsGeneral)),
	TeamSettings: pipe(orgPath("settings", "team"), Route.mapTo(AppRoute.TeamSettings)),
	SettingsInvitations: pipe(orgPath("settings", "invitations"), Route.mapTo(AppRoute.SettingsInvitations)),
	SettingsCustomEmojis: pipe(
		orgPath("settings", "custom-emojis"),
		Route.mapTo(AppRoute.SettingsCustomEmojis),
	),
	SettingsDebug: pipe(orgPath("settings", "debug"), Route.mapTo(AppRoute.SettingsDebug)),
	SettingsConnectInvites: pipe(
		orgPath("settings", "connect-invites"),
		Route.mapTo(AppRoute.SettingsConnectInvites),
	),
	SettingsChatSync: pipe(orgPath("settings", "chat-sync"), Route.mapTo(AppRoute.SettingsChatSync)),
	SettingsChatSyncConnection: pipe(
		orgPath("settings", "chat-sync"),
		slash(schemaSegment("connectionId", SyncConnectionId)),
		Route.mapTo(AppRoute.SettingsChatSyncConnection),
	),
	SettingsIntegrations: pipe(
		orgPath("settings", "integrations"),
		Route.mapTo(AppRoute.SettingsIntegrations),
	),
	SettingsIntegrationsInstalled: pipe(
		orgPath("settings", "integrations", "installed"),
		Route.mapTo(AppRoute.SettingsIntegrationsInstalled),
	),
	SettingsIntegrationsMarketplace: pipe(
		orgPath("settings", "integrations", "marketplace"),
		Route.mapTo(AppRoute.SettingsIntegrationsMarketplace),
	),
	SettingsIntegrationsYourApps: pipe(
		orgPath("settings", "integrations", "your-apps"),
		Route.mapTo(AppRoute.SettingsIntegrationsYourApps),
	),
	SettingsIntegration: pipe(
		orgPath("settings", "integrations"),
		slash(string("integrationId")),
		query(IntegrationCallbackQuery),
		Route.mapTo(AppRoute.SettingsIntegration),
	),
} as const

// Top-level literals before `$orgSlug`, which would otherwise claim `/onboarding` and friends.
export const urlToAppRoute = Route.parseUrlWithFallback(
	Route.oneOf(
		routers.Root,
		routers.SignIn,
		routers.SignUp,
		routers.AuthRegister,
		routers.AuthContinue,
		routers.AuthDesktop,
		routers.Join,
		routers.Invite,
		routers.BotInstall,
		routers.Onboarding,
		routers.OnboardingSetupOrganization,
		routers.SelectOrganization,
		routers.OrgHome,
		routers.ChatIndex,
		routers.ChatChannel,
		routers.ChatFiles,
		routers.ChatFilesMedia,
		routers.ChannelSettings,
		routers.ChannelSettingsOverview,
		routers.ChannelSettingsIntegrations,
		routers.ChannelSettingsConnect,
		routers.MySettingsAppearance,
		routers.MySettingsProfile,
		routers.MySettingsLinkedAccounts,
		routers.MySettingsNotifications,
		routers.MySettingsDesktop,
		routers.NotificationsAll,
		routers.NotificationsGeneral,
		routers.NotificationsThreads,
		routers.NotificationsDms,
		routers.Profile,
		routers.SettingsGeneral,
		routers.TeamSettings,
		routers.SettingsInvitations,
		routers.SettingsCustomEmojis,
		routers.SettingsDebug,
		routers.SettingsConnectInvites,
		routers.SettingsChatSync,
		routers.SettingsChatSyncConnection,
		routers.SettingsIntegrations,
		// Literal sub-pages first: they also match the `$integrationId` route.
		routers.SettingsIntegrationsInstalled,
		routers.SettingsIntegrationsMarketplace,
		routers.SettingsIntegrationsYourApps,
		routers.SettingsIntegration,
	),
	AppRoute.NotFound,
)

/** The URL a route value prints to; `urlToAppRoute(hrefOf(route))` gives the route back. */
export const hrefOf = (route: AppRoute): string =>
	AppRoute.match<string>(route, {
		...routers,
		NotFound: ({ path }) => path,
	})

/**
 * The route of a same-origin path (`/x?y`), e.g. a remembered page to return to. Query parameters
 * the route does not model are dropped.
 */
export const routeOfPath = (path: string): AppRoute =>
	Option.match(Url.fromString(`https://hazel.invalid${path.startsWith("/") ? path : `/${path}`}`), {
		onNone: () => AppRoute.NotFound({ path }),
		onSome: urlToAppRoute,
	})

// HELPERS

export const orgSlugOf = (route: AppRoute): string | undefined =>
	"orgSlug" in route ? route.orgSlug : undefined

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
	"NotFound",
])

/** `/$orgSlug/settings/*`. */
export const isSettingsRoute = AppRoute.isAnyOf([
	"SettingsGeneral",
	"TeamSettings",
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
	"MySettingsLinkedAccounts",
	"MySettingsNotifications",
	"MySettingsDesktop",
])

/** `/$orgSlug/notifications/*`. */
export const isNotificationsRoute = AppRoute.isAnyOf([
	"NotificationsAll",
	"NotificationsGeneral",
	"NotificationsThreads",
	"NotificationsDms",
])

/** `/$orgSlug/chat/$channelId/*`: a channel's messages, files or media. */
export const isChannelChatRoute = AppRoute.isAnyOf(["ChatChannel", "ChatFiles", "ChatFilesMedia"])

/** `/$orgSlug/chat` and everything below it. */
export const isChatRoute = AppRoute.isAnyOf(["ChatIndex", "ChatChannel", "ChatFiles", "ChatFilesMedia"])

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
export type OrgSection = "Chat" | "Settings" | "MySettings" | "Notifications"

export const orgSectionOf = (route: AppRoute): OrgSection | undefined => {
	if (orgSlugOf(route) === undefined) return undefined
	if (isSettingsRoute(route)) return "Settings"
	if (isMySettingsRoute(route)) return "MySettings"
	if (isNotificationsRoute(route)) return "Notifications"
	return "Chat"
}

/** `currentChannelIdAtom`: the channel a chat route shows. */
export const chatChannelIdOf = (route: AppRoute): ChannelId | null =>
	isChannelChatRoute(route) ? route.channelId : null

/** The channel settings layout's tab a route shows (`channels/$channelId/settings/*`). */
export const channelSettingsTabOf = (route: AppRoute): "overview" | "integrations" | "connect" | undefined =>
	AppRoute.matchOrElse<"overview" | "integrations" | "connect" | undefined>(
		route,
		{
			ChannelSettingsOverview: () => "overview",
			ChannelSettingsIntegrations: () => "integrations",
			ChannelSettingsConnect: () => "connect",
		},
		() => undefined,
	)

/** The document title for a route (the tab and window title). */
export const titleOf = (route: AppRoute): string => {
	const section = AppRoute.matchOrElse<string | undefined>(
		route,
		{
			SignIn: () => "Sign in",
			SignUp: () => "Sign up",
			Join: () => "Join",
			Invite: () => "Invitation",
			BotInstall: () => "Install an app",
			Onboarding: () => "Welcome",
			OnboardingSetupOrganization: () => "Welcome",
			SelectOrganization: () => "Select a workspace",
			OrgHome: () => "Home",
			NotFound: () => "Not found",
		},
		() =>
			Match.value(orgSectionOf(route)).pipe(
				Match.when("Chat", () => (isChatRoute(route) ? "Chat" : "Channel settings")),
				Match.when("Settings", () => "Settings"),
				Match.when("MySettings", () => "My settings"),
				Match.when("Notifications", () => "Activity"),
				Match.orElse(() => undefined),
			),
	)
	return section === undefined ? "Hazel Chat" : `${section} · Hazel Chat`
}

/** `/onboarding` with its search in legacy order: `navigate({ search: (prev) => ({ ...prev, step }) })`. */
export const onboardingHref = (orgId: OrganizationId | null, step: string): string =>
	hrefOf(AppRoute.Onboarding({ orgId: Option.fromNullishOr(orgId), step: Option.some(step) }))

/** `/sign-in?redirect_url=`: where a signed-out visitor goes, coming back to `returnTo` afterwards. */
export const signInHref = (returnTo: string): string =>
	hrefOf(AppRoute.SignIn({ redirectUrl: Option.some(returnTo) }))

/** An organization's home, or its slug setup step while it has no slug yet. */
export const organizationRoute = (organization: {
	readonly id: OrganizationId
	readonly slug: string | null
}): AppRoute =>
	organization.slug
		? AppRoute.OrgHome({ orgSlug: organization.slug })
		: AppRoute.OnboardingSetupOrganization({ orgId: Option.some(organization.id) })

export const organizationHref = (organization: {
	readonly id: OrganizationId
	readonly slug: string | null
}): string => hrefOf(organizationRoute(organization))

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

export const linkedAccountsHref = (orgSlug: string): string => hrefOf(linkedAccountsRoute(orgSlug))

/** An integration's settings page without an OAuth callback result. */
export const integrationRoute = (orgSlug: string, integrationId: string): AppRoute =>
	AppRoute.SettingsIntegration({
		orgSlug,
		integrationId,
		connectionStatus: Option.none(),
		errorCode: Option.none(),
	})

/** An org route, or `undefined` outside an org, where the org-only overlays never open. */
export const orgRouteOf = (
	orgSlug: string | null,
	toRoute: (orgSlug: string) => AppRoute,
): AppRoute | undefined => (orgSlug === null ? undefined : toRoute(orgSlug))

/** An org route's href, or `null` outside an org, where the org-only overlays never open. */
export const orgHrefOf = (orgSlug: string | null, toRoute: (orgSlug: string) => AppRoute): string | null =>
	orgSlug === null ? null : hrefOf(toRoute(orgSlug))
