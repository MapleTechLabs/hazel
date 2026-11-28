// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The app's screens, one table: each route's tab, its bar's title, and the shared screen it draws
 * from the session. A host draws a route with no `screen` as its fallback (the phone's
 * `FallbackScreen`). Bringing a screen to a host is one entry here; the tabs are one table too.
 */
import type { View } from "@effect/ui"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { IconName } from "@hazel/ui/vocabulary/options"
import { Schema } from "effect"
import { ChannelDetails } from "../channel-settings/ChannelDetails"
import { ConnectPage } from "../channel-settings/pages/connect/ConnectPage"
import { OverviewPage } from "../channel-settings/pages/overview/OverviewPage"
import { HostedChannelSidebar } from "../channel-sidebar/hosted"
import { HostedChannelScreen } from "../chat/hosted"
import { HostedDms } from "../dms/hosted"
import { HostedNotificationsPage } from "../notifications/hosted"
import type { InboxTab } from "../notifications/pages/NotificationsPage"
import { HostedHomePage } from "../org/hosted"
import { moreHrefsOf } from "../org/pages/more/hrefs"
import { MorePage } from "../org/pages/more/MorePage"
import { ProfilePage } from "../org/pages/profile/ProfilePage"
import { GeneralPage } from "../settings/pages/general/GeneralPage"
import { InvitationsPage } from "../settings/pages/invitations/InvitationsPage"
import { TeamPage } from "../settings/pages/team/TeamPage"
import { AppRoute, hrefOf, type RouteOf, type RouteTag } from "./route"
import type { Session } from "./session"

/** The phone's tabs: each one's label, icon and root route (the route it opens at). */
export const TABS = [
	{
		id: "home",
		label: "Home",
		icon: "messages",
		root: (orgSlug: string) => AppRoute.ChatIndex({ orgSlug }),
	},
	{
		id: "dms",
		label: "DMs",
		icon: "message-user",
		root: (orgSlug: string) => AppRoute.ChatDms({ orgSlug }),
	},
	{
		id: "activity",
		label: "Activity",
		icon: "bell",
		root: (orgSlug: string) => AppRoute.NotificationsMentions({ orgSlug }),
	},
	{ id: "more", label: "More", icon: "dots", root: (orgSlug: string) => AppRoute.OrgMore({ orgSlug }) },
] as const satisfies ReadonlyArray<{
	readonly id: string
	readonly label: string
	readonly icon: IconName
	readonly root: (orgSlug: string) => AppRoute
}>

export const AppTab = Schema.Literals(["home", "dms", "activity", "more"])
export type AppTab = typeof AppTab.Type

/** What a screen is drawn from: its route, the session, the install, and the clock. */
export interface ScreenInputs<Tag extends RouteTag> {
	readonly route: RouteOf<Tag>
	readonly session: Session
	/** The route's href: the screen's key, so one route is one instance. */
	readonly key: string
	readonly cdnUrl: string
	readonly linkPreviewUrl: string
	/** The install's web app, where shared links point. */
	readonly appOrigin: string
	readonly nowMs: number
}

/**
 * What the registry's screens need from a host, checked here: a screen that needs another service
 * fails to compile until the host's set grows with it.
 */
export type ScreenServices = Requirement<typeof screenParts>[number]

type Requirement<T> = { readonly [K in keyof T]: T[K] extends View.Child<never, infer R> ? R : never }
declare const screenParts: readonly [
	ReturnType<typeof HostedChannelSidebar<never>>,
	ReturnType<typeof HostedDms<never>>,
	ReturnType<typeof HostedNotificationsPage<never>>,
	ReturnType<typeof HostedChannelScreen<never>>,
	ReturnType<typeof MorePage<never>>,
	ReturnType<typeof HostedHomePage<never>>,
	ReturnType<typeof ProfilePage<never>>,
	ReturnType<typeof TeamPage<never>>,
	ReturnType<typeof InvitationsPage<never>>,
	ReturnType<typeof GeneralPage<never>>,
	ReturnType<typeof ChannelDetails<never>>,
	ReturnType<typeof OverviewPage<never>>,
	ReturnType<typeof ConnectPage<never>>,
]

interface Entry<Tag extends RouteTag> {
	/** The tab whose root this route is (it selects that tab instead of pushing). */
	readonly tab?: AppTab
	/** The bar's title (a fallback's, or a framed page's). */
	readonly title?: string
	/**
	 * A page the web frames in its shell (its root is not a `screen`): the host puts it in a screen
	 * with `title`, so the phone's bar names it.
	 */
	readonly framed?: true
	readonly screen?: <Msg>(
		h: Hazel.H<Msg>,
		inputs: ScreenInputs<Tag>,
	) => View.Child<Msg, ScreenServices> | null
}

type Registry = { readonly [Tag in RouteTag]?: Entry<Tag> }

/** The session's organization and user, once known (the phone draws its shell only then). */
const ids = (session: Session) => ({
	organizationId: session.organization?.id,
	userId: session.user?.id,
	orgSlug: session.orgSlug ?? "",
})

const inbox =
	<Tag extends RouteTag>(tab: InboxTab): Entry<Tag>["screen"] =>
	(h, { key, session, nowMs }) =>
		HostedNotificationsPage(h, { key, props: { session, tab, nowMs, isMobile: true } })

export const screens: Registry = {
	ChatIndex: {
		tab: "home",
		screen: (h, { key, session }) => {
			const { organizationId, userId, orgSlug } = ids(session)
			if (organizationId === undefined || userId === undefined) return null
			return HostedChannelSidebar(h, {
				key,
				props: {
					organizationId,
					userId,
					orgSlug,
					activeChannelId: null,
					membersActive: false,
					hintDismissed: true,
					paletteKey: null,
					chrome: true,
				},
			})
		},
	},
	ChatDms: {
		tab: "dms",
		title: "DMs",
		screen: (h, { key, session, nowMs }) => {
			const { organizationId, userId, orgSlug } = ids(session)
			if (organizationId === undefined || userId === undefined) return null
			return HostedDms(h, { key, props: { organizationId, userId, orgSlug, nowMs } })
		},
	},
	NotificationsMentions: { tab: "activity", title: "Mentions", framed: true, screen: inbox("mentions") },
	NotificationsUnreads: { title: "Unreads", framed: true, screen: inbox("unreads") },
	NotificationsAll: { title: "All activity", framed: true, screen: inbox("all") },
	ChatChannel: {
		screen: (h, { key, route, session, cdnUrl, linkPreviewUrl, nowMs }) => {
			const { organizationId, userId } = ids(session)
			if (organizationId === undefined || userId === undefined) return null
			return HostedChannelScreen(h, {
				key,
				props: {
					orgSlug: route.orgSlug,
					channelId: route.channelId,
					organizationId,
					userId,
					cdnUrl,
					linkPreviewUrl,
					nowMs,
				},
			})
		},
	},
	OrgMore: {
		tab: "more",
		title: "More",
		screen: (h, { key, route, session }) =>
			MorePage(h, { key, props: { session, hrefs: moreHrefsOf(route.orgSlug) } }),
	},
	// Members (the web's `OrgHome`): pushed under Home, as the web keeps it under Home.
	OrgHome: {
		title: "Members",
		framed: true,
		screen: (h, { key, session }) => HostedHomePage(h, { key, props: { session, isMobile: true } }),
	},
	Profile: {
		title: "Profile",
		framed: true,
		screen: (h, { key, route, session }) =>
			ProfilePage(h, {
				key,
				props: {
					userId: route.userId,
					session,
					editHref: hrefOf(AppRoute.MySettingsProfile({ orgSlug: route.orgSlug })),
				},
			}),
	},
	// Channel settings as a phone's details list, each page pushed (the web's tabs and header).
	ChannelSettings: {
		title: "Details",
		framed: true,
		screen: (h, { key, route }) =>
			ChannelDetails(h, { key, props: { orgSlug: route.orgSlug, channelId: route.channelId } }),
	},
	ChannelSettingsOverview: {
		title: "Overview",
		framed: true,
		screen: (h, { key, route, session }) =>
			OverviewPage(h, {
				key,
				props: {
					channelId: route.channelId,
					session,
					customerHrefPrefix: `${hrefOf(AppRoute.CustomersOverview({ orgSlug: route.orgSlug }))}/`,
				},
			}),
	},
	ChannelSettingsIntegrations: { title: "Integrations" },
	ChannelSettingsConnect: {
		title: "Connect",
		framed: true,
		screen: (h, { key, route, session }) =>
			ConnectPage(h, { key, props: { channelId: route.channelId, session } }),
	},
	ChatFiles: { title: "Files" },
	ChatFilesMedia: { title: "Media" },
	// Workspace settings (`settings/pages`): the app's data, the clipboard, image uploads.
	SettingsGeneral: {
		title: "Workspace",
		framed: true,
		screen: (h, { key, route, session, appOrigin, nowMs }) =>
			GeneralPage(h, { key, props: { session, orgSlug: route.orgSlug, origin: appOrigin, nowMs } }),
	},
	TeamSettings: {
		title: "Team",
		framed: true,
		screen: (h, { key, session }) => TeamPage(h, { key, props: { session } }),
	},
	SettingsInvitations: {
		title: "Invitations",
		framed: true,
		screen: (h, { key, session }) => InvitationsPage(h, { key, props: { session } }),
	},
}

/** A route's entry. */
const entryOf = <Tag extends RouteTag>(route: RouteOf<Tag>): Entry<Tag> | undefined =>
	// SAFETY: `Registry` maps each tag to its own `Entry`, and `route._tag` is `Tag`.
	screens[route._tag as Tag] as Entry<Tag> | undefined

export const tabOf = (route: AppRoute): AppTab | null => entryOf(route)?.tab ?? null
export const titleOf = (route: AppRoute): string => entryOf(route)?.title ?? ""

/** The screen `route` draws, or `null` when it has none (the host's fallback). */
export const screenOf = <Msg>(
	h: Hazel.H<Msg>,
	inputs: Omit<ScreenInputs<RouteTag>, "route" | "key">,
	route: AppRoute,
) => entryOf(route)?.screen?.(h, { ...inputs, route, key: hrefOf(route) }) ?? null

/** The title of the screen a host puts a framed page in (`Entry.framed`), or `null` for none. */
export const frameOf = (route: AppRoute): string | null => {
	const entry = entryOf(route)
	return entry?.framed === true ? (entry.title ?? "") : null
}
