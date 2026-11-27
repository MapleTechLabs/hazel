/**
 * What each list page shows, as the palette's groups: items in today's order, filtered the way
 * today's menu filters (`ui/command-menu.ts`): every typed word in the item's text, any order.
 */
import type { Content, IconName } from "@hazel/ui/vocabulary/index"
import { formatDistanceToNow } from "../lib/format-distance"
import { getFilterTypeLabel } from "../lib/search-filter-parser"
import type {
	ChannelSummary,
	CustomerSummary,
	CustomerUserSummary,
	DmChannel,
	PaletteModel,
	PaletteProps,
	RecentSearch,
	SearchFilter,
	SearchResult,
	Suggestion,
} from "./model"
import { type Autocomplete, filterString, previewOf } from "./search"

type Item = Content.PaletteItem
type Group = Content.PaletteGroups[number]

/** An item with the words it matches (its label and more). */
interface Entry {
	readonly item: Item
	readonly text: string
}

const normalized = (text: string) =>
	text
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()

const wordsOf = (query: string) =>
	normalized(query)
		.split(/\s+/)
		.filter((word) => word !== "")

const group = (title: string, entries: ReadonlyArray<Entry>, words: ReadonlyArray<string>): Group => ({
	title,
	items: entries
		.filter((entry) => {
			const text = normalized(entry.text)
			return words.every((word) => text.includes(word))
		})
		.map((entry) => entry.item),
})

const nonEmpty = (groups: ReadonlyArray<Group>) => groups.filter((entry) => entry.items.length > 0)

const initialOf = (name: string) => (name.trim()[0] ?? "").toUpperCase()

const face = (name: string, src: string | null): Item["face"] => ({
	name,
	initials: initialOf(name),
	...(src === null ? {} : { src }),
})

/** `displayName` of a DM: the partner's full name, or the first names of a group. */
export const dmDisplayName = (dm: DmChannel) => {
	const first = dm.otherMembers[0]
	return dm.type === "single" && dm.otherMembers.length === 1 && first
		? `${first.firstName} ${first.lastName}`
		: dm.otherMembers.map((member) => member.firstName).join(", ")
}

/** Visit order, at most three, only channels still in the org. */
export const recentChannelsOf = (model: PaletteModel): ReadonlyArray<ChannelSummary> =>
	model.recentChannelIds
		.flatMap((id) => model.recentChannels.find((channel) => channel.id === id) ?? [])
		.slice(0, 3)

const isDm = (channel: ChannelSummary) => channel.type === "direct" || channel.type === "single"

// HAZEL-GAP(p4-palette-channel-icon): today draws the channel's own emoji icon and its Connect or sync mark; items take an IconName.
const channelItem = (id: string, channel: ChannelSummary): Item => ({
	id,
	label: channel.name,
	icon: channel.type === "private" ? "lock" : "hashtag",
})

// HAZEL-GAP(p4-palette-dm-stack): a group DM today shows two stacked avatars and "+N"; an item has one face.
const dmItem = (id: string, dm: DmChannel): Item => {
	const first = dm.otherMembers[0]
	const name = dmDisplayName(dm)
	return {
		id,
		label: name,
		face: face(
			first === undefined ? name : `${first.firstName} ${first.lastName}`,
			first?.avatarUrl ?? null,
		),
	}
}

const recentItem = (model: PaletteModel, channel: ChannelSummary): Entry => {
	const dm = isDm(channel) ? model.dmChannels.find((candidate) => candidate.id === channel.id) : undefined
	const id = `recent:${channel.id}`
	return dm === undefined
		? { item: channelItem(id, channel), text: channel.name }
		: { item: dmItem(id, dm), text: dmDisplayName(dm) }
}

/** The name of a customer user's account, if the palette has it. */
const accountNameOf = (model: PaletteModel, accountId: string): string | null =>
	model.customers.find((customer) => customer.id === accountId)?.name ?? null

// HAZEL-GAP(p4-palette-customer-badge): today's row adds the environment badge after the name; the item has no badge.
const customerEntry = (customer: CustomerSummary): Entry => ({
	item: {
		id: `customer:${customer.id}`,
		label: customer.name,
		face: face(customer.name, customer.logoUrl),
		...(customer.domains[0] === undefined ? {} : { description: customer.domains[0] }),
	},
	text: [customer.name, customer.environment, ...customer.domains]
		.filter((part) => part !== null)
		.join(" "),
})

const customerUserEntry = (model: PaletteModel, user: CustomerUserSummary): Entry => {
	const name = user.name ?? user.email ?? "Unknown user"
	const account = accountNameOf(model, user.accountId)
	const details = [user.name !== null ? user.email : null, account === null ? null : `· ${account}`]
		.filter((part) => part !== null)
		.join(" ")
	return {
		item: {
			id: `customer-user:${user.id}`,
			label: name,
			face: face(name, user.avatarUrl),
			...(details === "" ? {} : { description: details }),
		},
		text: [user.name, user.email, account].filter((part) => part !== null).join(" "),
	}
}

/** The quick actions in today's order, with the host's key labels. */
const quickActions = ({ shortcuts }: PaletteProps): ReadonlyArray<Entry> => {
	const action = (id: string, label: string, icon: IconName, text: string, shortcut?: string | null) => ({
		item: { id, label, icon, ...(shortcut ? { shortcut } : {}) },
		text,
	})
	return [
		action("action:search", "Search messages", "search", "search messages find", shortcuts.search),
		action("action:create-channel", "Create channel", "plus", "create channel", shortcuts.createChannel),
		action(
			"action:start-dm",
			"Start conversation",
			"messages",
			"start conversation new dm",
			shortcuts.createDm,
		),
		action("action:join-channel", "Join channel", "plus", "join channel"),
		action("action:invite", "Invite members", "user-plus", "invite members", shortcuts.invite),
		action(
			"action:ai-panel",
			"Ask the AI assistant",
			"sparkles",
			"ask the ai assistant chat t3 code",
			shortcuts.aiPanel,
		),
	]
}

/** The page groups: the pinned ones always, every group once something is typed. */
const destinationGroups = (props: PaletteProps, words: ReadonlyArray<string>): ReadonlyArray<Group> => {
	const titles = [...new Set(props.destinations.map((page) => page.group))]
	return titles.flatMap((title) => {
		const pages = props.destinations.filter((page) => page.group === title)
		if (words.length === 0 && !pages.some((page) => page.pinned)) return []
		return [
			group(
				title,
				pages.map((page) => ({
					item: { id: `go:${page.id}`, label: page.label, icon: page.icon },
					text: [page.label, title, page.keywords].join(" "),
				})),
				words,
			),
		]
	})
}

export const homeGroups = (
	model: PaletteModel,
	props: PaletteProps,
	customerUsers: ReadonlyArray<CustomerUserSummary>,
): ReadonlyArray<Group> => {
	const words = wordsOf(model.query.text)
	const recent = recentChannelsOf(model)
	// Only once the user types: an org can have thousands of customers.
	const showCustomers = words.length > 0 && model.customers.length > 0
	return nonEmpty([
		group(
			"Recent",
			recent.map((channel) => recentItem(model, channel)),
			words,
		),
		group("Quick actions", quickActions(props), words),
		group(
			"Channels",
			model.channels.map((channel) => ({
				item: channelItem(`channel:${channel.id}`, channel),
				text: channel.name,
			})),
			words,
		),
		group(
			"Direct messages",
			model.dmChannels.map((dm) => ({
				item: dmItem(`dm:${dm.id}`, dm),
				text: dm.otherMembers.map((member) => `${member.firstName} ${member.lastName}`).join(" "),
			})),
			words,
		),
		...(showCustomers ? [group("Customers", model.customers.map(customerEntry), words)] : []),
		...(showCustomers
			? [
					group(
						"Users",
						customerUsers.map((user) => customerUserEntry(model, user)),
						words,
					),
				]
			: []),
		...destinationGroups(props, words),
		group(
			"Preferences",
			[
				{
					item: { id: "pref:status", label: "Set status...", icon: "user-pending" },
					text: "set status presence",
				},
				{
					item: { id: "pref:appearance", label: "Change appearance...", icon: "paintbrush" },
					text: "appearance theme dark light mode",
				},
			],
			words,
		),
	])
}

export const STATUS_OPTIONS = [
	{ value: "online", label: "Online", description: "Available and active" },
	{ value: "away", label: "Away", description: "Stepped away temporarily" },
	{ value: "busy", label: "Busy", description: "Focused, limit interruptions" },
	{ value: "dnd", label: "Do not disturb", description: "No notifications" },
] as const

export const THEME_OPTIONS = [
	{ value: "system", label: "System" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
] as const

// HAZEL-GAP(p4-palette-current-mark): today's "(current)" is a muted span after the label; here it is part of the label.
const current = (label: string, isCurrent: boolean) => (isCurrent ? `${label} (current)` : label)

// HAZEL-GAP(p4-palette-status-dot): today each status leads with its colour dot (success, warning, danger); items take an IconName.
export const statusGroups = (model: PaletteModel): ReadonlyArray<Group> =>
	nonEmpty([
		group(
			"Set status",
			STATUS_OPTIONS.map((option) => ({
				item: {
					id: `status:${option.value}`,
					label: current(option.label, model.presenceStatus === option.value),
				},
				text: `${option.label} ${option.description}`,
			})),
			wordsOf(model.query.text),
		),
	])

// HAZEL-GAP(p4-palette-theme-swatch): today each theme leads with a white, black or split swatch; the nearest icons stand in.
const THEME_ICONS = { system: "paintbrush", light: "sun", dark: "moon" } as const satisfies Record<
	string,
	IconName
>

export const appearanceGroups = (model: PaletteModel, props: PaletteProps): ReadonlyArray<Group> =>
	nonEmpty([
		group(
			"Theme",
			THEME_OPTIONS.map((option) => ({
				item: {
					id: `theme:${option.value}`,
					label: current(option.label, props.theme.mode === option.value),
					icon: THEME_ICONS[option.value],
				},
				text: `${option.label} theme mode`,
			})),
			wordsOf(model.query.text),
		),
	])

const AUTOCOMPLETE_TITLES = {
	from: "Select a user",
	in: "Select a channel",
	has: "Select attachment type",
} as const

const suggestionItem = (suggestion: Suggestion): Item => ({
	id: `suggestion:${suggestion.id}`,
	label: suggestion.label,
	...(suggestion.kind === "user"
		? { face: face(suggestion.label, suggestion.avatarUrl) }
		: suggestion.kind === "channel"
			? { icon: "hashtag" as const }
			: {}),
})

// HAZEL-GAP(p4-palette-filter-chips): today's chips sit in the field before the text, with an x and Backspace to remove; they show as a group of removable items.
const filterGroup = (filters: ReadonlyArray<SearchFilter>): Group => ({
	title: "Filters",
	items: filters.map((filter, index) => ({
		id: `filter:${index}`,
		label: `${getFilterTypeLabel(filter.type)}: ${filter.displayValue}`,
		icon: "close",
		description: "Remove",
	})),
})

// HAZEL-GAP(p4-palette-rich-rows): today's result is the author's avatar, name, "in #channel" and time over two lines of highlighted text; an item has a label and one description.
const resultItem = (result: SearchResult, index: number, nowMs: number): Item => ({
	id: `result:${index}`,
	label: previewOf(result.content),
	face: face(result.authorName, result.authorAvatarUrl),
	description: [
		result.authorName,
		result.channelName === null ? null : `in #${result.channelName}`,
		formatDistanceToNow(Math.min(result.createdAtMs, nowMs), nowMs),
	]
		.filter((part) => part !== null)
		.join(" "),
})

// HAZEL-GAP(p4-palette-group-action): today's "Recent searches" heading has a "Clear all" button; it is the group's last item.
const recentSearchItem = (search: RecentSearch, index: number, nowMs: number): Item => ({
	id: `recent-search:${index}`,
	label: [filterString(search.filters), search.query].filter((part) => part !== "").join(" "),
	icon: "clock",
	description: formatDistanceToNow(Math.min(search.timestamp, nowMs), nowMs),
})

export interface SearchView {
	readonly filters: ReadonlyArray<SearchFilter>
	readonly autocomplete: Autocomplete | null
	readonly suggestions: ReadonlyArray<Suggestion>
	readonly hasQuery: boolean
	readonly results: ReadonlyArray<SearchResult>
	readonly recentSearches: ReadonlyArray<RecentSearch>
	readonly nowMs: number
}

/** The search page: an open autocomplete, else the filters over the results, else recent searches. */
export const searchGroups = (view: SearchView): ReadonlyArray<Group> => {
	if (view.autocomplete !== null && view.suggestions.length > 0)
		return [
			{
				title: AUTOCOMPLETE_TITLES[view.autocomplete.filterType],
				items: view.suggestions.map(suggestionItem),
			},
		]
	if (view.hasQuery)
		return nonEmpty([
			filterGroup(view.filters),
			{
				title: "Messages",
				items: view.results.map((result, index) => resultItem(result, index, view.nowMs)),
			},
		])
	return view.recentSearches.length === 0
		? []
		: [
				{
					title: "Recent searches",
					items: [
						...view.recentSearches.map((search, index) =>
							recentSearchItem(search, index, view.nowMs),
						),
						{ id: "recent-search:clear", label: "Clear all", icon: "trash" },
					],
				},
			]
}
