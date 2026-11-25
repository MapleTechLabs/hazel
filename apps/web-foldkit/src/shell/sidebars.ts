import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import type { AppRoute, RouteTag } from "../route"
import { button } from "../ui/button"
import { heading } from "../ui/heading"
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
import { sidebarHeaderHeightClass } from "../platform/desktop"
import { type DestinationId, destination, destinationHref, isAvailable } from "./destinations"

/** The settings and notifications sidebars next to the nav rail. */

const SECTION_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

/** A sidebar row for a page, named and drawn as everywhere else (`destinations.ts`). */
const pageList =
	<Message>(h: HtmlBuilder<Message>, orgSlug: string) =>
	(id: DestinationId, state: { readonly isCurrent: boolean; readonly isLinkActive: boolean }): Html => {
		const page = destination(id)
		if (!isAvailable(id)) return h.empty
		return sidebarItem(h, { isCurrent: state.isCurrent }, [
			sidebarLink(
				h,
				{
					href: destinationHref(id, orgSlug),
					isActive: state.isLinkActive,
					activeClassName: SECTION_ACTIVE,
				},
				[
					page.icon(h, { attributes: { "data-slot": "icon" } }),
					sidebarLabel(h, [page.sidebarLabel ?? page.label]),
				],
			),
		])
	}

/** An item that is current (and its link active) on exactly these routes. */
const onRoutes = (route: AppRoute, ...tags: ReadonlyArray<RouteTag>) => {
	const isOn = tags.includes(route._tag)
	return { isCurrent: isOn, isLinkActive: isOn }
}

/** The sidebar's eyebrow, a heading so the section is reachable by heading navigation. */
const sectionTitle = <Message>(h: HtmlBuilder<Message>, title: string) =>
	h.div([h.Class("px-3 pt-3 pb-1")], [heading(h, { variant: "label", level: 2 }, [title])])

/**
 * `SettingsSidebar`: one place for every setting, your own (Account) above the workspace's, so
 * `/settings/*` and `/my-settings/*` share it and you never have to know which of the two a page is in.
 */
export const settingsSidebar = <Message>(
	h: HtmlBuilder<Message>,
	context: ShellContext,
	chrome: SidebarChrome<Message>,
): Html => {
	const { orgSlug, route } = context
	const item = pageList(h, orgSlug)

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
				sectionTitle(h, "Account"),
				sidebarSection(h, {}, [
					item("myProfile", onRoutes(route, "MySettingsProfile")),
					item("myAppearance", onRoutes(route, "MySettingsAppearance")),
					item("myNotifications", onRoutes(route, "MySettingsNotifications")),
					item("myKeybinds", onRoutes(route, "MySettingsKeybinds")),
					item("myLinkedAccounts", onRoutes(route, "MySettingsLinkedAccounts")),
					item("myAgents", onRoutes(route, "MySettingsAgents")),
					// Desktop settings: the Tauri app's, and the native app's update section.
					item("myDesktop", onRoutes(route, "MySettingsDesktop")),
				]),
			]),
			sidebarSectionGroup(h, [
				sectionTitle(h, "Workspace"),
				sidebarSection(h, {}, [
					item("settingsGeneral", onRoutes(route, "SettingsGeneral")),
					item("settingsTeam", onRoutes(route, "TeamSettings")),
					item("settingsGroups", onRoutes(route, "SettingsGroups")),
					item("settingsInvitations", onRoutes(route, "SettingsInvitations")),
					item("settingsCustomEmojis", onRoutes(route, "SettingsCustomEmojis")),
				]),
				sidebarSection(h, { label: "Apps & integrations" }, [
					// An integration's own page (`integrations/$id`) keeps "Integrations" current.
					item("settingsIntegrations", {
						isCurrent: onRoutes(route, "SettingsIntegrations", "SettingsIntegration").isCurrent,
						isLinkActive: route._tag === "SettingsIntegrations",
					}),
					item("settingsMarketplace", onRoutes(route, "SettingsIntegrationsMarketplace")),
					item("settingsInstalledApps", onRoutes(route, "SettingsIntegrationsInstalled")),
					item("settingsYourApps", onRoutes(route, "SettingsIntegrationsYourApps")),
				]),
				sidebarSection(h, { label: "Shared channels" }, [
					item(
						"settingsChatSync",
						onRoutes(route, "SettingsChatSync", "SettingsChatSyncConnection"),
					),
					item("settingsConnectInvites", onRoutes(route, "SettingsConnectInvites")),
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
	const { orgSlug, route } = context
	const item = pageList(h, orgSlug)
	return sidebarStatic(h, "flex flex-1", [
		sidebarHeader(h, { state: "expanded", className: `border-b py-4 ${sidebarHeaderHeightClass()}` }, [
			h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], ["Activity"]),
		]),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, {}, [
					item("notifications", onRoutes(route, "NotificationsMentions")),
					item("notificationsUnreads", onRoutes(route, "NotificationsUnreads")),
					item("notificationsAll", onRoutes(route, "NotificationsAll")),
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
