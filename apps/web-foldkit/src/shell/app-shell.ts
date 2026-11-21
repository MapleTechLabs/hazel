import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { IconBell, Logo } from "../icons"
import {
	AppRoute,
	hrefOf,
	isChatRoute,
	isCustomersRoute,
	isNotificationsRoute,
	isSettingsRoute,
} from "../route"
import { linkClassName } from "../ui/link"
import {
	sidebarContent,
	sidebarDock,
	sidebarFooter,
	sidebarHeader,
	sidebarInset,
	sidebarItem,
	sidebarLink,
	sidebarProvider,
	sidebarSection,
	sidebarSectionGroup,
	sidebarStatic,
} from "../ui/sidebar"
import type * as Modal from "../ui/modal"
import type { ShellContext } from "./context"
import { type DestinationId, destination, destinationHref, isAvailable } from "./destinations"
import { mobileChromeOf, mobileNav, mobileSidebarSheet, mobileTopBar } from "./mobile"
import { hasDesktopTitlebar } from "../platform/desktop"

/**
 * Org shell: port of `routes/_app/$orgSlug/layout.tsx` + `AppSidebar` (nav rail and the
 * route's secondary sidebar) + `SidebarInset`. Expanded, web (no Tauri titlebar); on mobile the
 * sidebar moves into a sheet and `MobileNav` joins the inset.
 */

const NAV_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

/** `useUnreadNotificationCount` badge on the bell. */
const bellIcon = <Message>(h: HtmlBuilder<Message>, unreadCount: number): Html =>
	h.div(
		[h.Class("relative")],
		[
			IconBell(h, { className: "size-5" }),
			...(unreadCount > 0
				? [
						h.span(
							[
								h.Class(
									"absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-danger font-medium text-3xs text-danger-fg",
								),
							],
							[unreadCount > 9 ? "9+" : `${unreadCount}`],
						),
					]
				: []),
		],
	)

/** `NavSidebar` */
const navRail = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	unreadCount: number,
	assistantToggle: Html,
): Html => {
	const { orgSlug, route } = context
	const navItem = (id: DestinationId, isActive: boolean, icon?: Html) => {
		if (!isAvailable(id)) return h.empty
		const page = destination(id)
		return sidebarItem(h, { ariaLabel: page.label, className: "size-9 justify-items-center" }, [
			sidebarLink(h, { href: destinationHref(id, orgSlug), isActive, activeClassName: NAV_ACTIVE }, [
				icon ?? page.icon(h, { className: "size-5" }),
			]),
		])
	}
	// Under the macOS window controls the dock draws its own borders, below the titlebar strip.
	return sidebarStatic(
		h,
		`hidden w-[calc(var(--sidebar-width-dock)+1px)] md:flex ${hasDesktopTitlebar ? "" : "md:border-r"}`,
		[
			sidebarHeader(
				h,
				{
					state: "expanded",
					className: `px-3 py-4  border-b ${hasDesktopTitlebar ? "pt-14 relative before:absolute before:top-10 before:left-0 before:right-0 before:bottom-0 before:border-t before:border-r before:border-sidebar-border" : "h-14"}`,
				},
				[
					h.a(
						[
							h.Class(
								linkClassName({
									hasHref: true,
									className: "flex items-center justify-center",
								}),
							),
							h.Href(hrefOf(AppRoute.Root())),
							h.Attribute("tabindex", "0"),
							h.Attribute("data-react-aria-pressable", "true"),
						],
						[Logo(h, { className: "size-7" })],
					),
				],
			),
			sidebarContent(
				h,
				{
					state: "expanded",
					className: `mask-none ${hasDesktopTitlebar ? "border-r border-sidebar-border" : ""}`,
				},
				[
					sidebarSectionGroup(h, [
						sidebarSection(h, { className: "p-2! *:data-[slot=sidebar-section-inner]:gap-y-2" }, [
							navItem("home", route._tag === "OrgHome"),
							navItem("chat", isChatRoute(route)),
							navItem("customers", isCustomersRoute(route)),
							navItem("notifications", isNotificationsRoute(route), bellIcon(h, unreadCount)),
							navItem("settings", isSettingsRoute(route)),
						]),
					]),
				],
			),
			sidebarFooter(h, "flex-col gap-2 p-2", [
				assistantToggle,
				h.span([h.Class("text-center text-3xs font-mono text-muted-fg")], ["v", context.appVersion]),
			]),
		],
	)
}

export interface MobileShell<Message> {
	readonly isMobile: boolean
	/** Desktop only: the sidebar docked to its nav rail. */
	readonly isSidebarCollapsed: boolean
	readonly isSidebarOpen: boolean
	/** Opens the sidebar sheet (a section's top bar menu button, a header's). */
	readonly onMenu: Attribute<Message>
	readonly toSheetMessage: (message: Modal.Message) => Message
}

/**
 * `SidebarProvider` > `AppSidebar` (nav rail + `secondarySidebar`) + `SidebarInset` > `page`.
 * `overlays` are the root's toaster, modal and command palette slots.
 */
/** Whose screen this is, for the last screen's paint (`app/paint.ts`). */
const paintUser = <Message>(h: HtmlBuilder<Message>, context: ShellContext) =>
	context.currentUserId === undefined ? [] : [h.Attribute("data-paint-user", context.currentUserId)]

export const orgShell = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	parts: Readonly<{
		page: Html
		secondarySidebar: Html
		unreadNotificationCount: number
		toaster: Html
		overlays: ReadonlyArray<Html>
		mobile: MobileShell<Message>
		/** The AI panel (a right column on desktop, a sheet on phones) and the nav rail's toggle. */
		assistant: Readonly<{ panel: Html; toggle: Html }>
	}>,
): Html => {
	const sidebarChildren = [
		navRail(h, context, parts.unreadNotificationCount, parts.assistant.toggle),
		parts.secondarySidebar,
	]
	const { mobile } = parts
	if (mobile.isMobile) return phoneShell(h, context, parts, sidebarChildren)
	return h.div(
		// The screen the next load paints first (`app/paint.ts`).
		[h.Id("app"), h.Attribute("data-paint", "shell"), ...paintUser(h, context)],
		[
			parts.toaster,
			sidebarProvider(h, { width: "350px" }, [
				sidebarDock(
					h,
					{
						state: mobile.isSidebarCollapsed ? "collapsed" : "expanded",
						className: "overflow-hidden *:data-[sidebar=default]:flex-row",
					},
					sidebarChildren,
				),
				// NOTE: legacy also renders the command palette inside the inset; it lives in `overlays`.
				sidebarInset(h, "", [parts.page]),
				parts.assistant.panel,
			]),
			...parts.overlays,
		],
	)
}

/**
 * A phone's shell, laid out as an app rather than a scrolling page: one screen-high column with
 * an optional top bar, the page (which scrolls inside itself), and the tab bar. The page runs
 * edge to edge (`viewport-fit=cover`, and the native app always): the column keeps its content
 * out of the status bar, and the tab bar, or the page without one, out of the home indicator.
 */
const phoneShell = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	parts: Parameters<typeof orgShell<Message>>[2],
	sidebarChildren: Array<Html>,
): Html => {
	const { mobile } = parts
	const chrome = mobileChromeOf(context.route)
	return h.div(
		// The screen the next load paints first (`app/paint.ts`).
		[h.Id("app"), h.Attribute("data-paint", "shell"), ...paintUser(h, context)],
		[
			parts.toaster,
			sidebarProvider(
				h,
				{
					width: "350px",
					className:
						"h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
				},
				[
					sidebarInset(
						h,
						chrome.hasTabBar ? "min-h-0" : "min-h-0 pb-[env(safe-area-inset-bottom)]",
						[
							...(chrome.topBar === null
								? []
								: [mobileTopBar(h, chrome.topBar, mobile.onMenu)]),
							// Pages that fill the screen (`h-full`) scroll inside themselves; the rest scroll here.
							h.div(
								[h.Class("relative min-h-0 flex-1 overflow-y-auto overscroll-contain")],
								[parts.page],
							),
							...(chrome.hasTabBar
								? [mobileNav(h, context, parts.unreadNotificationCount)]
								: []),
						],
					),
				],
			),
			mobileSidebarSheet(h, {
				isOpen: mobile.isSidebarOpen,
				children: sidebarChildren,
				toMessage: mobile.toSheetMessage,
			}),
			parts.assistant.panel,
			...parts.overlays,
		],
	)
}
