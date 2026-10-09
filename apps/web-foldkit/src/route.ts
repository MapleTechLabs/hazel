import { ChannelId, OrganizationId, SyncConnectionId, UserId } from "@hazel/schema"
import { Option, Schema, pipe } from "effect"
import { Route } from "foldkit"
import { defineRouteUnion, literal, query, restString, schemaSegment, slash, string } from "foldkit/route"

/** Flat route union mirroring the 39 legacy TanStack routes (`apps/web/src/routes`), plus NotFound. */
export const AppRoute = defineRouteUnion({
	Root: {},
	SignIn: { splat: Schema.String, redirectUrl: Schema.Option(Schema.String) },
	SignUp: { splat: Schema.String, redirectUrl: Schema.Option(Schema.String) },
	Join: { slug: Schema.String },
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

/** `/sign-in/$`: the bare prefix and any splat below it (Clerk's own sub-routes). */
const authRouters = (segment: "sign-in" | "sign-up", make: typeof AppRoute.SignIn | typeof AppRoute.SignUp) =>
	({
		bare: pipe(
			literal(segment),
			query(RedirectQuery),
			Route.mapTo({
				make: ({ redirectUrl }: { redirectUrl: Option.Option<string> }) =>
					make.make({ splat: "", redirectUrl }),
			}),
		),
		splat: pipe(
			literal(segment),
			slash(restString("splat")),
			query(RedirectQuery),
			Route.mapTo({
				make: (fields: { splat: string; redirectUrl: Option.Option<string> }) => make.make(fields),
			}),
		),
	}) as const

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

const signIn = authRouters("sign-in", AppRoute.SignIn)
const signUp = authRouters("sign-up", AppRoute.SignUp)

/** One router per route tag, used to parse URLs and to build them back (`hrefOf`). */
const routers = {
	Root: pipe(Route.root, Route.mapTo(AppRoute.Root)),
	Join: pipe(literal("join"), slash(string("slug")), Route.mapTo(AppRoute.Join)),
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
		signIn.bare,
		signIn.splat,
		signUp.bare,
		signUp.splat,
		routers.Join,
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
		SignIn: (signInRoute) => (signInRoute.splat === "" ? signIn.bare : signIn.splat)(signInRoute),
		SignUp: (signUpRoute) => (signUpRoute.splat === "" ? signUp.bare : signUp.splat)(signUpRoute),
		NotFound: ({ path }) => path,
	})

// HELPERS

export const orgSlugOf = (route: AppRoute): string | undefined =>
	"orgSlug" in route ? route.orgSlug : undefined

/** Routes outside `/_app`, which legacy renders without the signed-in gate. */
export const isPublicRoute = AppRoute.isAnyOf(["SignIn", "SignUp", "Join", "NotFound"])

/** Which secondary sidebar and section layout an org route gets (legacy `AppSidebar`). */
export type OrgSection = "Chat" | "Settings" | "MySettings" | "Notifications"

export const orgSectionOf = (route: AppRoute): OrgSection | undefined => {
	if (orgSlugOf(route) === undefined) return undefined
	if (route._tag.startsWith("Settings") || route._tag === "TeamSettings") return "Settings"
	if (route._tag.startsWith("MySettings")) return "MySettings"
	if (route._tag.startsWith("Notifications")) return "Notifications"
	return "Chat"
}

/** `/onboarding` with its search in legacy order: `navigate({ search: (prev) => ({ ...prev, step }) })`. */
export const onboardingHref = (orgId: OrganizationId | null, step: string): string =>
	hrefOf(AppRoute.Onboarding({ orgId: Option.fromNullishOr(orgId), step: Option.some(step) }))

/** `/sign-in?redirect_url=`: where a signed-out visitor goes, coming back to `returnTo` afterwards. */
export const signInHref = (returnTo: string): string =>
	hrefOf(AppRoute.SignIn({ splat: "", redirectUrl: Option.some(returnTo) }))

/** An organization's home, or its slug setup step while it has no slug yet. */
export const organizationHref = (organization: {
	readonly id: OrganizationId
	readonly slug: string | null
}): string =>
	hrefOf(
		organization.slug
			? AppRoute.OrgHome({ orgSlug: organization.slug })
			: AppRoute.OnboardingSetupOrganization({ orgId: Option.some(organization.id) }),
	)

/** A channel scrolled to one message (`?messageId=`, read by the channel page, not the route). */
export const chatMessageHref = (orgSlug: string, channelId: ChannelId, messageId: string): string =>
	`${hrefOf(AppRoute.ChatChannel({ orgSlug, channelId }))}?${new URLSearchParams({ messageId })}`

/** My Settings > Linked Accounts without an OAuth callback result. */
export const linkedAccountsHref = (orgSlug: string): string =>
	hrefOf(
		AppRoute.MySettingsLinkedAccounts({
			orgSlug,
			connectionStatus: Option.none(),
			provider: Option.none(),
			errorCode: Option.none(),
		}),
	)

/** An integration's settings page without an OAuth callback result. */
export const integrationHref = (orgSlug: string, integrationId: string): string =>
	hrefOf(
		AppRoute.SettingsIntegration({
			orgSlug,
			integrationId,
			connectionStatus: Option.none(),
			errorCode: Option.none(),
		}),
	)

/** An org route's href, or `null` outside an org, where the org-only overlays never open. */
export const orgHrefOf = (orgSlug: string | null, toRoute: (orgSlug: string) => AppRoute): string | null =>
	orgSlug === null ? null : hrefOf(toRoute(orgSlug))
