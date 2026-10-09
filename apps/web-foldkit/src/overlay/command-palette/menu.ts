import type { Shared } from "../../page/contract"
import { AppRoute } from "../../route"
import { hotkeyLabel } from "../../shell/channels-sidebar/hotkey-label"
import * as CommandMenu from "../../ui/command-menu"
import type { ChannelSummary, DmChannel, Model, Theme } from "./model"

/**
 * The list pages' menu items (`HomeView`, `StatusView`, `AppearanceView`): keys, `textValue`s and
 * sections in legacy order. Keys are `<kind>:<value>`; `view.ts` renders each key's content.
 */

export const HOTKEYS = {
	search: hotkeyLabel("Mod+Shift+F"),
	createChannel: hotkeyLabel("Mod+Alt+N"),
	createDm: hotkeyLabel("Mod+Alt+D"),
	invite: hotkeyLabel("Mod+Alt+I"),
} as const

export const NAVIGATION = [
	{ key: "nav:dashboard", route: AppRoute.OrgHome, label: "Dashboard", textValue: "dashboard home" },
	{ key: "nav:chat", route: AppRoute.ChatIndex, label: "Chat", textValue: "chat messages" },
	{
		key: "nav:notifications",
		route: AppRoute.NotificationsAll,
		label: "Notifications",
		textValue: "notifications",
	},
	{
		key: "nav:my-settings",
		route: AppRoute.MySettingsAppearance,
		label: "My Settings",
		textValue: "my settings preferences",
	},
	{ key: "nav:profile", route: AppRoute.MySettingsProfile, label: "My Profile", textValue: "my profile" },
] as const

export const SETTINGS = [
	{
		key: "settings:general",
		route: AppRoute.SettingsGeneral,
		label: "General Settings",
		textValue: "general settings",
	},
	{ key: "settings:team", route: AppRoute.TeamSettings, label: "Team", textValue: "team members" },
	{
		key: "settings:integrations",
		route: AppRoute.SettingsIntegrations,
		label: "Integrations",
		textValue: "integrations",
	},
	{
		key: "settings:invitations",
		route: AppRoute.SettingsInvitations,
		label: "Invitations",
		textValue: "invitations",
	},
	{ key: "settings:debug", route: AppRoute.SettingsDebug, label: "Debug", textValue: "debug" },
] as const

export const STATUS_OPTIONS = [
	{ value: "online", label: "Online", color: "bg-success", description: "Available and active" },
	{ value: "away", label: "Away", color: "bg-warning", description: "Stepped away temporarily" },
	{ value: "busy", label: "Busy", color: "bg-warning", description: "Focused, limit interruptions" },
	{ value: "dnd", label: "Do Not Disturb", color: "bg-danger", description: "No notifications" },
] as const

export const THEME_OPTIONS: ReadonlyArray<{ readonly value: Theme; readonly label: string }> = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
]

/** `displayName` of a DM: the partner's full name, or the first names of a group. */
export const dmDisplayName = (dm: DmChannel) => {
	const first = dm.otherMembers[0]
	return dm.type === "single" && dm.otherMembers.length === 1 && first
		? `${first.firstName} ${first.lastName}`
		: dm.otherMembers.map((member) => member.firstName).join(", ")
}

/** `sortedRecentChannels`: visit order, at most three, only channels still in the org. */
export const recentChannelsOf = (model: Model): ReadonlyArray<ChannelSummary> =>
	model.recentChannelIds
		.flatMap((id) => model.recentChannels.find((channel) => channel.id === id) ?? [])
		.slice(0, 3)

const isDm = (channel: ChannelSummary) => channel.type === "direct" || channel.type === "single"

const recentItem = (model: Model, channel: ChannelSummary) => {
	const dm = isDm(channel) ? model.dmChannels.find((candidate) => candidate.id === channel.id) : undefined
	return CommandMenu.item(`recent:${channel.id}`, dm ? dmDisplayName(dm) : channel.name)
}

const homeSections = (model: Model): ReadonlyArray<CommandMenu.Section> => {
	const recent = recentChannelsOf(model)
	return [
		...(recent.length > 0
			? [CommandMenu.section("Recent", recent.map((channel) => recentItem(model, channel)))]
			: []),
		CommandMenu.section("Quick Actions", [
			CommandMenu.item("action:search", "search messages find", true),
			CommandMenu.item("action:create-channel", "create channel", true),
			CommandMenu.item("action:start-dm", "start conversation new dm", true),
			CommandMenu.item("action:join-channel", "join channel"),
			CommandMenu.item("action:invite", "invite members", true),
		]),
		...(model.channels.length > 0
			? [
					CommandMenu.section(
						"Channels",
						model.channels.map((channel) => CommandMenu.item(`channel:${channel.id}`, channel.name)),
					),
				]
			: []),
		...(model.dmChannels.length > 0
			? [
					CommandMenu.section(
						"Direct Messages",
						model.dmChannels.map((dm) =>
							CommandMenu.item(
								`dm:${dm.id}`,
								dm.otherMembers.map((member) => `${member.firstName} ${member.lastName}`).join(" "),
							),
						),
					),
				]
			: []),
		CommandMenu.section(
			"Navigation",
			NAVIGATION.map((entry) => CommandMenu.item(entry.key, entry.textValue)),
		),
		CommandMenu.section(
			"Settings",
			SETTINGS.map((entry) => CommandMenu.item(entry.key, entry.textValue)),
		),
		CommandMenu.section("Preferences", [
			CommandMenu.item("pref:status", "set status presence"),
			CommandMenu.item("pref:appearance", "appearance theme dark light mode"),
		]),
	]
}

/**
 * The sections of the current list page. Appearance's "Accent Color" section holds a plain div,
 * which React Aria's collection drops, so legacy renders only "Theme"; so does this.
 */
export const menuSectionsOf = (model: Model, _shared: Shared): ReadonlyArray<CommandMenu.Section> => {
	const page = model.page
	if (page._tag === "Status")
		return [
			CommandMenu.section(
				"Set Status",
				STATUS_OPTIONS.map((option) =>
					CommandMenu.item(`status:${option.value}`, `${option.label} ${option.description}`),
				),
			),
		]
	if (page._tag === "Appearance")
		return [
			CommandMenu.section(
				"Theme",
				THEME_OPTIONS.map((option) => CommandMenu.item(`theme:${option.value}`, `${option.label} theme mode`)),
			),
		]
	return page._tag === "Home" ? homeSections(model) : []
}

/** Splits `<kind>:<value>`. */
export const parseKey = (key: string) => {
	const index = key.indexOf(":")
	return { kind: key.slice(0, index), value: key.slice(index + 1) }
}
