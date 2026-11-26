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

/** The phone shell's Foldkit parts: which chrome a route gets, the back link and the sidebar sheet. */

export const MOBILE_SIDEBAR_ID = "mobile-sidebar"

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
