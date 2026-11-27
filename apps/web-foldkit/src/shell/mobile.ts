import { Effect, Schema, Stream } from "effect"
import { Mount } from "foldkit"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import {
	IconBell,
	IconChevronLeft,
	IconDots,
	IconMagnifier3,
	IconMenu,
	IconMsgs,
	IconMsgUser,
} from "../icons"
import {
	AppRoute,
	channelSettingsTabOf,
	hrefOf,
	isChannelChatRoute,
	isChatRoute,
	isCustomersRoute,
	isMySettingsRoute,
	isNotificationsRoute,
	isSettingsRoute,
	type OrgSection,
	orgSectionOf,
	orgSlugOf,
} from "../route"
import { nativeIsland, nativeItem } from "../platform/native-island"
import { systemUi } from "../platform/system-ui"
import { button } from "../ui/button"
import type { ShellContext } from "./context"
import { countBadge } from "../ui/count-badge"
import { mobileTopBar as topBar } from "../ui/mobile-top-bar"

/** The phone shell's Foldkit parts: which chrome a route gets, the back link and the sidebar sheet. */

/** What a phone shows around the page: the tab bar, and a top bar for pages that have no header. */
export type MobileChrome = Readonly<{
	/** The tab bar; not inside a conversation, which fills the screen down to its composer. */
	hasTabBar: boolean
	/** A top bar over the page: back to the chat list, the section's menu, or none. */
	topBar: MobileTopBar | null
}>

export type MobileTopBar =
	| Readonly<{ _tag: "Back"; title: string; href: string }>
	| Readonly<{ _tag: "Section"; title: string }>

const SECTION_TITLES = {
	Settings: "Settings",
	MySettings: "Settings",
	Notifications: "Activity",
	Customers: "Customers",
} as const satisfies Record<Exclude<OrgSection, "Chat">, string>

/** The bar's title: the section, or for Activity the inbox shown (its page has no heading on a phone). */
const sectionTitleOf = (route: AppRoute, section: Exclude<OrgSection, "Chat">): string =>
	AppRoute.matchOrElse(
		route,
		{
			NotificationsMentions: () => "Mentions",
			NotificationsUnreads: () => "Unreads",
			NotificationsAll: () => "All activity",
		},
		() => SECTION_TITLES[section],
	)

/**
 * The chrome a route gets on a phone. The chat list draws its own header (the org switcher); a
 * conversation and a channel's settings draw a header that leads back; Members is a page the chat
 * list opens; the other sections have a secondary sidebar, which their top bar's menu opens.
 */
export const mobileChromeOf = (route: AppRoute): MobileChrome => {
	const orgSlug = orgSlugOf(route)
	const section = orgSectionOf(route)
	if (orgSlug === undefined || section === undefined) return { hasTabBar: false, topBar: null }
	if (isChannelChatRoute(route) || channelSettingsTabOf(route) !== undefined)
		return { hasTabBar: false, topBar: null }
	if (route._tag === "OrgHome")
		return {
			hasTabBar: true,
			topBar: { _tag: "Back", title: "Members", href: hrefOf(AppRoute.ChatIndex({ orgSlug })) },
		}
	if (section === "Chat") return { hasTabBar: true, topBar: null }
	return { hasTabBar: true, topBar: { _tag: "Section", title: sectionTitleOf(route, section) } }
}

/**
 * While a back chevron is on screen, the swipe from the screen's left edge goes where it leads, as
 * a phone's navigation does (where the shell has the swipe: `platform/system-ui.ts`).
 */
