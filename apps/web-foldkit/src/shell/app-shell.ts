import type { Html, HtmlBuilder } from "foldkit/html"
import { IconBell, IconDashboard, IconGear, IconMsgs, Logo } from "../icons"
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
import { isActiveFuzzy, type ShellContext } from "./context"

/**
 * Org shell: port of `routes/_app/$orgSlug/layout.tsx` + `AppSidebar` (nav rail and the
 * route's secondary sidebar) + `SidebarInset`. Desktop, expanded, web (no Tauri titlebar).
 */

const NAV_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-foreground"

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
									"absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-danger font-medium text-[10px] text-danger-fg",
								),
							],
							[unreadCount > 9 ? "9+" : `${unreadCount}`],
						),
					]
				: []),
		],
	)

/** `NavSidebar` */
const navRail = <Message>(h: HtmlBuilder<Message>, context: ShellContext, unreadCount: number): Html => {
	const org = `/${context.orgSlug}`
	const navItem = (label: string, to: string, isActive: boolean, icon: Html) =>
		sidebarItem(h, { ariaLabel: label, className: "size-9 justify-items-center" }, [
			sidebarLink(h, { href: to, isActive, activeClassName: NAV_ACTIVE }, [icon]),
		])
	return sidebarStatic(h, "hidden w-[calc(var(--sidebar-width-dock)+1px)] md:flex md:border-r", [
		sidebarHeader(h, { state: "expanded", className: "px-3 py-4  border-b h-14" }, [
			h.a(
				[
					h.Class(linkClassName({ hasHref: true, className: "flex items-center justify-center" })),
					h.Href("/"),
					h.Attribute("tabindex", "0"),
					h.Attribute("data-react-aria-pressable", "true"),
				],
				[Logo(h, { className: "size-7" })],
			),
		]),
		sidebarContent(h, { state: "expanded", className: "mask-none " }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, { className: "p-2! *:data-[slot=sidebar-section-inner]:gap-y-2" }, [
					navItem("Home", org, context.pathname === org, IconDashboard(h, { className: "size-5" })),
					navItem(
						"Chat",
						`${org}/chat`,
						isActiveFuzzy(context.pathname, `${org}/chat`),
						IconMsgs(h, { className: "size-5" }),
					),
					navItem(
						"Notifications",
						`${org}/notifications`,
						isActiveFuzzy(context.pathname, `${org}/notifications`),
						bellIcon(h, unreadCount),
					),
					navItem(
						"Settings",
						`${org}/settings`,
						isActiveFuzzy(context.pathname, `${org}/settings`),
						IconGear(h, { className: "size-5" }),
					),
				]),
			]),
		]),
		sidebarFooter(h, "p-2 ", [
			h.span([h.Class("text-center text-[10px] font-mono text-muted-fg")], ["v", context.appVersion]),
		]),
	])
}

/**
 * `SidebarProvider` > `AppSidebar` (nav rail + `secondarySidebar`) + `SidebarInset` > `page`.
 * `overlays` are the root's toaster, modal and command palette slots.
 */
export const orgShell = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	parts: Readonly<{
		page: Html
		secondarySidebar: Html
		unreadNotificationCount: number
		toaster: Html
		overlays: ReadonlyArray<Html>
	}>,
): Html =>
	h.div(
		[h.Id("app")],
		[
			parts.toaster,
			sidebarProvider(h, { width: "350px" }, [
				sidebarDock(
					h,
					{ state: "expanded", className: "overflow-hidden *:data-[sidebar=default]:flex-row" },
					[navRail(h, context, parts.unreadNotificationCount), parts.secondarySidebar],
				),
				// NOTE: legacy renders `MobileNav` and the command palette here; the mobile shell is wave 2.
				sidebarInset(h, "pb-16 md:pb-0", [parts.page]),
			]),
			...parts.overlays,
		],
	)
