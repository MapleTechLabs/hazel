import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import {
	IconArrowPath,
	IconBell,
	IconKeyboard,
	IconCube,
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
import { AppRoute, hrefOf, isNotificationsRoute, linkedAccountsHref, type RouteTag } from "../route"
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
import type { ShellContext } from "./context"
import { orgSwitcherHeader, userMenuFooter } from "./menus"
import { hasUpdater, isDesktop, sidebarHeaderHeightClass } from "../platform/desktop"

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

/** An item that is current (and its link active) on exactly these routes. */
const onRoutes = (route: AppRoute, ...tags: ReadonlyArray<RouteTag>) => {
	const isOn = tags.includes(route._tag)
	return { isCurrent: isOn, isLinkActive: isOn }
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
	const { route } = context
	const item = navList(h)

	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(
			h,
			chrome.orgSwitcher,
			chrome.orgSwitcherEntries,
			context,
			chrome.organizations,
			chrome.toOrgSwitcherMessage,
		),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sectionTitle(h, "Settings"),
				sidebarSection(h, {}, [
					item("General", general, onRoutes(route, "SettingsGeneral"), IconGear),
					item("Team", team, onRoutes(route, "TeamSettings"), IconUsers),
					item("Invitations", invitations, onRoutes(route, "SettingsInvitations"), IconUsersPlus),
					item("Custom Emoji", customEmojis, onRoutes(route, "SettingsCustomEmojis"), IconEmojiAdd),
				]),
				sidebarSection(h, { label: "Apps & Integrations" }, [
					// An integration's own page (`integrations/$id`) keeps "Integrations" current.
					item(
						"Integrations",
						integrations,
						{
							isCurrent: onRoutes(route, "SettingsIntegrations", "SettingsIntegration")
								.isCurrent,
							isLinkActive: route._tag === "SettingsIntegrations",
						},
						IconIntegratio,
					),
					item(
						"Marketplace",
						marketplace,
						onRoutes(route, "SettingsIntegrationsMarketplace"),
						IconShop,
					),
					item(
						"Installed Apps",
						installed,
						onRoutes(route, "SettingsIntegrationsInstalled"),
						IconGridCirclePlus,
					),
					item("Your Apps", yourApps, onRoutes(route, "SettingsIntegrationsYourApps"), IconCode),
				]),
				sidebarSection(h, { label: "Hazel Connect" }, [
					item(
						"Connect Invites",
						connectInvites,
						onRoutes(route, "SettingsConnectInvites"),
						IconArrowPath,
					),
				]),
				sidebarSection(h, { label: "Chat Sync" }, [
					item(
						"Connections",
						chatSync,
						onRoutes(route, "SettingsChatSync", "SettingsChatSyncConnection"),
						IconArrowPath,
					),
				]),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			chrome.userMenuEntries,
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
	const desktop = hrefOf(AppRoute.MySettingsDesktop({ orgSlug }))
	const keybinds = hrefOf(AppRoute.MySettingsKeybinds({ orgSlug }))
	const { route } = context
	const item = navList(h)
	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(
			h,
			chrome.orgSwitcher,
			chrome.orgSwitcherEntries,
			context,
			chrome.organizations,
			chrome.toOrgSwitcherMessage,
		),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sectionTitle(h, "My Settings"),
				sidebarSection(h, {}, [
					item("Appearance", appearance, onRoutes(route, "MySettingsAppearance"), IconPaintbrush),
					item("Profile", profile, onRoutes(route, "MySettingsProfile"), IconUser),
					item(
						"Linked Accounts",
						linkedAccounts,
						onRoutes(route, "MySettingsLinkedAccounts"),
						IconArrowPath,
					),
					item(
						"Notifications",
						notifications,
						onRoutes(route, "MySettingsNotifications"),
						IconBell,
					),
					item("Keybinds", keybinds, onRoutes(route, "MySettingsKeybinds"), IconKeyboard),
					// Desktop settings: the Tauri app's, and the native app's update section.
					...(isDesktop || hasUpdater
						? [item("Desktop", desktop, onRoutes(route, "MySettingsDesktop"), IconCube)]
						: []),
				]),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			chrome.userMenuEntries,
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
	const { route } = context
	const item = navList(h)
	return sidebarStatic(h, "flex flex-1", [
		sidebarHeader(h, { state: "expanded", className: `border-b py-4 ${sidebarHeaderHeightClass()}` }, [
			h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], ["Activity"]),
		]),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, {}, [
					// Legacy also matches `/notifications/` fuzzily, so All Activity stays current on sub-pages.
					item(
						"All Activity",
						all,
						{
							isCurrent: isNotificationsRoute(route),
							isLinkActive: route._tag === "NotificationsAll",
						},
						IconBell,
					),
					item("Channels", general, onRoutes(route, "NotificationsGeneral"), IconHashtag),
					item("Threads", threads, onRoutes(route, "NotificationsThreads"), IconThread),
					item("Direct Messages", dms, onRoutes(route, "NotificationsDms"), IconMsgs),
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
			chrome.userMenuEntries,
			context,
			chrome.toUserMenuMessage,
			chrome.userStatus,
			chrome.statusExpiration,
		),
	])
}
