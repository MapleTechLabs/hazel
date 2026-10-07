import { UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { fromString } from "foldkit/url"
import { describe, expect, it } from "vitest"
import { authRedirect, rootRedirect, routeRedirect } from "./redirect"
import { type AppRoute, orgSectionOf, urlToAppRoute } from "./route"
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
		expect(parse(`/onboarding?orgId=${orgId}`)).toMatchObject({ orgId: Option.some(orgId) })
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
	it("forwards the channel settings index to overview", () => {
		expect(routeRedirect(parse(`/hazel/channels/${channelId}/settings`), { isProd: true })).toEqual(
			Option.some(`/hazel/channels/${channelId}/settings/overview`),
		)
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
		const member = Option.some({ organizationId: orgId, slug: "hazel" })
		expect(rootRedirect(user(true), member)).toBe("/hazel")
		expect(rootRedirect(user(true), Option.none())).toBe("/select-organization")
		expect(rootRedirect(user(false), Option.none())).toBe("/onboarding")
		expect(rootRedirect(user(false), member)).toBe(`/onboarding?orgId=${orgId}`)
		expect(rootRedirect(user(true), Option.some({ organizationId: orgId, slug: null }))).toBe(
			`/onboarding/setup-organization?orgId=${orgId}`,
		)
	})
})
