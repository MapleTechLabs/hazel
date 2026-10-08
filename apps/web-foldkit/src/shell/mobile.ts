import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconDashboard, IconGear, IconMenu, IconMsgs } from "../icons"
import { button } from "../ui/button"
import type * as Modal from "../ui/modal"
import * as Sheet from "../ui/sheet"
import { isActiveFuzzy, type ShellContext } from "./context"

/** The mobile shell (`useSidebar().isMobile`): bottom nav, the sidebar sheet and its menu buttons. */

export const MOBILE_SIDEBAR_ID = "mobile-sidebar"

const NAV_ITEM = "flex flex-col items-center justify-center gap-0.5 px-3 py-2 transition-colors"

/** `MobileNav`: Home is exact, Messages needs a channel id (`/$orgSlug/chat/$id`), the rest are fuzzy. */
export const mobileNav = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	onMenu: Attribute<Message>,
): Html => {
	const org = `/${context.orgSlug}`
	const path = context.pathname
	const link = (label: string, href: string, isActive: boolean, icon: Html) => {
		// TanStack `Link` marks any fuzzy match active, independently of the colour rule above.
		const isLinkActive = isActiveFuzzy(path, href)
		return h.a(
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
	}
	const chatPrefix = `${org}/chat/`
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
					link("Home", org, path === org, IconDashboard(h, { className: "size-6" })),
					link(
						"Messages",
						`${org}/chat`,
						path.startsWith(chatPrefix) && path.length > chatPrefix.length,
						IconMsgs(h, { className: "size-6" }),
					),
					link(
						"Activity",
						`${org}/notifications`,
						isActiveFuzzy(path, `${org}/notifications`),
						IconBell(h, { className: "size-6" }),
					),
					link(
						"Settings",
						`${org}/settings`,
						isActiveFuzzy(path, `${org}/settings`),
						IconGear(h, { className: "size-6" }),
					),
				],
			),
			h.div([h.Class("h-safe-area-inset-bottom bg-sidebar")], []),
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
			attributes: [options.onPress],
		},
		[IconMenu(h, { className: "size-5" })],
	)

/** `<span className="sr-only" aria-hidden data-intent>`: what `<Sidebar>` leaves in place on mobile. */
export const mobileSidebarPlaceholder = <Message>(h: HtmlBuilder<Message>): Html =>
	h.span(
		[h.Attribute("aria-hidden", "true"), h.Class("sr-only"), h.Attribute("data-intent", "default")],
		[],
	)

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
		model: { id: MOBILE_SIDEBAR_ID, isOpen: options.isOpen },
		view: Sheet.view,
		viewInputs: {
			// Controlled from the header and bottom nav, so the overlay renders without a trigger.
			toTrigger: (_attributes, overlay) => overlay,
			toContent: () => options.children,
			side: "left",
			closeButton: false,
			ariaLabel: "Sidebar",
			restoresFocusToPrevious: true,
			overlayAttributes: { "data-slot": "sidebar", "data-intent": "default" },
			className:
				"w-(--sidebar-width) entering:blur-in exiting:blur-out [--sidebar-width:18rem] has-data-[slot=calendar]:[--sidebar-width:23rem]",
		},
		toParentMessage: options.toMessage,
	})
