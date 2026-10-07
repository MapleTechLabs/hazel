import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import {
	IconArrowPath,
	IconBell,
	IconChevronUpDown,
	IconCode,
	IconDashboard,
	IconEmojiAdd,
	IconGear,
	IconGridCirclePlus,
	IconIntegratio,
	IconMsgs,
	IconShop,
	IconUsers,
	IconUsersPlus,
	Logo,
} from "../icons"
import { avatar } from "../ui/avatar"
import { linkClassName } from "../ui/link"
import {
	sidebarContent,
	sidebarDock,
	sidebarFooter,
	sidebarHeader,
	sidebarInset,
	sidebarItem,
	sidebarLabel,
	sidebarLink,
	sidebarProvider,
	sidebarSection,
	sidebarSectionGroup,
	sidebarStatic,
} from "../ui/sidebar"

/**
 * Org shell: port of `routes/_app/$orgSlug/layout.tsx` + `AppSidebar` (nav rail and the
 * route's secondary sidebar) + `SidebarInset`. Desktop, expanded, web (no Tauri titlebar).
 */

export interface ShellContext {
	readonly orgSlug: string
	readonly pathname: string
	readonly organization: { readonly name: string; readonly logoUrl: string | null } | undefined
	readonly currentUser:
		| { readonly displayName: string; readonly email: string; readonly avatarUrl: string | null }
		| undefined
	readonly appVersion: string
}

const NAV_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
const SETTINGS_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

/** TanStack's default (non-exact) active match: the path equals or is nested under `to`. */
const isActiveFuzzy = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`)

const navRail = <Message>(h: HtmlBuilder<Message>, context: ShellContext): Html => {
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
						h.div([h.Class("relative")], [IconBell(h, { className: "size-5" })]),
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

export const orgSwitcherHeader = <Message>(h: HtmlBuilder<Message>, context: ShellContext): Html =>
	sidebarHeader(h, { state: "expanded", className: "border-b h-14" }, [
		h.button(
			[
				h.Class(
					"group/switcher relative flex items-center justify-between gap-x-2 font-semibold outline-hidden text-fg/80 hover:text-fg transition-colors focus-visible:ring focus-visible:ring-primary",
				),
				h.Attribute("type", "button"),
				h.Attribute("tabindex", "0"),
				h.Attribute("aria-haspopup", "true"),
				h.Attribute("aria-expanded", "false"),
				h.Attribute("data-react-aria-pressable", "true"),
			],
			[
				h.div(
					[h.Class("flex w-full items-center gap-1")],
					[
						h.span(
							[h.Class("flex gap-x-2 font-medium text-sm/6")],
							[
								avatar(h, {
									isSquare: true,
									size: "sm",
									src: context.organization?.logoUrl,
									seed: context.organization?.name,
								}),
								context.organization?.name ?? "",
							],
						),
						IconChevronUpDown(h, {
							className:
								"ml-auto size-4 text-muted-fg group-hover/switcher:text-fg transition-colors",
						}),
					],
				),
			],
		),
	])

export const userMenuFooter = <Message>(h: HtmlBuilder<Message>, context: ShellContext): Html => {
	const displayName = context.currentUser?.displayName ?? "User"
	return sidebarFooter(h, "flex flex-row justify-between gap-4 group-data-[state=collapsed]:flex-col", [
		h.button(
			[
				h.Attribute("data-slot", "menu-trigger"),
				h.Class(
					"relative text-left outline-hidden focus-visible:ring-1 focus-visible:ring-primary *:data-[slot=chevron]:size-5 sm:*:data-[slot=chevron]:size-4 flex w-full items-center justify-between rounded-lg border bg-accent/20 px-2 py-1 hover:bg-accent/50",
				),
				h.Attribute("type", "button"),
				h.Attribute("tabindex", "0"),
				h.Attribute("aria-haspopup", "true"),
				h.Attribute("aria-expanded", "false"),
				h.Attribute("data-react-aria-pressable", "true"),
				h.Attribute("aria-label", "Profile"),
			],
			[
				h.div(
					[h.Class("flex min-w-0 items-center gap-x-2")],
					[
						avatar(h, {
							className: twJoin([
								"[--avatar-radius:7%] group-data-[state=collapsed]:size-6 group-data-[state=collapsed]:*:size-6",
								"size-8 *:size-8",
							]),
							isSquare: true,
							src: context.currentUser?.avatarUrl,
							seed: displayName,
						}),
						h.div(
							[h.Class("in-data-[collapsible=dock]:hidden min-w-0 text-sm")],
							[
								sidebarLabel(h, [displayName]),
								...(context.currentUser?.email
									? [
											h.span(
												[h.Class("-mt-0.5 block max-w-36 truncate text-muted-fg")],
												[context.currentUser.email],
											),
										]
									: []),
							],
						),
					],
				),
				IconChevronUpDown(h, { className: "size-4", attributes: { "data-slot": "chevron" } }),
			],
		),
	])
}

const settingsSidebar = <Message>(h: HtmlBuilder<Message>, context: ShellContext): Html => {
	const base = `/${context.orgSlug}/settings`
	const path = context.pathname
	const integrationSubRoutes = ["marketplace", "installed", "your-apps"].map(
		(sub) => `${base}/integrations/${sub}`,
	)
	const isBaseIntegrations =
		path === `${base}/integrations` ||
		(isActiveFuzzy(path, `${base}/integrations`) &&
			!integrationSubRoutes.some((sub) => isActiveFuzzy(path, sub)))

	const item = (
		label: string,
		to: string,
		options: { isCurrent: boolean; isLinkActive: boolean },
		icon: Html,
	) =>
		sidebarItem(h, { isCurrent: options.isCurrent }, [
			sidebarLink(h, { href: to, isActive: options.isLinkActive, activeClassName: SETTINGS_ACTIVE }, [
				icon,
				sidebarLabel(h, [label]),
			]),
		])
	const fuzzy = (to: string) => ({
		isCurrent: isActiveFuzzy(path, to),
		isLinkActive: isActiveFuzzy(path, to),
	})
	const icon = (render: typeof IconGear) => render(h, { attributes: { "data-slot": "icon" } })

	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, context),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				h.div(
					[h.Class("px-3 pt-3 pb-1")],
					[
						h.span(
							[h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")],
							["Settings"],
						),
					],
				),
				sidebarSection(h, {}, [
					item(
						"General",
						base,
						{ isCurrent: path === base, isLinkActive: path === base },
						icon(IconGear),
					),
					item(
						"Team",
						`${base}/team`,
						{
							isCurrent: path === `${base}/team`,
							isLinkActive: isActiveFuzzy(path, `${base}/team`),
						},
						icon(IconUsers),
					),
					item(
						"Invitations",
						`${base}/invitations`,
						fuzzy(`${base}/invitations`),
						icon(IconUsersPlus),
					),
					item(
						"Custom Emoji",
						`${base}/custom-emojis`,
						fuzzy(`${base}/custom-emojis`),
						icon(IconEmojiAdd),
					),
				]),
				sidebarSection(h, { label: "Apps & Integrations" }, [
					item(
						"Integrations",
						`${base}/integrations`,
						{ isCurrent: isBaseIntegrations, isLinkActive: path === `${base}/integrations` },
						icon(IconIntegratio),
					),
					item(
						"Marketplace",
						`${base}/integrations/marketplace`,
						fuzzy(`${base}/integrations/marketplace`),
						icon(IconShop),
					),
					item(
						"Installed Apps",
						`${base}/integrations/installed`,
						fuzzy(`${base}/integrations/installed`),
						icon(IconGridCirclePlus),
					),
					item(
						"Your Apps",
						`${base}/integrations/your-apps`,
						fuzzy(`${base}/integrations/your-apps`),
						icon(IconCode),
					),
				]),
				sidebarSection(h, { label: "Hazel Connect" }, [
					item(
						"Connect Invites",
						`${base}/connect-invites`,
						fuzzy(`${base}/connect-invites`),
						icon(IconArrowPath),
					),
				]),
				sidebarSection(h, { label: "Chat Sync" }, [
					item("Connections", `${base}/chat-sync`, fuzzy(`${base}/chat-sync`), icon(IconArrowPath)),
				]),
			]),
		]),
		userMenuFooter(h, context),
	])
}

/** Sonner's empty toaster region, rendered by the legacy root on every page. */
const toasterRegion = <Message>(h: HtmlBuilder<Message>): Html =>
	h.section(
		[
			h.Attribute("aria-label", "Notifications alt+T"),
			h.Attribute("tabindex", "-1"),
			h.Attribute("aria-live", "polite"),
			h.Attribute("aria-relevant", "additions text"),
			h.Attribute("aria-atomic", "false"),
		],
		[],
	)

/** `secondarySidebar` is the route's sidebar next to the nav rail (settings by default). */
export const orgShell = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	page: Html,
	secondarySidebar: Html = settingsSidebar(h, context),
): Html =>
	h.div(
		[h.Id("app")],
		[
			toasterRegion(h),
			sidebarProvider(h, { width: "350px" }, [
				sidebarDock(
					h,
					{ state: "expanded", className: "overflow-hidden *:data-[sidebar=default]:flex-row" },
					[navRail(h, context), secondarySidebar],
				),
				sidebarInset(h, "pb-16 md:pb-0", [page]),
			]),
		],
	)
