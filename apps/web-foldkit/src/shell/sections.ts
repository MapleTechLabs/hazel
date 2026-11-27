/**
 * The section layouts the shell draws natively (`shared-screens/src/shell/`): which layout a route
 * gets, and the rows, hrefs and tabs it shows, from this app's routes and destinations.
 */
import type { ChromeHrefs } from "@hazel/shared-screens/shell/menus"
import type { ChannelSettingsTab } from "@hazel/shared-screens/shell/ChannelSettingsHeader"
import type { NavGroup, NavRow } from "@hazel/shared-screens/shell/SectionSidebar"
import type { IconName } from "@hazel/ui/vocabulary/options"
import type { UserId } from "@hazel/schema"
import { Option } from "effect"
import { AppRoute, channelSettingsTabOf, hrefOf, orgSectionOf, type RouteTag } from "../route"
import { type DestinationId, destination, destinationHref, isAvailable } from "./destinations"

/** `settings` (and my settings), `activity` (notifications), `channelSettings`, `customers`, or none. */
export type SectionLayout = "settings" | "activity" | "channelSettings" | "customers"

export const sectionLayoutOf = (route: AppRoute): SectionLayout | null => {
	if (channelSettingsTabOf(route) !== undefined) return "channelSettings"
	const section = orgSectionOf(route)
	if (section === "Settings" || section === "MySettings") return "settings"
	if (section === "Notifications") return "activity"
	if (section === "Customers") return "customers"
	return null
}

/** The dock's sidebar: a section's own, else (chat, home, channel settings, profiles) the channel list. */
export type DockSidebar = "settings" | "activity" | "customers" | "chat"

export const dockSidebarOf = (route: AppRoute): DockSidebar | null => {
	if (orgSectionOf(route) === undefined) return null
	const layout = sectionLayoutOf(route)
	return layout === null || layout === "channelSettings" ? "chat" : layout
}

export const isNativeSectionRoute = (route: AppRoute): boolean => sectionLayoutOf(route) !== null

/** A page's row, current on exactly `tags` (an integration's own page keeps its list current). */
const rowsOf = (
	orgSlug: string,
	route: AppRoute,
	rows: ReadonlyArray<readonly [DestinationId, IconName, ReadonlyArray<RouteTag>]>,
): Array<NavRow> =>
	rows.flatMap(([id, icon, tags]) => {
		if (!isAvailable(id)) return []
		const page = destination(id)
		return [
			{
				id,
				label: page.sidebarLabel ?? page.label,
				icon,
				href: destinationHref(id, orgSlug),
				selected: tags.includes(route._tag),
			},
		]
	})

/** `SettingsSidebar`: your own settings (Account) above the workspace's. */
export const settingsGroups = (orgSlug: string, route: AppRoute): Array<NavGroup> => {
	const rows = (list: ReadonlyArray<readonly [DestinationId, IconName, ReadonlyArray<RouteTag>]>) =>
		rowsOf(orgSlug, route, list)
	return [
		{
			key: "account",
			eyebrow: "Account",
			title: null,
			rows: rows([
				["myProfile", "user", ["MySettingsProfile"]],
				["myAppearance", "paintbrush", ["MySettingsAppearance"]],
				["myNotifications", "bell", ["MySettingsNotifications"]],
				["myKeybinds", "keyboard", ["MySettingsKeybinds"]],
				["myLinkedAccounts", "refresh", ["MySettingsLinkedAccounts"]],
				["myAgents", "sparkles", ["MySettingsAgents"]],
				["myDesktop", "cube", ["MySettingsDesktop"]],
			]),
		},
		{
			key: "workspace",
			eyebrow: "Workspace",
			title: null,
			rows: rows([
				["settingsGeneral", "gear", ["SettingsGeneral"]],
				["settingsTeam", "users", ["TeamSettings"]],
				["settingsGroups", "profiles", ["SettingsGroups"]],
				["settingsInvitations", "user-plus", ["SettingsInvitations"]],
				["settingsCustomEmojis", "emoji-add", ["SettingsCustomEmojis"]],
			]),
		},
		{
			key: "apps",
			eyebrow: null,
			title: "Apps & integrations",
			rows: rows([
				["settingsIntegrations", "integration", ["SettingsIntegrations", "SettingsIntegration"]],
				["settingsMarketplace", "shop", ["SettingsIntegrationsMarketplace"]],
				["settingsInstalledApps", "apps", ["SettingsIntegrationsInstalled"]],
				["settingsYourApps", "code", ["SettingsIntegrationsYourApps"]],
			]),
		},
		{
			key: "shared",
			eyebrow: null,
			title: "Shared channels",
			rows: rows([
				["settingsChatSync", "refresh", ["SettingsChatSync", "SettingsChatSyncConnection"]],
				["settingsConnectInvites", "refresh", ["SettingsConnectInvites"]],
			]),
		},
	]
}

/** `NotificationsSidebar`: its three views. */
export const activityGroups = (orgSlug: string, route: AppRoute): Array<NavGroup> => [
	{
		key: "activity",
		eyebrow: null,
		title: null,
		rows: rowsOf(orgSlug, route, [
			["notifications", "bell", ["NotificationsMentions"]],
			["notificationsUnreads", "chat", ["NotificationsUnreads"]],
			["notificationsAll", "envelope", ["NotificationsAll"]],
		]),
	},
]

/** Where the account menu and the org switcher link, in `orgSlug`. */
export const chromeHrefsOf = (orgSlug: string, userId: UserId): ChromeHrefs => ({
	profile: hrefOf(AppRoute.Profile({ orgSlug, userId })),
	mySettings: hrefOf(AppRoute.MySettingsProfile({ orgSlug })),
	manageMembers: hrefOf(AppRoute.TeamSettings({ orgSlug })),
	serverSettings: hrefOf(AppRoute.SettingsGeneral({ orgSlug })),
	customEmojis: hrefOf(AppRoute.SettingsCustomEmojis({ orgSlug })),
	integrations: hrefOf(AppRoute.SettingsIntegrations({ orgSlug })),
})

/** The channel settings tabs, each its own page. */
export const channelSettingsTabsOf = (route: AppRoute): Array<ChannelSettingsTab> => {
	if (!("channelId" in route) || !("orgSlug" in route)) return []
	const { orgSlug, channelId } = route
	return [
		{
			id: "overview",
			label: "Overview",
			href: hrefOf(AppRoute.ChannelSettingsOverview({ orgSlug, channelId })),
		},
		{
			id: "integrations",
			label: "Integrations",
			href: hrefOf(AppRoute.ChannelSettingsIntegrations({ orgSlug, channelId })),
		},
		{
			id: "connect",
			label: "Connect",
			href: hrefOf(AppRoute.ChannelSettingsConnect({ orgSlug, channelId })),
		},
	]
}

/** The customers sidebar's pages above its views (`CustomersSidebar` adds the counts). */
export const customersPages = (orgSlug: string, route: AppRoute): Array<NavRow> =>
	rowsOf(orgSlug, route, [
		["customersOverview", "presentation", ["CustomersOverview"]],
		["customersAttention", "warning", ["CustomersAttention"]],
		["customersInbox", "support", ["CustomersInbox"]],
		["customersSupportReport", "chart", ["CustomersSupportReport"]],
	])

/** The customers sidebar's settings pages. */
export const customersSettings = (orgSlug: string, route: AppRoute): Array<NavRow> =>
	rowsOf(orgSlug, route, [
		[
			"customersSignals",
			"lightbulb",
			["CustomersSettingsSignals", "CustomersSettingsSignalNew", "CustomersSettingsSignalRule"],
		],
		["customersSla", "clock", ["CustomersSettingsSla"]],
		["customersPlans", "cube", ["CustomersSettingsPlans"]],
		["customersFeatureFlags", "rocket", ["CustomersSettingsFeatureFlags"]],
		[
			"customersSources",
			"servers",
			["CustomersSettingsSources", "CustomersSourceDetail", "CustomersUnmatched"],
		],
	])

/** The list's view shown (`current` for none), or null off the list. */
export const customersViewOf = (route: AppRoute): string | null =>
	route._tag === "CustomersList" ? Option.getOrElse(route.view, () => "current") : null
