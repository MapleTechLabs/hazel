import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import {
	IconArrowPath,
	IconBell,
	IconCode,
	IconEmojiAdd,
	IconGear,
	IconGridCirclePlus,
	IconHashtag,
	IconIntegratio,
	IconMsgs,
	IconPaintbrush,
	IconShop,
	IconThread,
	IconUser,
	IconUsers,
	IconUsersPlus,
} from "../icons"
import { button } from "../ui/button"
import {
	sidebarContent,
	sidebarHeader,
	sidebarItem,
	sidebarLabel,
	sidebarLink,
	sidebarSection,
	sidebarSectionGroup,
	sidebarStatic,
} from "../ui/sidebar"
import type { SidebarChrome } from "./channels-sidebar"
import { isActiveFuzzy, type ShellContext } from "./context"
import { orgSwitcherHeader, userMenuFooter } from "./menus"

/** The settings, my-settings and notifications sidebars next to the nav rail. */

const SECTION_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

type IconView = typeof IconGear

const navList = <Message>(h: HtmlBuilder<Message>) => {
	const item = (
		label: string,
		to: string,
		state: { readonly isCurrent: boolean; readonly isLinkActive: boolean },
		icon: IconView,
	) =>
		sidebarItem(h, { isCurrent: state.isCurrent }, [
			sidebarLink(h, { href: to, isActive: state.isLinkActive, activeClassName: SECTION_ACTIVE }, [
				icon(h, { attributes: { "data-slot": "icon" } }),
				sidebarLabel(h, [label]),
			]),
		])
	return item
}

const sectionTitle = <Message>(h: HtmlBuilder<Message>, title: string) =>
	h.div(
		[h.Class("px-3 pt-3 pb-1")],
		[h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], [title])],
	)

/** `SettingsSidebar` */
export const settingsSidebar = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	chrome: SidebarChrome<Message>,
): Html => {
	const base = `/${context.orgSlug}/settings`
	const path = context.pathname
	const item = navList(h)
	const fuzzy = (to: string) => ({
		isCurrent: isActiveFuzzy(path, to),
		isLinkActive: isActiveFuzzy(path, to),
	})
	const integrationSubRoutes = ["marketplace", "installed", "your-apps"].map(
		(sub) => `${base}/integrations/${sub}`,
	)
	const isBaseIntegrations =
		path === `${base}/integrations` ||
		(isActiveFuzzy(path, `${base}/integrations`) &&
			!integrationSubRoutes.some((sub) => isActiveFuzzy(path, sub)))

	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, chrome.orgSwitcher, context, chrome.organizations, chrome.toOrgSwitcherMessage),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sectionTitle(h, "Settings"),
				sidebarSection(h, {}, [
					item(
						"General",
						base,
						{ isCurrent: path === base, isLinkActive: path === base },
						IconGear,
					),
					item(
						"Team",
						`${base}/team`,
						{
							isCurrent: path === `${base}/team`,
							isLinkActive: isActiveFuzzy(path, `${base}/team`),
						},
						IconUsers,
					),
					item("Invitations", `${base}/invitations`, fuzzy(`${base}/invitations`), IconUsersPlus),
					item(
						"Custom Emoji",
						`${base}/custom-emojis`,
						fuzzy(`${base}/custom-emojis`),
						IconEmojiAdd,
					),
				]),
				sidebarSection(h, { label: "Apps & Integrations" }, [
					item(
						"Integrations",
						`${base}/integrations`,
						{ isCurrent: isBaseIntegrations, isLinkActive: path === `${base}/integrations` },
						IconIntegratio,
					),
					item(
						"Marketplace",
						`${base}/integrations/marketplace`,
						fuzzy(`${base}/integrations/marketplace`),
						IconShop,
					),
					item(
						"Installed Apps",
						`${base}/integrations/installed`,
						fuzzy(`${base}/integrations/installed`),
						IconGridCirclePlus,
					),
					item(
						"Your Apps",
						`${base}/integrations/your-apps`,
						fuzzy(`${base}/integrations/your-apps`),
						IconCode,
					),
				]),
				sidebarSection(h, { label: "Hazel Connect" }, [
					item(
						"Connect Invites",
						`${base}/connect-invites`,
						fuzzy(`${base}/connect-invites`),
						IconArrowPath,
					),
				]),
				sidebarSection(h, { label: "Chat Sync" }, [
					item("Connections", `${base}/chat-sync`, fuzzy(`${base}/chat-sync`), IconArrowPath),
				]),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			context,
			chrome.toUserMenuMessage,
			chrome.userStatus,
			chrome.statusExpiration,
		),
	])
}

/** `MySettingsSidebar` (web build: no Desktop item, which is Tauri-only). */
export const mySettingsSidebar = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	chrome: SidebarChrome<Message>,
): Html => {
	const base = `/${context.orgSlug}/my-settings`
	const path = context.pathname
	const item = navList(h)
	const fuzzy = (to: string) => ({
		isCurrent: isActiveFuzzy(path, to),
		isLinkActive: isActiveFuzzy(path, to),
	})
	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, chrome.orgSwitcher, context, chrome.organizations, chrome.toOrgSwitcherMessage),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sectionTitle(h, "My Settings"),
				sidebarSection(h, {}, [
					item(
						"Appearance",
						base,
						{ isCurrent: path === base, isLinkActive: path === base },
						IconPaintbrush,
					),
					item("Profile", `${base}/profile`, fuzzy(`${base}/profile`), IconUser),
					item(
						"Linked Accounts",
						`${base}/linked-accounts`,
						fuzzy(`${base}/linked-accounts`),
						IconArrowPath,
					),
					item("Notifications", `${base}/notifications`, fuzzy(`${base}/notifications`), IconBell),
				]),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			context,
			chrome.toUserMenuMessage,
			chrome.userStatus,
			chrome.statusExpiration,
		),
	])
}

/** `NotificationsSidebar`; "Mark all as read" follows the optimistic unread count. */
export const notificationsSidebar = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	chrome: SidebarChrome<Message>,
	markAllRead: Readonly<{ unreadCount: number; isPending: boolean; onPress: Attribute<Message> }>,
): Html => {
	const base = `/${context.orgSlug}/notifications`
	const path = context.pathname
	const item = navList(h)
	const fuzzy = (to: string) => ({
		isCurrent: isActiveFuzzy(path, to),
		isLinkActive: isActiveFuzzy(path, to),
	})
	return sidebarStatic(h, "flex flex-1", [
		sidebarHeader(h, { state: "expanded", className: "border-b py-4 h-14" }, [
			h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], ["Activity"]),
		]),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, {}, [
					// Legacy also matches `/notifications/` fuzzily, so All Activity stays current on sub-pages.
					item(
						"All Activity",
						base,
						{ isCurrent: isActiveFuzzy(path, base), isLinkActive: path === base },
						IconBell,
					),
					item("Channels", `${base}/general`, fuzzy(`${base}/general`), IconHashtag),
					item("Threads", `${base}/threads`, fuzzy(`${base}/threads`), IconThread),
					item("Direct Messages", `${base}/dms`, fuzzy(`${base}/dms`), IconMsgs),
				]),
				...(markAllRead.unreadCount > 0
					? [
							sidebarSection(h, {}, [
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										className: "w-full",
										isPending: markAllRead.isPending,
										attributes: [markAllRead.onPress],
									},
									["Mark all as read"],
								),
							]),
						]
					: []),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			context,
			chrome.toUserMenuMessage,
			chrome.userStatus,
			chrome.statusExpiration,
		),
	])
}
