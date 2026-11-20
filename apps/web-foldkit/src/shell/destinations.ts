import type { Html, HtmlBuilder } from "foldkit/html"
import {
	IconArrowPath,
	IconBell,
	IconChartBar,
	IconClock,
	IconCode,
	IconCube,
	IconDashboard,
	IconEmojiAdd,
	IconGear,
	IconGridCirclePlus,
	IconHashtag,
	IconHeart,
	IconIntegratio,
	IconKeyboard,
	IconLightbulb,
	IconMsgs,
	IconOffice,
	IconPaintbrush,
	IconPresentationChart,
	IconRocket,
	IconServers,
	IconShop,
	IconSparkles,
	IconSupport,
	IconThread,
	IconUser,
	IconUsers,
	IconUsersPlus,
	IconWarning,
	type IconOptions,
} from "../icons"
import { hasUpdater, isDesktop } from "../platform/desktop"
import { AppRoute, customersListRoute, hrefOf, linkedAccountsRoute } from "../route"

/**
 * Every page you can go to inside an organization, once: its label, icon and route. The nav rail,
 * the sidebars and the command palette all read from here, so a page gets the same name and glyph
 * wherever it shows up, and a new page reaches ⌘K by being added here.
 */

type IconView = <Message>(h: HtmlBuilder<Message>, options?: IconOptions) => Html

export interface Destination {
	readonly label: string
	/** The name in its own sidebar, under that area's header, where the label would repeat it. */
	readonly sidebarLabel?: string
	readonly icon: IconView
	readonly to: (orgSlug: string) => AppRoute
	/** Extra words the palette matches besides the label and its group. */
	readonly keywords?: string
	/** Whether the page exists in this build (false: hidden everywhere). */
	readonly isAvailable?: boolean
}

const define = <const Id extends string>(destinations: Record<Id, Destination>) => destinations

const DESTINATIONS = define({
	// Areas (the nav rail)
	home: {
		label: "Home",
		icon: IconDashboard,
		to: (orgSlug) => AppRoute.OrgHome({ orgSlug }),
		keywords: "dashboard",
	},
	chat: {
		label: "Chat",
		icon: IconMsgs,
		to: (orgSlug) => AppRoute.ChatIndex({ orgSlug }),
		keywords: "messages channels",
	},
	customers: {
		label: "Customers",
		icon: IconOffice,
		to: (orgSlug) => AppRoute.CustomersOverview({ orgSlug }),
		keywords: "accounts crm",
	},
	notifications: {
		label: "Notifications",
		sidebarLabel: "All Activity",
		icon: IconBell,
		to: (orgSlug) => AppRoute.NotificationsAll({ orgSlug }),
		keywords: "activity inbox mentions",
	},
	settings: { label: "Settings", icon: IconGear, to: (orgSlug) => AppRoute.SettingsGeneral({ orgSlug }) },

	// Notifications
	notificationsChannels: {
		label: "Channel notifications",
		sidebarLabel: "Channels",
		icon: IconHashtag,
		to: (orgSlug) => AppRoute.NotificationsGeneral({ orgSlug }),
	},
	notificationsThreads: {
		label: "Thread notifications",
		sidebarLabel: "Threads",
		icon: IconThread,
		to: (orgSlug) => AppRoute.NotificationsThreads({ orgSlug }),
		keywords: "replies",
	},
	notificationsDms: {
		label: "Direct message notifications",
		sidebarLabel: "Direct Messages",
		icon: IconMsgs,
		to: (orgSlug) => AppRoute.NotificationsDms({ orgSlug }),
		keywords: "dms",
	},

	// Customers
	customersOverview: {
		label: "Overview",
		icon: IconPresentationChart,
		to: (orgSlug) => AppRoute.CustomersOverview({ orgSlug }),
		keywords: "dashboard metrics",
	},
	customersAttention: {
		label: "Needs attention",
		icon: IconWarning,
		to: (orgSlug) => AppRoute.CustomersAttention({ orgSlug }),
		keywords: "signals risk alerts",
	},
	customersInbox: {
		label: "Support inbox",
		icon: IconSupport,
		to: (orgSlug) => AppRoute.CustomersInbox({ orgSlug }),
		keywords: "issues tickets waiting reply",
	},
	customersSupportReport: {
		label: "Support report",
		icon: IconChartBar,
		to: (orgSlug) => AppRoute.CustomersSupportReport({ orgSlug }),
		keywords: "response times stats",
	},
	customersList: {
		label: "Customer list",
		sidebarLabel: "Customers",
		icon: IconOffice,
		to: (orgSlug) => customersListRoute(orgSlug),
		keywords: "list accounts all",
	},
	customersSignals: {
		label: "Signals",
		icon: IconLightbulb,
		to: (orgSlug) => AppRoute.CustomersSettingsSignals({ orgSlug }),
		keywords: "rules",
	},
	customersHealth: {
		label: "Health score",
		icon: IconHeart,
		to: (orgSlug) => AppRoute.CustomersSettingsHealth({ orgSlug }),
	},
	customersSla: {
		label: "Support SLAs",
		icon: IconClock,
		to: (orgSlug) => AppRoute.CustomersSettingsSla({ orgSlug }),
		keywords: "response targets",
	},
	customersPlans: {
		label: "Plans",
		icon: IconCube,
		to: (orgSlug) => AppRoute.CustomersSettingsPlans({ orgSlug }),
		keywords: "pricing tiers",
	},
	customersFeatureFlags: {
		label: "Feature flags",
		icon: IconRocket,
		to: (orgSlug) => AppRoute.CustomersSettingsFeatureFlags({ orgSlug }),
	},
	customersSources: {
		label: "Data sources",
		icon: IconServers,
		to: (orgSlug) => AppRoute.CustomersSettingsSources({ orgSlug }),
		keywords: "stripe providers sync",
	},

	// Organization settings
	settingsGeneral: {
		label: "General",
		icon: IconGear,
		to: (orgSlug) => AppRoute.SettingsGeneral({ orgSlug }),
	},
	settingsTeam: {
		label: "Team",
		icon: IconUsers,
		to: (orgSlug) => AppRoute.TeamSettings({ orgSlug }),
		keywords: "members people",
	},
	settingsInvitations: {
		label: "Invitations",
		icon: IconUsersPlus,
		to: (orgSlug) => AppRoute.SettingsInvitations({ orgSlug }),
		keywords: "invite",
	},
	settingsCustomEmojis: {
		label: "Custom Emoji",
		icon: IconEmojiAdd,
		to: (orgSlug) => AppRoute.SettingsCustomEmojis({ orgSlug }),
		keywords: "emojis",
	},
	settingsIntegrations: {
		label: "Integrations",
		icon: IconIntegratio,
		to: (orgSlug) => AppRoute.SettingsIntegrations({ orgSlug }),
	},
	settingsMarketplace: {
		label: "Marketplace",
		icon: IconShop,
		to: (orgSlug) => AppRoute.SettingsIntegrationsMarketplace({ orgSlug }),
		keywords: "apps bots",
	},
	settingsInstalledApps: {
		label: "Installed Apps",
		icon: IconGridCirclePlus,
		to: (orgSlug) => AppRoute.SettingsIntegrationsInstalled({ orgSlug }),
		keywords: "bots",
	},
	settingsYourApps: {
		label: "Your Apps",
		icon: IconCode,
		to: (orgSlug) => AppRoute.SettingsIntegrationsYourApps({ orgSlug }),
		keywords: "bots developer api",
	},
	settingsConnectInvites: {
		label: "Connect Invites",
		icon: IconArrowPath,
		to: (orgSlug) => AppRoute.SettingsConnectInvites({ orgSlug }),
		keywords: "hazel connect shared channels",
	},
	settingsChatSync: {
		label: "Chat Sync",
		sidebarLabel: "Connections",
		icon: IconArrowPath,
		to: (orgSlug) => AppRoute.SettingsChatSync({ orgSlug }),
		keywords: "slack discord connections bridge",
	},
	settingsDebug: {
		label: "Debug",
		icon: IconServers,
		to: (orgSlug) => AppRoute.SettingsDebug({ orgSlug }),
	},

	// My settings
	myAppearance: {
		label: "Appearance",
		icon: IconPaintbrush,
		to: (orgSlug) => AppRoute.MySettingsAppearance({ orgSlug }),
		keywords: "theme dark light accent",
	},
	myProfile: {
		label: "Profile",
		icon: IconUser,
		to: (orgSlug) => AppRoute.MySettingsProfile({ orgSlug }),
		keywords: "name avatar me",
	},
	myLinkedAccounts: {
		label: "Linked Accounts",
		icon: IconArrowPath,
		to: (orgSlug) => linkedAccountsRoute(orgSlug),
		keywords: "github google slack discord",
	},
	myAgents: {
		label: "Agents",
		icon: IconSparkles,
		to: (orgSlug) => AppRoute.MySettingsAgents({ orgSlug }),
		keywords: "ai mcp claude",
	},
	myNotifications: {
		label: "Notification settings",
		sidebarLabel: "Notifications",
		icon: IconBell,
		to: (orgSlug) => AppRoute.MySettingsNotifications({ orgSlug }),
		keywords: "sound email push",
	},
	myKeybinds: {
		label: "Keybinds",
		icon: IconKeyboard,
		to: (orgSlug) => AppRoute.MySettingsKeybinds({ orgSlug }),
		keywords: "keyboard shortcuts hotkeys",
	},
	myDesktop: {
		label: "Desktop",
		icon: IconCube,
		to: (orgSlug) => AppRoute.MySettingsDesktop({ orgSlug }),
		keywords: "app updates",
		isAvailable: isDesktop || hasUpdater,
	},
})

export type DestinationId = keyof typeof DESTINATIONS

export const destination = (id: DestinationId): Destination => DESTINATIONS[id]

export const isDestinationId = (value: string): value is DestinationId => Object.hasOwn(DESTINATIONS, value)

/** The palette's groups, in order: each names its pages, the first one shows before you type. */
export const DESTINATION_GROUPS: ReadonlyArray<{
	readonly title: string
	readonly ids: ReadonlyArray<DestinationId>
	/** Shown on the palette's home page before anything is typed (else only as a search result). */
	readonly isPinned?: boolean
}> = [
	{ title: "Navigation", ids: ["home", "chat", "customers", "notifications", "settings"], isPinned: true },
	{
		title: "Customer pages",
		ids: [
			"customersOverview",
			"customersAttention",
			"customersInbox",
			"customersSupportReport",
			"customersList",
			"customersSignals",
			"customersHealth",
			"customersSla",
			"customersPlans",
			"customersFeatureFlags",
			"customersSources",
		],
	},
	{
		title: "Organization settings",
		ids: [
			"settingsGeneral",
			"settingsTeam",
			"settingsInvitations",
			"settingsIntegrations",
			"settingsMarketplace",
			"settingsInstalledApps",
			"settingsYourApps",
			"settingsCustomEmojis",
			"settingsConnectInvites",
			"settingsChatSync",
			"settingsDebug",
		],
	},
	{
		title: "My Settings",
		ids: [
			"myProfile",
			"myAppearance",
			"myNotifications",
			"myKeybinds",
			"myLinkedAccounts",
			"myAgents",
			"myDesktop",
		],
	},
	{ title: "Notifications", ids: ["notificationsChannels", "notificationsThreads", "notificationsDms"] },
]

/** Whether the page exists in this build. */
export const isAvailable = (id: DestinationId): boolean => DESTINATIONS[id].isAvailable !== false

/** The page's href in `orgSlug`. */
export const destinationHref = (id: DestinationId, orgSlug: string): string =>
	hrefOf(DESTINATIONS[id].to(orgSlug))

/** The pages of this build, in `ids` order. */
export const availableDestinations = (ids: ReadonlyArray<DestinationId>) =>
	ids.flatMap((id) => (isAvailable(id) ? [{ id, ...DESTINATIONS[id] }] : []))
