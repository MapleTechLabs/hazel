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
import * as Modal from "../ui/modal"
import * as Sheet from "../ui/sheet"
import type { ShellContext } from "./context"
import { countBadge } from "../ui/count-badge"
import { mobileTopBar as topBar } from "../ui/mobile-top-bar"

/** The phone shell (`useSidebar().isMobile`): tab bar, top bars, the sidebar sheet and its buttons. */

export const MOBILE_SIDEBAR_ID = "mobile-sidebar"

/**
 * A tab: a 44pt-plus target the width of its share of the bar. Pressed, it dims at once
 * (`active:`), as a native tab does under the finger; there is no hover on a phone.
 */
const NAV_ITEM =
	"flex flex-1 flex-col items-center justify-center gap-1 rounded-full transition-[opacity,background-color] duration-100 active:opacity-60"

/**
 * The tab bar, as Slack's: Home, DMs, Activity and More, and a round Search button beside them.
 * Home is the channel list (`ChatIndex` on a phone) and the pages it opens, DMs the direct messages
 * (`ChatDms`), More the account and the sections the bar has no room for (`OrgMore`: Customers,
 * settings). Search opens the command palette in message search. The bar is not shown inside a
 * conversation, whose header leads back. Its own background runs under the home indicator.
 *
 * On iOS the shell draws the island natively: the tabs as a Liquid Glass capsule with SF Symbols
 * (`data-native-symbol`), and the item marked `role: "search"` as its own glass circle.
 */
export const mobileNav = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	unreadNotificationCount: number,
	onSearch: Attribute<Message>,
): Html => {
	const { orgSlug, route } = context
	const link = (
		label: string,
		href: string,
		isActive: boolean,
		icon: Html,
		symbol: string,
		badge?: Readonly<{ html: Html; count: number }>,
	) =>
		h.a(
			[
				...nativeItem(h, { id: label, symbol, isSelected: isActive, badge: badge?.count }),
				h.Class(
					twMerge(
						NAV_ITEM,
						isActive ? "bg-primary-subtle/60 text-primary" : "text-muted-fg",
						isActive && "active",
					),
				),
				h.Href(href),
				...(isActive
					? [h.Attribute("aria-current", "page"), h.Attribute("data-status", "active")]
					: []),
			],
			[
				h.span([h.Class("relative")], [icon, ...(badge === undefined ? [] : [badge.html])]),
				h.span([h.Class("font-medium text-3xs leading-none")], [label]),
			],
		)
	const unread =
		unreadNotificationCount > 0
			? {
					count: unreadNotificationCount,
					html: countBadge(h, {
						count: unreadNotificationCount,
						isCapped: true,
						className:
							"absolute -top-1 -right-2 h-4 min-w-4 bg-danger px-1 font-semibold text-3xs text-danger-fg leading-none",
						// The native tab shows the count as its badge, not in its title.
						attributes: [h.Attribute("data-native-skip", "")],
					}),
				}
			: undefined
	const isMore =
		route._tag === "OrgMore" ||
		isCustomersRoute(route) ||
		isSettingsRoute(route) ||
		isMySettingsRoute(route)
	return h.nav(
		[
			h.AriaLabel("Tabs"),
			// A Liquid Glass bar on iOS; this markup everywhere else, and what its presses replay on.
			...nativeIsland(h, "tab-bar"),
			h.Class("shrink-0 bg-bg pb-[env(safe-area-inset-bottom)] md:hidden"),
		],
		[
			h.div(
				[h.Class("flex items-center gap-2 px-3 pt-1.5 pb-2")],
				[
					h.div(
						[
							h.Class(
								"flex h-14 flex-1 items-stretch gap-0.5 rounded-full border border-border bg-overlay p-1 shadow-md",
							),
						],
						[
							link(
								"Home",
								hrefOf(AppRoute.ChatIndex({ orgSlug })),
								// Members (`OrgHome`) opens from the channel list, so it stays under Home.
								(isChatRoute(route) && route._tag !== "ChatDms") || route._tag === "OrgHome",
								IconMsgs(h, { className: "size-5" }),
								"house",
							),
							link(
								"DMs",
								hrefOf(AppRoute.ChatDms({ orgSlug })),
								route._tag === "ChatDms",
								IconMsgUser(h, { className: "size-5" }),
								"bubble.left.and.bubble.right",
							),
							link(
								"Activity",
								hrefOf(AppRoute.NotificationsAll({ orgSlug })),
								isNotificationsRoute(route),
								IconBell(h, { className: "size-5" }),
								"bell",
								unread,
							),
							link(
								"More",
								hrefOf(AppRoute.OrgMore({ orgSlug })),
								isMore,
								IconDots(h, { className: "size-5" }),
								"ellipsis",
							),
						],
					),
					button(
						h,
						{
							intent: "plain",
							size: "sq-lg",
							className:
								"size-14 shrink-0 rounded-full border border-border bg-overlay text-fg shadow-md",
							attributes: [
								h.AriaLabel("Search"),
								onSearch,
								...nativeItem(h, { id: "Search", symbol: "magnifyingglass", role: "search" }),
							],
						},
						[IconMagnifier3(h, { className: "size-5" })],
					),
				],
			),
		],
	)
}

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
	MySettings: "Account",
	Notifications: "Activity",
	Customers: "Customers",
} as const satisfies Record<Exclude<OrgSection, "Chat">, string>

/** The bar's title: the section, or for Activity the inbox shown (its page has no heading on a phone). */
const sectionTitleOf = (route: AppRoute, section: Exclude<OrgSection, "Chat">): string =>
	AppRoute.matchOrElse(
		route,
		{
			NotificationsGeneral: () => "Channels",
			NotificationsThreads: () => "Threads",
			NotificationsDms: () => "Direct messages",
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

/** The top bar a page without its own header gets on a phone (the kit's, as every tab's screen has). */
export const mobileTopBar = <Message>(
	h: HtmlBuilder<Message>,
	bar: MobileTopBar,
	onMenu: Attribute<Message>,
): Html =>
	topBar(h, {
		title: bar.title,
		leading:
			bar._tag === "Back"
				? mobileBackLink(h, bar.href, "Chats")
				: button(
						h,
						{
							intent: "plain",
							size: "sq-md",
							className: "size-11",
							attributes: [h.AriaLabel(`${bar.title} menu`), onMenu],
						},
						[IconMenu(h, { className: "size-5" })],
					),
	})

/**
 * While a back chevron is on screen, the swipe from the screen's left edge goes where it leads, as
 * a phone's navigation does (where the shell has the swipe: `platform/system-ui.ts`).
 */
/**
 * What `SwipeBack` declares it sends, and never does: the shell follows the link itself. Foldkit
 * requires a Mount to declare a Message it can send; this one is never constructed, and the view
 * maps it away (`neverSent`), so `mobileBackLink` stays usable from any page's Message type.
 */
const SwipeBackFollowed = Schema.TaggedStruct("SwipeBackFollowed", {})

const neverSent = (message: typeof SwipeBackFollowed.Type): never => {
	throw new Error(`SwipeBack never sends a Message, yet sent ${message._tag}`)
}

const SwipeBack = Mount.defineStream("SwipeBack", {
	messages: [SwipeBackFollowed],
	// The swipe goes where the chevron's own link does.
	execute: ({ element }) =>
		Stream.unwrap(
			Effect.acquireRelease(
				Effect.sync(() => {
					const href = element.getAttribute("href")
					return href === null ? undefined : systemUi()?.setSwipeBack(href)
				}),
				(release) => Effect.sync(() => release?.()),
			).pipe(Effect.as(Stream.never)),
		),
})

/** A back chevron (44pt square) leading to `href`, labelled for where it goes. */
export const mobileBackLink = <Message>(
	h: HtmlBuilder<Message>,
	href: string,
	to: string,
	className?: string,
): Html =>
	h.a(
		[
			h.Href(href),
			h.AriaLabel(`Back to ${to}`),
			// Keyed by where it leads, so its swipe follows a new destination. Only a shell with
			// the swipe (installed before the app starts) gets the Mount; a browser has none.
			h.Key(`back:${href}`),
			...(systemUi() === undefined ? [] : [h.OnMount(Mount.mapMessage(SwipeBack(), neverSent))]),
			h.Class(
				twMerge(
					"-ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-primary transition-opacity duration-100 active:opacity-60 md:hidden",
					className,
				),
			),
		],
		[IconChevronLeft(h, { className: "size-6" })],
	)

/** The sheet's Model, derived from the shell's `isSidebarOpen`: open for as long as the flag is set. */
export const mobileSidebarModel = (isOpen: boolean): Modal.Model =>
	isOpen ? Modal.initOpen(MOBILE_SIDEBAR_ID) : Modal.init(MOBILE_SIDEBAR_ID)

/** `<Sidebar>` on mobile: a controlled left `SheetContent` labelled "Sidebar", without a close button. */
export const mobileSidebarSheet = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{
		isOpen: boolean
		children: ReadonlyArray<Html>
		toMessage: (message: Modal.Message) => Message
	}>,
): Html =>
	h.submodel({
		slotId: MOBILE_SIDEBAR_ID,
		model: mobileSidebarModel(options.isOpen),
		view: Sheet.view,
		viewInputs: {
			toContent: () => options.children,
			side: "left",
			// A drawer the screen's height, under the status bar and home indicator, as a phone's is.
			isFloat: false,
			closeButton: false,
			ariaLabel: "Sidebar",
			panelAttributes: { "data-slot": "sidebar", "data-intent": "default" },
			className:
				"w-(--sidebar-width) bg-sidebar [--sidebar-width:18rem] has-data-[slot=calendar]:[--sidebar-width:23rem]",
		},
		toParentMessage: options.toMessage,
	})
