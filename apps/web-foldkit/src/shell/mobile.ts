import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconChevronLeft, IconGear, IconMenu, IconMsgs, IconOffice } from "../icons"
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
import { button } from "../ui/button"
import * as Modal from "../ui/modal"
import * as Sheet from "../ui/sheet"
import type { ShellContext } from "./context"

/** The phone shell (`useSidebar().isMobile`): tab bar, top bars, the sidebar sheet and its buttons. */

export const MOBILE_SIDEBAR_ID = "mobile-sidebar"

/**
 * A tab: a 44pt-plus target the width of its share of the bar. Pressed, it dims at once
 * (`active:`), as a native tab does under the finger; there is no hover on a phone.
 */
const NAV_ITEM =
	"flex min-h-12 flex-1 flex-col items-center justify-center gap-1 pt-1.5 pb-1 transition-opacity duration-100 active:opacity-60"

/**
 * The tab bar: Chats, Activity, Customers and Settings, as a phone app's tabs. Chats is the channel
 * list (`ChatIndex` on a phone) and the pages it opens; the bar is not shown inside a
 * conversation, whose header leads back. Its own background runs under the home indicator.
 */
export const mobileNav = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	unreadNotificationCount: number,
): Html => {
	const { orgSlug, route } = context
	/** `isActive` colours the item; `isLinkActive` is TanStack `Link`'s own (fuzzy) match. */
	const link = (label: string, href: string, isActive: boolean, icon: Html, badge?: Html) =>
		h.a(
			[
				h.Class(twMerge(NAV_ITEM, isActive ? "text-primary" : "text-muted-fg", isActive && "active")),
				h.Href(href),
				...(isActive
					? [h.Attribute("aria-current", "page"), h.Attribute("data-status", "active")]
					: []),
			],
			[
				h.span([h.Class("relative")], [icon, ...(badge === undefined ? [] : [badge])]),
				h.span([h.Class("font-medium text-[10px] leading-none")], [label]),
			],
		)
	const unread =
		unreadNotificationCount > 0
			? h.span(
					[
						h.Class(
							"absolute -top-1 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-semibold text-[10px] text-white tabular-nums leading-none",
						),
					],
					[unreadNotificationCount > 99 ? "99+" : String(unreadNotificationCount)],
				)
			: undefined
	return h.nav(
		[
			h.AriaLabel("Tabs"),
			h.Class(
				"shrink-0 border-sidebar-border border-t bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden",
			),
		],
		[
			h.div(
				[h.Class("flex h-14 items-stretch px-2")],
				[
					link(
						"Chats",
						hrefOf(AppRoute.ChatIndex({ orgSlug })),
						isChatRoute(route) || route._tag === "OrgHome",
						IconMsgs(h, { className: "size-6" }),
					),
					link(
						"Activity",
						hrefOf(AppRoute.NotificationsAll({ orgSlug })),
						isNotificationsRoute(route),
						IconBell(h, { className: "size-6" }),
						unread,
					),
					link(
						"Customers",
						hrefOf(AppRoute.CustomersOverview({ orgSlug })),
						isCustomersRoute(route),
						IconOffice(h, { className: "size-6" }),
					),
					link(
						"Settings",
						hrefOf(AppRoute.SettingsGeneral({ orgSlug })),
						isSettingsRoute(route) || isMySettingsRoute(route),
						IconGear(h, { className: "size-6" }),
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
	return { hasTabBar: true, topBar: { _tag: "Section", title: SECTION_TITLES[section] } }
}

const TOP_BAR = "flex h-12 shrink-0 items-center gap-1 border-border border-b bg-bg px-2"

/** The top bar a page without its own header gets on a phone. */
export const mobileTopBar = <Message>(
	h: HtmlBuilder<Message>,
	bar: MobileTopBar,
	onMenu: Attribute<Message>,
): Html =>
	h.header(
		[h.Class(TOP_BAR)],
		bar._tag === "Back"
			? [
					mobileBackLink(h, bar.href, "Chats"),
					h.h1(
						[h.Class("min-w-0 flex-1 truncate pr-11 text-center font-semibold text-base")],
						[bar.title],
					),
				]
			: [
					button(
						h,
						{
							intent: "plain",
							size: "sq-md",
							className: "size-11",
							attributes: [h.AriaLabel(`${bar.title} menu`), onMenu],
						},
						[IconMenu(h, { className: "size-5" })],
					),
					h.h1([h.Class("min-w-0 flex-1 truncate font-semibold text-base")], [bar.title]),
				],
	)

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
