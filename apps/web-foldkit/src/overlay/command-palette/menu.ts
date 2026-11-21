import type { Shared } from "../../page/contract"
import { availableDestinations, DESTINATION_GROUPS, type DestinationId } from "../../shell/destinations"
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
	aiPanel: hotkeyLabel("Mod+J"),
} as const

/** A page's palette item: `go:<id>`, matched by its label, group and keywords. */
const goKey = (id: DestinationId) => `go:${id}`

const destinationSection = (title: string, ids: ReadonlyArray<DestinationId>) =>
	CommandMenu.section(
		title,
		availableDestinations(ids).map((page) =>
			CommandMenu.item(
				goKey(page.id),
				[page.label, page.sidebarLabel ?? "", title, page.keywords ?? ""].join(" ").trim(),
			),
		),
	)

/** The page groups: the pinned ones always, every group once something is typed. */
const destinationSections = (isSearching: boolean): ReadonlyArray<CommandMenu.Section> =>
	DESTINATION_GROUPS.filter((group) => isSearching || group.isPinned).map((group) =>
		destinationSection(group.title, group.ids),
	)

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

/** The name of a customer user's account, if the palette has it. */
export const accountNameOf = (model: Model, accountId: string): string | null =>
	model.customers.find((customer) => customer.id === accountId)?.name ?? null

const homeSections = (model: Model): ReadonlyArray<CommandMenu.Section> => {
	const recent = recentChannelsOf(model)
	// Only once the user types: an org can have thousands of customers.
	const isSearching = model.menu.inputValue.trim() !== ""
	const showCustomers = isSearching && model.customers.length > 0
	return [
		...(recent.length > 0
			? [
					CommandMenu.section(
						"Recent",
						recent.map((channel) => recentItem(model, channel)),
					),
				]
			: []),
		CommandMenu.section("Quick Actions", [
			CommandMenu.item("action:search", "search messages find", true),
			CommandMenu.item("action:create-channel", "create channel", true),
			CommandMenu.item("action:start-dm", "start conversation new dm", true),
			CommandMenu.item("action:join-channel", "join channel"),
			CommandMenu.item("action:invite", "invite members", true),
			CommandMenu.item("action:ai-panel", "ask ai assistant chat t3 code", true),
		]),
		...(model.channels.length > 0
			? [
					CommandMenu.section(
						"Channels",
						model.channels.map((channel) =>
							CommandMenu.item(`channel:${channel.id}`, channel.name),
						),
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
								dm.otherMembers
									.map((member) => `${member.firstName} ${member.lastName}`)
									.join(" "),
							),
						),
					),
				]
			: []),
		...(showCustomers
			? [
					CommandMenu.section(
						"Customers",
						model.customers.map((customer) =>
							CommandMenu.item(
								`customer:${customer.id}`,
								[customer.name, customer.environment, ...customer.domains]
									.filter((part) => part !== null)
									.join(" "),
							),
						),
					),
				]
			: []),
		...(showCustomers && model.customerUsers.length > 0
			? [
					CommandMenu.section(
						"Users",
						model.customerUsers.map((user) =>
							CommandMenu.item(
								`customer-user:${user.id}`,
								[user.name, user.email, accountNameOf(model, user.accountId)]
									.filter((part) => part !== null)
									.join(" "),
							),
						),
					),
				]
			: []),
		...destinationSections(isSearching),
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
				THEME_OPTIONS.map((option) =>
					CommandMenu.item(`theme:${option.value}`, `${option.label} theme mode`),
				),
			),
		]
	return page._tag === "Home" ? homeSections(model) : []
}

/** Splits `<kind>:<value>`. */
export const parseKey = (key: string) => {
	const index = key.indexOf(":")
	return { kind: key.slice(0, index), value: key.slice(index + 1) }
}
