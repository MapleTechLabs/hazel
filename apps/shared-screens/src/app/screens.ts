// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The app's screens by route, in one place: the shared screen a route draws (`screenOf`), the tab
 * whose root it is and the title its bar shows (`routeMeta`). A host draws a route with no screen as
 * its fallback (the phone's `FallbackScreen`). Bringing a screen to a host is one entry here.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { ChannelScreen } from "../phone/ChannelScreen"
import { HostedActivity, HostedChannelSidebar, HostedDms } from "./hosted"
import { AppRoute, hrefOf, type RouteTag } from "./route"

/** The phone's tabs, by the root route each opens. */
export const AppTab = Schema.Literals(["home", "dms", "activity", "more"])
export type AppTab = typeof AppTab.Type

/** What a screen is drawn for: the signed-in user in one organization, on one install, now. */
export interface ScreenContext {
	readonly userId: UserId
	readonly organizationId: OrganizationId
	readonly memberId: OrganizationMemberId
	readonly orgSlug: string
	readonly cdnUrl: string
	readonly linkPreviewUrl: string
	readonly nowMs: number
}

/** A route's place in the app: the tab it is the root of, and its bar's title. */
interface RouteMeta {
	readonly tab?: AppTab
	readonly title?: string
}

export const routeMeta = {
	ChatIndex: { tab: "home" },
	// Members (the web's `OrgHome`): pushed under Home, as the web keeps it under Home.
	OrgHome: { title: "Members" },
	ChatDms: { tab: "dms", title: "DMs" },
	NotificationsMentions: { tab: "activity" },
	NotificationsUnreads: { tab: "activity" },
	NotificationsAll: { tab: "activity" },
	OrgMore: { tab: "more", title: "More" },
	ChatFiles: { title: "Files" },
	ChatFilesMedia: { title: "Media" },
	Profile: { title: "Profile" },
	TeamSettings: { title: "Members" },
} satisfies { readonly [Tag in RouteTag]?: RouteMeta }

const metaOf = (route: AppRoute): RouteMeta | undefined =>
	// SAFETY: the `in` check just found the tag among the table's keys.
	route._tag in routeMeta ? routeMeta[route._tag as keyof typeof routeMeta] : undefined

/** The route each tab opens at. */
export const tabRoot = (tab: AppTab, orgSlug: string): AppRoute =>
	({
		home: AppRoute.ChatIndex({ orgSlug }),
		dms: AppRoute.ChatDms({ orgSlug }),
		activity: AppRoute.NotificationsMentions({ orgSlug }),
		more: AppRoute.OrgMore({ orgSlug }),
	})[tab]

export const tabOf = (route: AppRoute): AppTab | null => metaOf(route)?.tab ?? null
export const titleOf = (route: AppRoute): string => metaOf(route)?.title ?? ""

/** The shared screen `route` draws, keyed by its href; `null` when it has none yet. */
export const screenOf = <Msg>(h: Hazel.H<Msg>, context: ScreenContext, route: AppRoute) => {
	const key = hrefOf(route)
	const { organizationId, userId, orgSlug, nowMs } = context
	const activity = (tab: "mentions" | "all") =>
		HostedActivity(h, { key, props: { memberId: context.memberId, orgSlug, tab, nowMs, titled: true } })
	const sidebar = () =>
		HostedChannelSidebar(h, {
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
	return AppRoute.matchOrElse(
		route,
		{
			ChatIndex: sidebar,
			ChatDms: () => HostedDms(h, { key, props: { organizationId, userId, orgSlug, nowMs } }),
			NotificationsMentions: () => activity("mentions"),
			NotificationsUnreads: () => activity("all"),
			NotificationsAll: () => activity("all"),
			ChatChannel: ({ channelId }) =>
				ChannelScreen(h, {
					key,
					props: {
						channelId,
						organizationId,
						userId,
						cdnUrl: context.cdnUrl,
						linkPreviewUrl: context.linkPreviewUrl,
						nowMs,
					},
				}),
		},
		() => null,
	)
}
