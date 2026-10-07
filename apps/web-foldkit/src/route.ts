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
	Onboarding: { orgId: Schema.Option(OrganizationId) },
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
	MySettingsLinkedAccounts: { orgSlug: Schema.String },
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
	SettingsIntegration: { orgSlug: Schema.String, integrationId: Schema.String },
	NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type
export type RouteTag = AppRoute["_tag"]
export type RouteOf<Tag extends RouteTag> = Extract<AppRoute, { readonly _tag: Tag }>

// ROUTERS

const RedirectQuery = Schema.Struct({ redirect_url: Schema.OptionFromOptional(Schema.String) })
const OrgIdQuery = Schema.Struct({ orgId: Schema.OptionFromOptional(OrganizationId) })
type OrgIdQuery = typeof OrgIdQuery.Type

/** `/sign-in/$`: the bare prefix and any splat below it (Clerk's own sub-routes). */
const authRouters = (
	segment: "sign-in" | "sign-up",
	make: typeof AppRoute.SignIn | typeof AppRoute.SignUp,
) => {
	const toRoute = ({ splat, redirect_url }: { splat: string; redirect_url: Option.Option<string> }) =>
		make.make({ splat, redirectUrl: redirect_url })
	return [
		pipe(
			literal(segment),
			query(RedirectQuery),
			Route.mapTo({
				make: ({ redirect_url }: { redirect_url: Option.Option<string> }) =>
					toRoute({ splat: "", redirect_url }),
			}),
		),
		pipe(
			literal(segment),
			slash(restString("splat")),
			query(RedirectQuery),
			Route.mapTo({ make: toRoute }),
		),
	] as const
}

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

const orgRouters = [
	pipe(org, Route.mapTo(AppRoute.OrgHome)),
	pipe(orgPath("chat"), Route.mapTo(AppRoute.ChatIndex)),
	pipe(channel("chat"), Route.mapTo(AppRoute.ChatChannel)),
	pipe(channel("chat"), slash(literal("files")), Route.mapTo(AppRoute.ChatFiles)),
	pipe(
		channel("chat"),
		slash(literal("files")),
		slash(literal("media")),
		Route.mapTo(AppRoute.ChatFilesMedia),
	),
	pipe(channelSettings(), Route.mapTo(AppRoute.ChannelSettings)),
	pipe(channelSettings("overview"), Route.mapTo(AppRoute.ChannelSettingsOverview)),
	pipe(channelSettings("integrations"), Route.mapTo(AppRoute.ChannelSettingsIntegrations)),
	pipe(channelSettings("connect"), Route.mapTo(AppRoute.ChannelSettingsConnect)),
	pipe(orgPath("my-settings"), Route.mapTo(AppRoute.MySettingsAppearance)),
	pipe(orgPath("my-settings", "profile"), Route.mapTo(AppRoute.MySettingsProfile)),
	pipe(orgPath("my-settings", "linked-accounts"), Route.mapTo(AppRoute.MySettingsLinkedAccounts)),
	pipe(orgPath("my-settings", "notifications"), Route.mapTo(AppRoute.MySettingsNotifications)),
	pipe(orgPath("my-settings", "desktop"), Route.mapTo(AppRoute.MySettingsDesktop)),
	pipe(orgPath("notifications"), Route.mapTo(AppRoute.NotificationsAll)),
	pipe(orgPath("notifications", "general"), Route.mapTo(AppRoute.NotificationsGeneral)),
	pipe(orgPath("notifications", "threads"), Route.mapTo(AppRoute.NotificationsThreads)),
	pipe(orgPath("notifications", "dms"), Route.mapTo(AppRoute.NotificationsDms)),
	pipe(orgPath("profile"), slash(schemaSegment("userId", UserId)), Route.mapTo(AppRoute.Profile)),
	pipe(orgPath("settings"), Route.mapTo(AppRoute.SettingsGeneral)),
	pipe(orgPath("settings", "team"), Route.mapTo(AppRoute.TeamSettings)),
	pipe(orgPath("settings", "invitations"), Route.mapTo(AppRoute.SettingsInvitations)),
	pipe(orgPath("settings", "custom-emojis"), Route.mapTo(AppRoute.SettingsCustomEmojis)),
	pipe(orgPath("settings", "debug"), Route.mapTo(AppRoute.SettingsDebug)),
	pipe(orgPath("settings", "connect-invites"), Route.mapTo(AppRoute.SettingsConnectInvites)),
	pipe(orgPath("settings", "chat-sync"), Route.mapTo(AppRoute.SettingsChatSync)),
	pipe(
		orgPath("settings", "chat-sync"),
		slash(schemaSegment("connectionId", SyncConnectionId)),
		Route.mapTo(AppRoute.SettingsChatSyncConnection),
	),
	pipe(orgPath("settings", "integrations"), Route.mapTo(AppRoute.SettingsIntegrations)),
	// Literal sub-pages first: they also match the `$integrationId` route.
	pipe(
		orgPath("settings", "integrations", "installed"),
		Route.mapTo(AppRoute.SettingsIntegrationsInstalled),
	),
	pipe(
		orgPath("settings", "integrations", "marketplace"),
		Route.mapTo(AppRoute.SettingsIntegrationsMarketplace),
	),
	pipe(
		orgPath("settings", "integrations", "your-apps"),
		Route.mapTo(AppRoute.SettingsIntegrationsYourApps),
	),
	pipe(
		orgPath("settings", "integrations"),
		slash(string("integrationId")),
		Route.mapTo(AppRoute.SettingsIntegration),
	),
] as const

// Top-level literals before `$orgSlug`, which would otherwise claim `/onboarding` and friends.
export const urlToAppRoute = Route.parseUrlWithFallback(
	Route.oneOf(
		pipe(Route.root, Route.mapTo(AppRoute.Root)),
		...authRouters("sign-in", AppRoute.SignIn),
		...authRouters("sign-up", AppRoute.SignUp),
		pipe(literal("join"), slash(string("slug")), Route.mapTo(AppRoute.Join)),
		pipe(
			literal("onboarding"),
			query(OrgIdQuery),
			Route.mapTo({ make: (query: OrgIdQuery) => AppRoute.Onboarding.make(query) }),
		),
		pipe(
			literal("onboarding"),
			slash(literal("setup-organization")),
			query(OrgIdQuery),
			Route.mapTo({ make: (query: OrgIdQuery) => AppRoute.OnboardingSetupOrganization.make(query) }),
		),
		pipe(literal("select-organization"), Route.mapTo(AppRoute.SelectOrganization)),
		...orgRouters,
	),
	AppRoute.NotFound,
)

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
