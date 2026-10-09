import { ChannelId, OrganizationId, SyncConnectionId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { fromString } from "foldkit/url"
import { describe, expect, it } from "vitest"
import { authRedirect, rootRedirect, routeRedirect } from "./redirect"
import {
	AppRoute,
	chatMessageHref,
	hrefOf,
	onboardingHref,
	organizationHref,
	orgSectionOf,
	type RouteTag,
	signInHref,
	urlToAppRoute,
} from "./route"
import type { CurrentUser } from "./session"

const channelId = "0b5a1f7e-3c55-5d0e-9a51-0b7e6b2f0c11"
const userId = "891c4881-7560-578d-965a-fb38c858ca67"
const connectionId = "5f0c2b8e-1d4a-5b6c-8e9f-2a3b4c5d6e7f"
const orgId = "7c9e6679-7425-50de-944b-e07fc1f90ae7"

const parse = (path: string): AppRoute =>
	Option.match(fromString(`http://localhost${path}`), {
		onNone: () => expect.unreachable(`unparseable ${path}`),
		onSome: (url) => urlToAppRoute(url),
	})

/** Every legacy route (`bun run parity coverage`) and the Foldkit route it must resolve to. */
const legacyRoutes: ReadonlyArray<readonly [string, AppRoute["_tag"]]> = [
	["/", "Root"],
	["/hazel", "OrgHome"],
	["/join/hazel", "Join"],
	["/sign-in", "SignIn"],
	["/sign-up", "SignUp"],
	["/hazel/my-settings", "MySettingsAppearance"],
	["/hazel/notifications", "NotificationsAll"],
	["/hazel/settings", "SettingsGeneral"],
	["/onboarding/setup-organization", "OnboardingSetupOrganization"],
	["/onboarding", "Onboarding"],
	["/select-organization", "SelectOrganization"],
	["/hazel/settings/chat-sync", "SettingsChatSync"],
	["/hazel/settings/integrations", "SettingsIntegrations"],
	[`/hazel/chat/${channelId}`, "ChatChannel"],
	["/hazel/my-settings/desktop", "MySettingsDesktop"],
	["/hazel/my-settings/linked-accounts", "MySettingsLinkedAccounts"],
	["/hazel/my-settings/notifications", "MySettingsNotifications"],
	["/hazel/my-settings/profile", "MySettingsProfile"],
	["/hazel/notifications/dms", "NotificationsDms"],
	["/hazel/notifications/general", "NotificationsGeneral"],
	["/hazel/notifications/threads", "NotificationsThreads"],
	[`/hazel/profile/${userId}`, "Profile"],
	["/hazel/settings/connect-invites", "SettingsConnectInvites"],
	["/hazel/settings/custom-emojis", "SettingsCustomEmojis"],
	["/hazel/settings/debug", "SettingsDebug"],
	["/hazel/settings/invitations", "SettingsInvitations"],
	["/hazel/settings/team", "TeamSettings"],
	["/hazel/chat", "ChatIndex"],
	[`/hazel/channels/${channelId}/settings`, "ChannelSettings"],
	[`/hazel/settings/chat-sync/${connectionId}`, "SettingsChatSyncConnection"],
	["/hazel/settings/integrations/linear", "SettingsIntegration"],
	["/hazel/settings/integrations/installed", "SettingsIntegrationsInstalled"],
	["/hazel/settings/integrations/marketplace", "SettingsIntegrationsMarketplace"],
	["/hazel/settings/integrations/your-apps", "SettingsIntegrationsYourApps"],
	[`/hazel/channels/${channelId}/settings/connect`, "ChannelSettingsConnect"],
	[`/hazel/channels/${channelId}/settings/integrations`, "ChannelSettingsIntegrations"],
	[`/hazel/channels/${channelId}/settings/overview`, "ChannelSettingsOverview"],
	[`/hazel/chat/${channelId}/files/media`, "ChatFilesMedia"],
	[`/hazel/chat/${channelId}/files`, "ChatFiles"],
]

describe("urlToAppRoute", () => {
	it("covers all 39 legacy routes", () => {
		expect(new Set(legacyRoutes.map(([path]) => path)).size).toBe(39)
	})

	it.each(legacyRoutes)("%s resolves to %s", (path, tag) => {
		expect(parse(path)._tag).toBe(tag)
	})

	it("decodes branded and query segments", () => {
		expect(parse(`/hazel/chat/${channelId}`)).toMatchObject({ orgSlug: "hazel", channelId })
		expect(parse(`/hazel/profile/${userId}`)).toMatchObject({ userId })
		expect(parse("/sign-in/factor-one?redirect_url=%2Fhazel")).toMatchObject({
			_tag: "SignIn",
			splat: "factor-one",
			redirectUrl: Option.some("/hazel"),
		})
		expect(parse(`/onboarding?orgId=${orgId}`)).toMatchObject({ orgId: Option.some(orgId), step: Option.none() })
	})

	it("types the search params legacy reads with `Route.useSearch()`", () => {
		expect(parse(`/onboarding?orgId=${orgId}&step=themeSelection`)).toMatchObject({
			_tag: "Onboarding",
			step: Option.some("themeSelection"),
		})
		expect(
			parse("/hazel/my-settings/linked-accounts?connection_status=error&provider=discord&error_code=db_error"),
		).toMatchObject({
			_tag: "MySettingsLinkedAccounts",
			connectionStatus: Option.some("error"),
			provider: Option.some("discord"),
			errorCode: Option.some("db_error"),
		})
		expect(parse("/hazel/settings/integrations/linear?connection_status=success")).toMatchObject({
			_tag: "SettingsIntegration",
			integrationId: "linear",
			connectionStatus: Option.some("success"),
			errorCode: Option.none(),
		})
		expect(parse("/hazel/settings/integrations/installed?connection_status=success")._tag).toBe(
			"SettingsIntegrationsInstalled",
		)
	})

	it("prints the onboarding step URL in legacy search order", () => {
		const id = Schema.decodeUnknownSync(OrganizationId)(orgId)
		expect(onboardingHref(id, "role")).toBe(`/onboarding?orgId=${orgId}&step=role`)
		expect(onboardingHref(null, "welcome")).toBe("/onboarding?step=welcome")
	})

	it("falls back to NotFound", () => {
		expect(parse("/hazel/settings/nope")._tag).toBe("NotFound")
		expect(parse("/hazel/chat/not-a-uuid")._tag).toBe("NotFound")
	})

	it("picks the legacy secondary sidebar", () => {
		expect(orgSectionOf(parse("/hazel/settings/integrations/linear"))).toBe("Settings")
		expect(orgSectionOf(parse("/hazel/my-settings/profile"))).toBe("MySettings")
		expect(orgSectionOf(parse("/hazel/notifications/dms"))).toBe("Notifications")
		expect(orgSectionOf(parse(`/hazel/channels/${channelId}/settings/overview`))).toBe("Chat")
		expect(orgSectionOf(parse("/onboarding"))).toBeUndefined()
	})
})

describe("redirects", () => {
	it("leaves the channel settings index to its redirect page", () => {
		expect(routeRedirect(parse(`/hazel/channels/${channelId}/settings`), { isProd: true })).toEqual(Option.none())
		expect(routeRedirect(parse("/hazel/settings/team"), { isProd: true })).toEqual(Option.none())
	})

	it("hides the debug settings in production", () => {
		expect(routeRedirect(parse("/hazel/settings/debug"), { isProd: true })).toEqual(
			Option.some("/hazel/settings"),
		)
		expect(routeRedirect(parse("/hazel/settings/debug"), { isProd: false })).toEqual(Option.none())
	})

	it("sends signed-out visitors on app routes to sign-in", () => {
		expect(authRedirect(parse("/"), "SignedOut", "/")).toEqual(Option.some("/sign-in?redirect_url=%2F"))
		expect(authRedirect(parse("/hazel/chat"), "SignedIn", "/hazel/chat")).toEqual(Option.none())
		expect(authRedirect(parse("/hazel/chat"), "Loading", "/hazel/chat")).toEqual(Option.none())
		expect(authRedirect(parse("/join/hazel"), "SignedOut", "/join/hazel")).toEqual(Option.none())
		expect(authRedirect(parse("/sign-in"), "SignedOut", "/sign-in")).toEqual(Option.none())
	})

	const user = (isOnboarded: boolean): CurrentUser => ({
		id: Schema.decodeUnknownSync(UserId)(userId),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded,
		organizationId: null,
	})

	it("resolves the root redirect like `_app/index.tsx`", () => {
		const organizationId = Schema.decodeUnknownSync(OrganizationId)(orgId)
		const member = Option.some({ organizationId, slug: "hazel" })
		expect(rootRedirect(user(true), member)).toBe("/hazel")
		expect(rootRedirect(user(true), Option.none())).toBe("/select-organization")
		expect(rootRedirect(user(false), Option.none())).toBe("/onboarding")
		expect(rootRedirect(user(false), member)).toBe(`/onboarding?orgId=${orgId}`)
		expect(rootRedirect(user(true), Option.some({ organizationId, slug: null }))).toBe(
			`/onboarding/setup-organization?orgId=${orgId}`,
		)
	})
})

describe("hrefOf", () => {
	const orgSlug = "hazel"
	const channel = Schema.decodeUnknownSync(ChannelId)(channelId)
	const user = Schema.decodeUnknownSync(UserId)(userId)
	const connection = Schema.decodeUnknownSync(SyncConnectionId)(connectionId)
	const organization = Schema.decodeUnknownSync(OrganizationId)(orgId)
	const none = Option.none<string>()

	/** One value per tag (the record keeps it exhaustive) and the exact URL it must print. */
	const examples: { readonly [Tag in RouteTag]: ReadonlyArray<readonly [AppRoute, string]> } = {
		Root: [[AppRoute.Root(), "/"]],
		SignIn: [
			[AppRoute.SignIn({ splat: "", redirectUrl: none }), "/sign-in"],
			[
				AppRoute.SignIn({ splat: "", redirectUrl: Option.some("/hazel/chat") }),
				"/sign-in?redirect_url=%2Fhazel%2Fchat",
			],
			[
				AppRoute.SignIn({ splat: "factor-one/sso", redirectUrl: Option.some("/hazel") }),
				"/sign-in/factor-one/sso?redirect_url=%2Fhazel",
			],
		],
		SignUp: [
			[AppRoute.SignUp({ splat: "", redirectUrl: none }), "/sign-up"],
			[AppRoute.SignUp({ splat: "verify", redirectUrl: none }), "/sign-up/verify"],
		],
		Join: [[AppRoute.Join({ slug: "hazel" }), "/join/hazel"]],
		Onboarding: [
			[AppRoute.Onboarding({ orgId: Option.none(), step: none }), "/onboarding"],
			[
				AppRoute.Onboarding({ orgId: Option.some(organization), step: Option.some("role") }),
				`/onboarding?orgId=${orgId}&step=role`,
			],
		],
		OnboardingSetupOrganization: [
			[
				AppRoute.OnboardingSetupOrganization({ orgId: Option.none() }),
				"/onboarding/setup-organization",
			],
			[
				AppRoute.OnboardingSetupOrganization({ orgId: Option.some(organization) }),
				`/onboarding/setup-organization?orgId=${orgId}`,
			],
		],
		SelectOrganization: [[AppRoute.SelectOrganization(), "/select-organization"]],
		OrgHome: [[AppRoute.OrgHome({ orgSlug }), "/hazel"]],
		ChatIndex: [[AppRoute.ChatIndex({ orgSlug }), "/hazel/chat"]],
		ChatChannel: [[AppRoute.ChatChannel({ orgSlug, channelId: channel }), `/hazel/chat/${channelId}`]],
		ChatFiles: [[AppRoute.ChatFiles({ orgSlug, channelId: channel }), `/hazel/chat/${channelId}/files`]],
		ChatFilesMedia: [
			[
				AppRoute.ChatFilesMedia({ orgSlug, channelId: channel }),
				`/hazel/chat/${channelId}/files/media`,
			],
		],
		ChannelSettings: [
			[
				AppRoute.ChannelSettings({ orgSlug, channelId: channel }),
				`/hazel/channels/${channelId}/settings`,
			],
		],
		ChannelSettingsOverview: [
			[
				AppRoute.ChannelSettingsOverview({ orgSlug, channelId: channel }),
				`/hazel/channels/${channelId}/settings/overview`,
			],
		],
		ChannelSettingsIntegrations: [
			[
				AppRoute.ChannelSettingsIntegrations({ orgSlug, channelId: channel }),
				`/hazel/channels/${channelId}/settings/integrations`,
			],
		],
		ChannelSettingsConnect: [
			[
				AppRoute.ChannelSettingsConnect({ orgSlug, channelId: channel }),
				`/hazel/channels/${channelId}/settings/connect`,
			],
		],
		MySettingsAppearance: [[AppRoute.MySettingsAppearance({ orgSlug }), "/hazel/my-settings"]],
		MySettingsProfile: [[AppRoute.MySettingsProfile({ orgSlug }), "/hazel/my-settings/profile"]],
		MySettingsLinkedAccounts: [
			[
				AppRoute.MySettingsLinkedAccounts({
					orgSlug,
					connectionStatus: none,
					provider: none,
					errorCode: none,
				}),
				"/hazel/my-settings/linked-accounts",
			],
			[
				AppRoute.MySettingsLinkedAccounts({
					orgSlug,
					connectionStatus: Option.some("error"),
					provider: Option.some("discord"),
					errorCode: Option.some("db_error"),
				}),
				"/hazel/my-settings/linked-accounts?connection_status=error&provider=discord&error_code=db_error",
			],
		],
		MySettingsNotifications: [
			[AppRoute.MySettingsNotifications({ orgSlug }), "/hazel/my-settings/notifications"],
		],
		MySettingsDesktop: [[AppRoute.MySettingsDesktop({ orgSlug }), "/hazel/my-settings/desktop"]],
		NotificationsAll: [[AppRoute.NotificationsAll({ orgSlug }), "/hazel/notifications"]],
		NotificationsGeneral: [[AppRoute.NotificationsGeneral({ orgSlug }), "/hazel/notifications/general"]],
		NotificationsThreads: [[AppRoute.NotificationsThreads({ orgSlug }), "/hazel/notifications/threads"]],
		NotificationsDms: [[AppRoute.NotificationsDms({ orgSlug }), "/hazel/notifications/dms"]],
		Profile: [[AppRoute.Profile({ orgSlug, userId: user }), `/hazel/profile/${userId}`]],
		SettingsGeneral: [[AppRoute.SettingsGeneral({ orgSlug }), "/hazel/settings"]],
		TeamSettings: [[AppRoute.TeamSettings({ orgSlug }), "/hazel/settings/team"]],
		SettingsInvitations: [[AppRoute.SettingsInvitations({ orgSlug }), "/hazel/settings/invitations"]],
		SettingsCustomEmojis: [[AppRoute.SettingsCustomEmojis({ orgSlug }), "/hazel/settings/custom-emojis"]],
		SettingsDebug: [[AppRoute.SettingsDebug({ orgSlug }), "/hazel/settings/debug"]],
		SettingsConnectInvites: [
			[AppRoute.SettingsConnectInvites({ orgSlug }), "/hazel/settings/connect-invites"],
		],
		SettingsChatSync: [[AppRoute.SettingsChatSync({ orgSlug }), "/hazel/settings/chat-sync"]],
		SettingsChatSyncConnection: [
			[
				AppRoute.SettingsChatSyncConnection({ orgSlug, connectionId: connection }),
				`/hazel/settings/chat-sync/${connectionId}`,
			],
		],
		SettingsIntegrations: [[AppRoute.SettingsIntegrations({ orgSlug }), "/hazel/settings/integrations"]],
		SettingsIntegrationsInstalled: [
			[AppRoute.SettingsIntegrationsInstalled({ orgSlug }), "/hazel/settings/integrations/installed"],
		],
		SettingsIntegrationsMarketplace: [
			[
				AppRoute.SettingsIntegrationsMarketplace({ orgSlug }),
				"/hazel/settings/integrations/marketplace",
			],
		],
		SettingsIntegrationsYourApps: [
			[AppRoute.SettingsIntegrationsYourApps({ orgSlug }), "/hazel/settings/integrations/your-apps"],
		],
		SettingsIntegration: [
			[
				AppRoute.SettingsIntegration({
					orgSlug,
					integrationId: "linear",
					connectionStatus: none,
					errorCode: none,
				}),
				"/hazel/settings/integrations/linear",
			],
			[
				AppRoute.SettingsIntegration({
					orgSlug,
					integrationId: "github",
					connectionStatus: Option.some("success"),
					errorCode: Option.some("denied"),
				}),
				"/hazel/settings/integrations/github?connection_status=success&error_code=denied",
			],
		],
		NotFound: [[AppRoute.NotFound({ path: "/hazel/settings/nope" }), "/hazel/settings/nope"]],
	}
	const cases = Object.values(examples).flat()

	it.each(cases)("prints %o as %s and parses it back", (route, href) => {
		expect(hrefOf(route)).toBe(href)
		expect(parse(href)).toEqual(route)
	})

	it.each(legacyRoutes)("rebuilds %s from its parsed route", (path) => {
		expect(hrefOf(parse(path))).toBe(path)
	})

	it("prints the helper URLs the pages navigate to", () => {
		expect(signInHref("/hazel/chat?x=1")).toBe(
			`/sign-in?${new URLSearchParams({ redirect_url: "/hazel/chat?x=1" })}`,
		)
		expect(organizationHref({ id: organization, slug: "hazel" })).toBe("/hazel")
		expect(organizationHref({ id: organization, slug: null })).toBe(
			`/onboarding/setup-organization?orgId=${orgId}`,
		)
		expect(chatMessageHref(orgSlug, channel, "m 1")).toBe(`/hazel/chat/${channelId}?messageId=m+1`)
	})
})
