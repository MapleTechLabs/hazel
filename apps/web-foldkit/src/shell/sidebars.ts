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
import { AppRoute, hrefOf, linkedAccountsHref } from "../route"
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
	const { orgSlug } = context
	const general = hrefOf(AppRoute.SettingsGeneral({ orgSlug }))
	const team = hrefOf(AppRoute.TeamSettings({ orgSlug }))
	const invitations = hrefOf(AppRoute.SettingsInvitations({ orgSlug }))
	const customEmojis = hrefOf(AppRoute.SettingsCustomEmojis({ orgSlug }))
	const integrations = hrefOf(AppRoute.SettingsIntegrations({ orgSlug }))
	const marketplace = hrefOf(AppRoute.SettingsIntegrationsMarketplace({ orgSlug }))
	const installed = hrefOf(AppRoute.SettingsIntegrationsInstalled({ orgSlug }))
	const yourApps = hrefOf(AppRoute.SettingsIntegrationsYourApps({ orgSlug }))
	const connectInvites = hrefOf(AppRoute.SettingsConnectInvites({ orgSlug }))
	const chatSync = hrefOf(AppRoute.SettingsChatSync({ orgSlug }))
	const path = context.pathname
	const item = navList(h)
	const fuzzy = (to: string) => ({
		isCurrent: isActiveFuzzy(path, to),
		isLinkActive: isActiveFuzzy(path, to),
	})
	const integrationSubRoutes = [marketplace, installed, yourApps]
	const isBaseIntegrations =
		path === integrations ||
		(isActiveFuzzy(path, integrations) && !integrationSubRoutes.some((sub) => isActiveFuzzy(path, sub)))

	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, chrome.orgSwitcher, context, chrome.organizations, chrome.toOrgSwitcherMessage),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sectionTitle(h, "Settings"),
				sidebarSection(h, {}, [
					item(
						"General",
						general,
						{ isCurrent: path === general, isLinkActive: path === general },
						IconGear,
					),
					item(
						"Team",
						team,
						{
							isCurrent: path === team,
							isLinkActive: isActiveFuzzy(path, team),
						},
						IconUsers,
					),
					item("Invitations", invitations, fuzzy(invitations), IconUsersPlus),
					item("Custom Emoji", customEmojis, fuzzy(customEmojis), IconEmojiAdd),
				]),
				sidebarSection(h, { label: "Apps & Integrations" }, [
					item(
						"Integrations",
						integrations,
						{ isCurrent: isBaseIntegrations, isLinkActive: path === integrations },
						IconIntegratio,
					),
					item("Marketplace", marketplace, fuzzy(marketplace), IconShop),
					item("Installed Apps", installed, fuzzy(installed), IconGridCirclePlus),
					item("Your Apps", yourApps, fuzzy(yourApps), IconCode),
				]),
				sidebarSection(h, { label: "Hazel Connect" }, [
					item("Connect Invites", connectInvites, fuzzy(connectInvites), IconArrowPath),
				]),
				sidebarSection(h, { label: "Chat Sync" }, [
					item("Connections", chatSync, fuzzy(chatSync), IconArrowPath),
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
	const { orgSlug } = context
	const appearance = hrefOf(AppRoute.MySettingsAppearance({ orgSlug }))
	const profile = hrefOf(AppRoute.MySettingsProfile({ orgSlug }))
	const linkedAccounts = linkedAccountsHref(orgSlug)
	const notifications = hrefOf(AppRoute.MySettingsNotifications({ orgSlug }))
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
						appearance,
						{ isCurrent: path === appearance, isLinkActive: path === appearance },
						IconPaintbrush,
					),
					item("Profile", profile, fuzzy(profile), IconUser),
					item("Linked Accounts", linkedAccounts, fuzzy(linkedAccounts), IconArrowPath),
					item("Notifications", notifications, fuzzy(notifications), IconBell),
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
	const { orgSlug } = context
	const all = hrefOf(AppRoute.NotificationsAll({ orgSlug }))
	const general = hrefOf(AppRoute.NotificationsGeneral({ orgSlug }))
	const threads = hrefOf(AppRoute.NotificationsThreads({ orgSlug }))
	const dms = hrefOf(AppRoute.NotificationsDms({ orgSlug }))
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
						all,
						{ isCurrent: isActiveFuzzy(path, all), isLinkActive: path === all },
						IconBell,
					),
					item("Channels", general, fuzzy(general), IconHashtag),
					item("Threads", threads, fuzzy(threads), IconThread),
					item("Direct Messages", dms, fuzzy(dms), IconMsgs),
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
