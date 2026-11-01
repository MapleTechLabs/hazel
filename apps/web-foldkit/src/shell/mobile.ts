import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconDashboard, IconGear, IconMenu, IconMsgs } from "../icons"
import {
	AppRoute,
	hrefOf,
	isChannelChatRoute,
	isChatRoute,
	isNotificationsRoute,
	isSettingsRoute,
} from "../route"
import { button } from "../ui/button"
import * as Modal from "../ui/modal"
import * as Sheet from "../ui/sheet"
import type { ShellContext } from "./context"

/** The mobile shell (`useSidebar().isMobile`): bottom nav, the sidebar sheet and its menu buttons. */

export const MOBILE_SIDEBAR_ID = "mobile-sidebar"

const NAV_ITEM = "flex flex-col items-center justify-center gap-0.5 px-3 py-2 transition-colors"

/** `MobileNav`: Home is exact, Messages needs a channel id (`/$orgSlug/chat/$id`), the rest are fuzzy. */
export const mobileNav = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	onMenu: Attribute<Message>,
): Html => {
	const { orgSlug } = context
	const home = hrefOf(AppRoute.OrgHome({ orgSlug }))
	const chat = hrefOf(AppRoute.ChatIndex({ orgSlug }))
	const notifications = hrefOf(AppRoute.NotificationsAll({ orgSlug }))
	const settings = hrefOf(AppRoute.SettingsGeneral({ orgSlug }))
	const { route } = context
	/** `isActive` colours the item; `isLinkActive` is TanStack `Link`'s own (fuzzy) match. */
	const link = (label: string, href: string, isActive: boolean, isLinkActive: boolean, icon: Html) =>
		h.a(
			[
				h.Class(
					twMerge(
						NAV_ITEM,
						isActive ? "text-primary" : "text-muted-fg hover:text-fg",
						isLinkActive && "active",
					),
				),
				h.Href(href),
				...(isLinkActive
					? [h.Attribute("aria-current", "page"), h.Attribute("data-status", "active")]
					: []),
			],
			[icon, h.span([h.Class("font-medium text-[10px]")], [label])],
		)
	return h.nav(
		[
			h.Class(
				"fixed inset-x-0 bottom-0 z-50 border-sidebar-border border-t bg-sidebar/95 backdrop-blur-lg md:hidden",
			),
		],
		[
			h.div(
				[h.Class("flex h-16 items-center justify-around px-2")],
				[
					h.button(
						[
							h.Attribute("type", "button"),
							onMenu,
							h.Class(twMerge(NAV_ITEM, "text-muted-fg hover:text-fg")),
						],
						[
							IconMenu(h, { className: "size-6" }),
							h.span([h.Class("font-medium text-[10px]")], ["Menu"]),
						],
					),
					link(
						"Home",
						home,
						route._tag === "OrgHome",
						route._tag === "OrgHome",
						IconDashboard(h, { className: "size-6" }),
					),
					link(
						"Messages",
						chat,
						isChannelChatRoute(route),
						isChatRoute(route),
						IconMsgs(h, { className: "size-6" }),
					),
					link(
						"Activity",
						notifications,
						isNotificationsRoute(route),
						isNotificationsRoute(route),
						IconBell(h, { className: "size-6" }),
					),
					link(
						"Settings",
						settings,
						isSettingsRoute(route),
						isSettingsRoute(route),
						IconGear(h, { className: "size-6" }),
					),
				],
			),
			h.div([h.Class("h-safe-area-inset-bottom bg-sidebar")]),
		],
	)
}

/** The `ChatHeader` menu button (shown only on mobile); pages pass their own click Message. */
export const mobileMenuButton = <Message>(
	h: HtmlBuilder<Message>,
	options: Readonly<{ onPress: Attribute<Message>; className?: string }>,
): Html =>
	button(
		h,
		{
			intent: "plain",
			size: "sq-xs",
			className: twMerge("-ml-1 md:hidden", options.className),
			attributes: [h.AriaLabel("Open sidebar"), options.onPress],
		},
		[IconMenu(h, { className: "size-5" })],
	)

/** `<span className="sr-only" aria-hidden data-intent>`: what `<Sidebar>` leaves in place on mobile. */
export const mobileSidebarPlaceholder = <Message>(h: HtmlBuilder<Message>): Html =>
	h.span([h.Attribute("aria-hidden", "true"), h.Class("sr-only"), h.Attribute("data-intent", "default")])

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
			closeButton: false,
			ariaLabel: "Sidebar",
			panelAttributes: { "data-slot": "sidebar", "data-intent": "default" },
			className:
				"w-(--sidebar-width) [--sidebar-width:18rem] has-data-[slot=calendar]:[--sidebar-width:23rem]",
		},
		toParentMessage: options.toMessage,
	})
