// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat sidebar (`web-foldkit/src/shell/channels-sidebar/`) as one shared `hazel` screen over
 * `@hazel/client-data`: goto rows, favorites, the default and user sections, discover, customers and
 * DMs, threads under their channel, each row's and section's menu, and (with `chrome`) the org
 * switcher and account card. Navigation and every write go to the host as Commands, by today's keys.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { ChannelId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import { type Content, Hazel } from "@hazel/ui/vocabulary/index"
import { Clock, Effect, Layer, Match, Schema, Stream } from "effect"
import {
	channelMenu,
	Customer,
	Discoverable,
	DISCOVER_BELOW,
	dmMenu,
	dmTitleOf,
	Entry,
	inheritedLevelOf,
	initialsOf,
	isDmType,
	isMutedNow,
	listedThreads,
	MAX_DISCOVERABLE,
	Me,
	Org,
	Person,
	Presence,
	presenceOf,
	ScopeSetting,
	Section,
	sectionActionLabel,
	sectionActionsOf,
	sectionMenu,
	Synced,
	Thread,
	Unread,
	unreadSetOf,
	canManageChannels,
	canCreateChannels,
} from "./model"
import * as Q from "./queries"

/** Where a press asks the host to go; the host owns routing and answers with `ChangedRoute`. */
export const NavTarget = UiSchema.TaggedEnum({
	Channel: { channelId: ChannelId },
	Members: {},
})
export type NavTarget = typeof NavTarget.Type

/**
 * What the sidebar asks the host to do, by today's menu keys (`channels-sidebar/menus.ts`): the host
 * runs the write, the modal or the toast, as the Foldkit sidebar does for the same key.
 */
export const SidebarAction = UiSchema.TaggedEnum({
	RowMenu: { channelId: ChannelId, key: Schema.String },
	/** `sectionKey`: `default`, `dms` or a section id; `key` an action or a menu key. */
	SectionMenu: { sectionKey: Schema.String, key: Schema.String },
	Browse: {},
	DismissHint: {},
	OrgMenu: { key: Schema.String },
	AccountMenu: { key: Schema.String },
})
export type SidebarAction = typeof SidebarAction.Type

export const SidebarMessage = UiSchema.TaggedEnum({
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedMemberships: { entries: Schema.Array(Entry), threads: Schema.Array(Thread) },
	UpdatedDmPeople: { people: Schema.Record(Schema.String, Schema.Array(Person)) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedRole: { role: Schema.NullOr(Schema.String), memberId: Schema.NullOr(Schema.String) },
	UpdatedUnreadCounts: { counts: Schema.Record(Schema.String, Schema.Finite) },
	UpdatedUnread: { unread: Schema.Array(Unread) },
	UpdatedScopeSettings: { settings: Schema.Array(ScopeSetting) },
	UpdatedCustomers: { customers: Schema.Array(Customer) },
	UpdatedSynced: { synced: Schema.Array(Synced) },
	UpdatedDiscover: { channels: Schema.Array(Discoverable), memberCount: Schema.Finite },
	UpdatedChrome: { orgs: Schema.Array(Org), me: Schema.NullOr(Me) },
	Ticked: { nowMs: Schema.Finite },
	ChangedRoute: { activeChannelId: Schema.NullOr(ChannelId), membersActive: Schema.Boolean },
	PressedRow: { id: ChannelId },
	PressedMembers: {},
	PressedBrowse: {},
	ToggledSection: { key: Schema.String, collapsed: Schema.Boolean },
	SelectedRowMenu: { id: ChannelId, entry: Schema.String },
	SelectedSectionMenu: { key: Schema.String, entry: Schema.String },
	DismissedHint: {},
	SelectedOrgMenu: { entry: Schema.String },
	SelectedAccountMenu: { entry: Schema.String },
	CompletedRequest: {},
})
export type SidebarMessage = typeof SidebarMessage.Type

/** Opens a channel or the members page; the host navigates. */
export class RequestNavigation extends Command.Service<RequestNavigation>()(
	"hazel/sidebar/RequestNavigation",
	{
		args: { to: NavTarget },
		success: SidebarMessage,
	},
) {
	static readonly layerWith = (navigate: (to: NavTarget) => void) =>
		this.toLayer(
			Effect.succeed(({ to }) =>
				Effect.sync(() => {
					navigate(to)
					return SidebarMessage.CompletedRequest()
				}),
			),
		)
}

/** A menu choice or a press the host acts on (writes, modals, the palette, toasts). */
export class RequestSidebarAction extends Command.Service<RequestSidebarAction>()(
	"hazel/sidebar/RequestSidebarAction",
	{ args: { action: SidebarAction }, success: SidebarMessage },
) {
	static readonly layerWith = (act: (action: SidebarAction) => Effect.Effect<void>) =>
		this.toLayer(
			Effect.succeed(({ action }) => act(action).pipe(Effect.as(SidebarMessage.CompletedRequest()))),
		)
}

export const ChannelSidebarProps = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	orgSlug: Schema.String,
	activeChannelId: Schema.NullOr(ChannelId),
	membersActive: Schema.Boolean,
	/** The create-channel hint was dismissed (the host persists it). */
	hintDismissed: Schema.Boolean,
	/** The command palette's key, shown on "Browse channels" (web only). */
	paletteKey: Schema.NullOr(Schema.String),
	/** Draw the org switcher and the account card; the web app keeps its own. */
	chrome: Schema.Boolean,
})
export type ChannelSidebarProps = typeof ChannelSidebarProps.Type

export const Model = Schema.Struct({
	activeChannelId: Schema.NullOr(ChannelId),
	membersActive: Schema.Boolean,
	hintDismissed: Schema.Boolean,
	nowMs: Schema.Finite,
	loaded: Schema.Boolean,
	sections: Schema.Array(Section),
	entries: Schema.Array(Entry),
	threads: Schema.Array(Thread),
	dmPeople: Schema.Record(Schema.String, Schema.Array(Person)),
	presence: Schema.Array(Presence),
	role: Schema.NullOr(Schema.String),
	memberId: Schema.NullOr(Schema.String),
	unreadCounts: Schema.Record(Schema.String, Schema.Finite),
	unread: Schema.Array(Unread),
	scopeSettings: Schema.Array(ScopeSetting),
	customers: Schema.Array(Customer),
	synced: Schema.Array(Synced),
	discover: Schema.Array(Discoverable),
	memberCount: Schema.Finite,
	orgs: Schema.Array(Org),
	me: Schema.NullOr(Me),
	/** Section keys the user folded. */
	collapsed: Schema.Array(Schema.String),
})
export type Model = typeof Model.Type

export const initModel = (props: ChannelSidebarProps): Model => ({
	activeChannelId: props.activeChannelId,
	membersActive: props.membersActive,
	hintDismissed: props.hintDismissed,
	nowMs: 0,
	loaded: false,
	sections: [],
	entries: [],
	threads: [],
	dmPeople: {},
	presence: [],
	role: null,
	memberId: null,
	unreadCounts: {},
	unread: [],
	scopeSettings: [],
	customers: [],
	synced: [],
	discover: [],
	memberCount: 0,
	orgs: [],
	me: null,
	collapsed: [],
})

const act = (action: SidebarAction) => RequestSidebarAction.make({ action })

const dmIdsOf = (model: Model) =>
	model.entries
		.filter((entry) => isDmType(entry.type))
		.map((entry) => entry.id)
		.join(",")

const partnerIdsOf = (model: Model) =>
	[...new Set(Object.values(model.dmPeople).flatMap((people) => people.map((person) => person.userId)))]
		.sort()
		.join(",")

export const ChannelSidebar = Hazel.component({
	name: "ChannelSidebar",
	props: ChannelSidebarProps,
	model: Model,
	message: SidebarMessage,
}).make({
	init: ({ props }) => initModel(props),
	update: {
		UpdatedSections: ($, { sections }) => $.evolve({ sections: () => sections }),
		UpdatedMemberships: ($, { entries, threads }) =>
			$.evolve({ entries: () => entries, threads: () => threads, loaded: () => true }),
		UpdatedDmPeople: ($, { people }) => $.evolve({ dmPeople: () => people }),
		UpdatedPresence: ($, { presence }) => $.evolve({ presence: () => presence }),
		UpdatedRole: ($, { role, memberId }) => $.evolve({ role: () => role, memberId: () => memberId }),
		UpdatedUnreadCounts: ($, { counts }) => $.evolve({ unreadCounts: () => counts }),
		UpdatedUnread: ($, { unread }) => $.evolve({ unread: () => unread }),
		UpdatedScopeSettings: ($, { settings }) => $.evolve({ scopeSettings: () => settings }),
		UpdatedCustomers: ($, { customers }) => $.evolve({ customers: () => customers }),
		UpdatedSynced: ($, { synced }) => $.evolve({ synced: () => synced }),
		UpdatedDiscover: ($, { channels, memberCount }) =>
			$.evolve({ discover: () => channels, memberCount: () => memberCount }),
		UpdatedChrome: ($, { orgs, me }) => $.evolve({ orgs: () => orgs, me: () => me }),
		Ticked: ($, { nowMs }) => $.evolve({ nowMs: () => nowMs }),
		ChangedRoute: ($, { activeChannelId, membersActive }) =>
			$.evolve({ activeChannelId: () => activeChannelId, membersActive: () => membersActive }),
		// Selected at once; the host's route change confirms it.
		PressedRow: ($, { id }) =>
			$.evolve({ activeChannelId: () => id, membersActive: () => false }).run(
				RequestNavigation.make({ to: NavTarget.Channel({ channelId: id }) }),
			),
		PressedMembers: ($) =>
			$.evolve({ activeChannelId: () => null, membersActive: () => true }).run(
				RequestNavigation.make({ to: NavTarget.Members() }),
			),
		PressedBrowse: ($) => $.run(act(SidebarAction.Browse())),
		ToggledSection: ($, { key, collapsed }) =>
			$.evolve({
				collapsed: (all) =>
					collapsed ? [...all.filter((k) => k !== key), key] : all.filter((k) => k !== key),
			}),
		SelectedRowMenu: ($, { id, entry }) =>
			$.run(act(SidebarAction.RowMenu({ channelId: id, key: entry }))),
		SelectedSectionMenu: ($, { key, entry }) =>
			$.run(act(SidebarAction.SectionMenu({ sectionKey: key, key: entry }))),
		DismissedHint: ($) => $.evolve({ hintDismissed: () => true }).run(act(SidebarAction.DismissHint())),
		SelectedOrgMenu: ($, { entry }) => $.run(act(SidebarAction.OrgMenu({ key: entry }))),
		SelectedAccountMenu: ($, { entry }) => $.run(act(SidebarAction.AccountMenu({ key: entry }))),
		CompletedRequest: ($) => $.model,
	},
	subscriptions: ({ props, model }) => {
		const org = props.organizationId
		const user = props.userId
		const dmIds = dmIdsOf(model)
		const partners = partnerIdsOf(model)
		return [
			Subscription.make(
				"clock",
				Stream.tick("1 minute").pipe(
					Stream.mapEffect(() => Clock.currentTimeMillis),
					Stream.map((nowMs) => SidebarMessage.Ticked({ nowMs })),
				),
			),
			Subscription.make("sections", [org], ([id]) =>
				Q.sectionsStream(id, (sections) => SidebarMessage.UpdatedSections({ sections })),
			),
			Subscription.make("memberships", [org, user], ([o, u]) =>
				Q.membershipsStream(o, u, (entries, threads) =>
					SidebarMessage.UpdatedMemberships({ entries, threads }),
				),
			),
			Subscription.make("dmPeople", [user, dmIds], ([u, ids]) =>
				Q.dmPeopleStream(
					u,
					ids === "" ? [] : ids.split(",").map((id) => ChannelId.make(id)),
					(people) => SidebarMessage.UpdatedDmPeople({ people }),
				),
			),
			Subscription.make("presence", [partners], ([ids]) =>
				ids === ""
					? Stream.empty
					: Q.presenceStream(
							ids.split(",").map((id) => UserId.make(id)),
							(presence) => SidebarMessage.UpdatedPresence({ presence }),
						),
			),
			Subscription.make("role", [org, user], ([o, u]) =>
				Q.roleStream(o, u, (role, memberId) => SidebarMessage.UpdatedRole({ role, memberId })),
			),
			Subscription.make("unreadCounts", [model.memberId], ([memberId]) =>
				memberId === null
					? Stream.empty
					: Q.unreadCountsStream(memberId, (counts) =>
							SidebarMessage.UpdatedUnreadCounts({ counts }),
						),
			),
			Subscription.make("unread", [org, user], ([o, u]) =>
				Q.unreadStream(o, u, (unread) => SidebarMessage.UpdatedUnread({ unread })),
			),
			Subscription.make("scopeSettings", [org], ([o]) =>
				Q.scopeSettingsStream(o, (settings) => SidebarMessage.UpdatedScopeSettings({ settings })),
			),
			Subscription.make("customers", [org], ([o]) =>
				Q.customersStream(o, (customers) => SidebarMessage.UpdatedCustomers({ customers })),
			),
			Subscription.make(
				"synced",
				Q.syncedStream((synced) => SidebarMessage.UpdatedSynced({ synced })),
			),
			// Today's two queries in one: the joined count and the open public channels.
			Subscription.make("discover", [org, user], ([o, u]) =>
				Q.discoverStream(o, u, (channels, memberCount) =>
					SidebarMessage.UpdatedDiscover({ channels, memberCount }),
				),
			),
			...(props.chrome
				? [
						Subscription.make("chrome", [user], ([u]) =>
							Q.chromeStream(u, (orgs, me) => SidebarMessage.UpdatedChrome({ orgs, me })),
						),
					]
				: []),
		]
	},
	view: (h, model) => {
		const { orgSlug } = h.props
		const now = model.nowMs
		const unreadIds = unreadSetOf(model.unread, now)
		const settingOf = (sectionId: ChannelSectionId | null) =>
			model.scopeSettings.find((setting) => setting.sectionId === sectionId)
		const orgSetting = settingOf(null)
		const isOrgMuted = orgSetting !== undefined && isMutedNow(orgSetting, now)
		const mutedSections = new Set(
			model.scopeSettings.flatMap((setting) =>
				setting.sectionId !== null && isMutedNow(setting, now) ? [setting.sectionId] : [],
			),
		)
		const customerOf = new Map(model.customers.map((row) => [row.channelId as string, row]))
		const syncedOf = new Map(model.synced.map((row) => [row.channelId as string, row.provider]))
		const threadsOf = listedThreads(model.threads, model.activeChannelId, now, unreadIds)
		const presenceOfUser = new Map(model.presence.map((row) => [row.userId as string, row]))
		const canDelete = canManageChannels(model.role)
		const hrefOf = (id: ChannelId) => `/${orgSlug}/chat/${id}`

		/** The channel's icon (`channelIcon`): a customer's logo, its emoji, else a lock or a hashtag, with its sync mark. */
		const channelLeading = (entry: {
			readonly id: ChannelId
			readonly type: string
			readonly icon: string | null
		}) => {
			const customer = customerOf.get(entry.id)
			// Connect partners (`partners`) wait on a query this screen does not run yet.
			return h.channelIcon
				.private(entry.type === "private")
				.emoji(entry.icon ?? undefined)
				.customer(
					customer === undefined
						? undefined
						: {
								name: customer.accountName,
								initials: initialsOf(customer.accountName),
								src: customer.accountLogoUrl ?? undefined,
							},
				)
				.sync(syncedOf.get(entry.id) ?? "none")
		}

		const countOf = (entry: Entry) =>
			model.unreadCounts[entry.id] ?? (isDmType(entry.type) ? 0 : entry.notificationCount)

		const threadRows = (parent: Entry, scopeMuted: boolean) => {
			const threads = threadsOf.get(parent.id) ?? []
			return threads.map((thread, index) => {
				const count = model.unreadCounts[thread.id] ?? thread.notificationCount
				const isUnread = !scopeMuted && unreadIds.has(thread.id)
				const selected = model.activeChannelId === thread.id
				return h.item
					.key(`thread:${thread.id}`)
					.title(thread.name)
					.nested(index === threads.length - 1 ? "last" : "middle")
					.badge(count)
					.emphasized(count > 0 || isUnread)
					.selected(selected)
					.href(selected ? undefined : hrefOf(thread.id))
					.on("press", SidebarMessage.PressedRow({ id: thread.id }))
			})
		}

		/** The row's menu: a dots trigger in `actions` (shown on hover or focus), and its context menu. */
		const dotsMenu = (id: ChannelId, label: string, entries: Content.MenuGroups) =>
			h.menu
				.label(label)
				.entries(entries)
				.on("select", ({ id: entry }) => SidebarMessage.SelectedRowMenu({ id, entry }))
				.trigger(h.button.icon("dots").iconOnly().variant("ghost").size("xsmall").label(label))

		const withMenu = (
			key: string,
			id: ChannelId,
			entries: Content.MenuGroups,
			row: ReturnType<typeof h.item.title>,
		) =>
			h.contextMenu
				.key(key)
				.entries(entries)
				.on("select", ({ id: entry }) => SidebarMessage.SelectedRowMenu({ id, entry }))
				.children(row)

		const channelRow = (entry: Entry, keyPrefix: string, isCustomerRow = false) => {
			const scopeMuted =
				(isOrgMuted && !isDmType(entry.type)) ||
				(entry.sectionId !== null && mutedSections.has(entry.sectionId))
			const ownMuted = isMutedNow(entry, now)
			const count = countOf(entry)
			const isUnread = unreadIds.has(entry.id) && !scopeMuted
			const emphasized = count > 0 || isUnread
			const selected = model.activeChannelId === entry.id
			const sectionSetting = entry.sectionId === null ? undefined : settingOf(entry.sectionId)
			const menu = channelMenu(entry, {
				isMuted: ownMuted,
				inheritedLevel: inheritedLevelOf(
					entry.type,
					sectionSetting?.notificationLevel,
					orgSetting?.notificationLevel,
				),
				sections: model.sections,
				canDelete,
				isCustomerRow,
			})
			const row = h.item
				.title(entry.name)
				.leading(channelLeading(entry))
				.badge(count)
				.unread(isUnread && !selected ? "pip" : "none")
				.emphasized(emphasized)
				.actions(dotsMenu(entry.id, "Channel options", menu))
				.selected(selected)
				.muted((ownMuted || scopeMuted) && !emphasized)
				.href(selected ? undefined : hrefOf(entry.id))
				.on("press", SidebarMessage.PressedRow({ id: entry.id }))
			return [
				withMenu(`${keyPrefix}:${entry.id}`, entry.id, menu, row),
				...threadRows(entry, scopeMuted),
			]
		}

		const dmRow = (entry: Entry, keyPrefix: string) => {
			const partners = model.dmPeople[entry.id] ?? []
			const title = dmTitleOf(entry.type, partners, entry.name)
			const count = countOf(entry)
			const isUnread = unreadIds.has(entry.id)
			const emphasized = count > 0 || isUnread
			const ownMuted = isMutedNow(entry, now)
			const selected = model.activeChannelId === entry.id
			const only = entry.type === "single" && partners.length === 1 ? partners[0] : undefined
			const presence = only === undefined ? undefined : presenceOfUser.get(only.userId)
			const avatarOf = (person: Person) => {
				const name = `${person.firstName} ${person.lastName}`.trim()
				return h.avatar
					.key(person.userId)
					.name(name)
					.initials(initialsOf(name))
					.src(person.avatarUrl ?? undefined)
			}
			const leading =
				only !== undefined
					? avatarOf(only).presence(presenceOf(presence?.status))
					: h.avatarStack
							.overflow(Math.max(0, partners.length - 2))
							.children(...partners.slice(0, 2).map(avatarOf))
			const menu = dmMenu(entry, ownMuted)
			const row = h.item
				.title(title)
				.leading(leading)
				.badge(count)
				.emphasized(emphasized)
				.selected(selected)
				.muted(ownMuted && !emphasized)
				.href(selected ? undefined : hrefOf(entry.id))
				.trailing(
					presence?.statusEmoji ? h.text.role("caption").children(presence.statusEmoji) : null,
				)
				.on("press", SidebarMessage.PressedRow({ id: entry.id }))
			return [withMenu(`${keyPrefix}:${entry.id}`, entry.id, menu, row)]
		}

		const isCollapsed = (key: string) => model.collapsed.includes(key)

		/** A section's "+": one action is a plain button; several, or a deletable section, a menu. */
		const withAction = <S extends ReturnType<typeof h.section.title>>(
			section: S,
			key: string,
			title: string,
		) => {
			const { actions, isEditable } = sectionActionsOf(key, model.role)
			const [only] = actions
			if (only !== undefined && actions.length === 1 && !isEditable)
				return section.action(
					h.icon.name("plus"),
					SidebarMessage.SelectedSectionMenu({ key, entry: only }),
					sectionActionLabel(only),
				)
			const real = model.sections.find((candidate) => candidate.id === key)
			const setting = real === undefined ? undefined : settingOf(real.id)
			const notifications =
				real === undefined
					? null
					: {
							isMuted: setting !== undefined && isMutedNow(setting, now),
							level: setting?.notificationLevel ?? null,
							inherited: inheritedLevelOf("public", null, orgSetting?.notificationLevel),
						}
			return section.action(
				h.icon.name("plus"),
				Hazel.actionMenu(sectionMenu(actions, isEditable, notifications), ({ id }) =>
					SidebarMessage.SelectedSectionMenu({ key, entry: id }),
				),
				`New in ${title}`,
			)
		}

		const group = (
			key: string,
			title: string,
			rows: ReadonlyArray<ReturnType<typeof channelRow>[number]>,
			action: boolean,
		) => {
			const collapsed = isCollapsed(key)
			const section = h.section
				.key(key)
				.style("tree")
				.title(title)
				.collapsible()
				.collapsed(collapsed)
				.on("toggle", ({ collapsed: next }) =>
					SidebarMessage.ToggledSection({ key, collapsed: next }),
				)
			return (action ? withAction(section, key, title) : section).children(...(collapsed ? [] : rows))
		}

		// Partition the memberships as today's queries do.
		const favorites = model.entries.filter((entry) => entry.isFavorite)
		const listed = model.entries.filter((entry) => !entry.isFavorite)
		const channelsIn = (sectionId: ChannelSectionId | null) =>
			listed.filter(
				(entry) =>
					!isDmType(entry.type) && entry.sectionId === sectionId && !customerOf.has(entry.id),
			)
		const shownSectionIds = new Set<string | null>([null, ...model.sections.map((section) => section.id)])
		const customerRows = listed
			.filter(
				(entry) =>
					!isDmType(entry.type) && customerOf.has(entry.id) && shownSectionIds.has(entry.sectionId),
			)
			.sort(
				(a, b) =>
					(customerOf.get(a.id)?.accountName ?? "").localeCompare(
						customerOf.get(b.id)?.accountName ?? "",
					) || a.name.localeCompare(b.name),
			)
		const defaultEntries = channelsIn(null)
		const showHint =
			model.loaded &&
			defaultEntries.length === 0 &&
			canCreateChannels(model.role) &&
			!model.hintDismissed
		const showDiscover = model.loaded && model.discover.length > 0 && model.memberCount < DISCOVER_BELOW

		const goto = h.section
			.key("goto")
			.style("tree")
			.children(
				h.item
					.key("browse")
					.title("Browse channels")
					.leading(h.icon.name("search"))
					.shortcut(h.props.paletteKey ?? undefined)
					.on("press", SidebarMessage.PressedBrowse()),
				h.item
					.key("members")
					.title("Members")
					.leading(h.icon.name("users"))
					.selected(model.membersActive)
					.href(model.membersActive ? undefined : `/${orgSlug}`)
					.on("press", SidebarMessage.PressedMembers()),
			)

		const discover = showDiscover
			? h.section
					.key("discover")
					.style("tree")
					.title("Discover")
					.children(
						...model.discover.slice(0, MAX_DISCOVERABLE).map((channel) => {
							const selected = model.activeChannelId === channel.id
							return h.item
								.key(`discover:${channel.id}`)
								.title(channel.name)
								.muted(!selected)
								.selected(selected)
								.leading(channelLeading({ ...channel, type: "public" }))
								.href(selected ? undefined : hrefOf(channel.id))
								.on("press", SidebarMessage.PressedRow({ id: channel.id }))
						}),
						...(model.discover.length > MAX_DISCOVERABLE
							? [
									h.item
										.key("browse-all")
										.title("Browse all channels...")
										.muted()
										.on("press", SidebarMessage.PressedBrowse()),
								]
							: []),
					)
			: null

		// Today's hint: a lightbulb, one wrapped caption with the create shortcut as a key cap, a dismiss.
		const hint = showHint
			? h.frame
					.key("hint")
					.surface("hint")
					.children(
						h.stack
							.axis("horizontal")
							.align("center")
							.density("compact")
							.children(
								h.icon.name("lightbulb"),
								h.text
									.role("caption")
									.tone("muted")
									.children(
										"Create your first channel with ",
										h.text.role("kbd").children("⌥⌘N"),
									),
								h.spacer,
								h.button
									.icon("close")
									.iconOnly()
									.variant("ghost")
									.size("xsmall")
									.label("Dismiss")
									.on("press", SidebarMessage.DismissedHint()),
							),
					)
			: null

		const body = model.loaded
			? [
					goto,
					favorites.length === 0
						? null
						: h.section
								.key("favorites")
								.style("tree")
								.title("Favorites")
								.children(
									...favorites
										.filter((entry) => !isDmType(entry.type))
										.flatMap((entry) => channelRow(entry, "fav")),
									...favorites
										.filter((entry) => isDmType(entry.type))
										.flatMap((entry) => dmRow(entry, "fav")),
								),
					group(
						"default",
						"Channels",
						defaultEntries.flatMap((entry) => channelRow(entry, "default")),
						true,
					),
					discover,
					hint,
					...model.sections.map((section) =>
						group(
							section.id,
							section.name,
							channelsIn(section.id).flatMap((entry) => channelRow(entry, section.id)),
							true,
						),
					),
					customerRows.length === 0
						? null
						: group(
								"customers",
								"Customers",
								customerRows.flatMap((entry) => channelRow(entry, "customers", true)),
								false,
							),
					group(
						"dms",
						"Direct Messages",
						listed
							.filter((entry) => isDmType(entry.type))
							.flatMap((entry) => dmRow(entry, "dms")),
						true,
					),
				]
			: [goto]

		// Today's section group: sections 2px apart (`gap-y-0.5`).
		if (!h.props.chrome) return h.stack.density("tight").children(...body)

		const org = model.orgs.find((candidate) => candidate.id === h.props.organizationId)
		const orgName = org?.name ?? "Hazel"
		const orgSwitcher = h.menu
			.key("org-switcher")
			.label("Switch organization")
			.entries([
				{
					entries: model.orgs.map((candidate) => ({
						id: `org:${candidate.id}`,
						label: candidate.name,
						checked: candidate.id === h.props.organizationId,
					})),
				},
				{ entries: [{ id: "org-settings", label: "Organization settings", icon: "gear" }] },
			])
			.on("select", ({ id }) => SidebarMessage.SelectedOrgMenu({ entry: id }))
			.trigger(
				h.item
					.title(orgName)
					.leading(
						h.avatar
							.name(orgName)
							.initials(initialsOf(orgName))
							.src(org?.logoUrl ?? undefined),
					)
					.trailing(h.icon.name("chevron-down")),
			)
		const me = model.me
		const myName = me === null ? "" : `${me.firstName} ${me.lastName}`.trim()
		const account =
			me === null
				? null
				: h.menu
						.key("account")
						.label("Account")
						.entries([
							{ entries: [{ id: "settings", label: "Settings", icon: "gear" }] },
							{
								entries: [
									{ id: "sign-out", label: "Sign out", icon: "leave", destructive: true },
								],
							},
						])
						.on("select", ({ id }) => SidebarMessage.SelectedAccountMenu({ entry: id }))
						.trigger(
							h.item
								.title(myName)
								.subtitle(me.email)
								.leading(
									h.avatar
										.name(myName)
										.initials(initialsOf(myName))
										.src(me.avatarUrl ?? undefined)
										.presence("online"),
								),
						)
		return h.screen.title(orgName).children(orgSwitcher, ...body, account)
	},
})

/** What a host provides: the data instance, its navigation and its sidebar actions. */
export const channelSidebarLayer = (
	data: ClientData["Service"],
	navigate: (to: NavTarget) => void,
	act: (action: SidebarAction) => Effect.Effect<void>,
) =>
	Layer.mergeAll(
		Layer.succeed(ClientData, data),
		RequestNavigation.layerWith(navigate),
		RequestSidebarAction.layerWith(act),
	)

/** For tests and hosts that branch on a target. */
export const matchTarget = <A>(
	to: NavTarget,
	cases: { readonly Channel: (id: ChannelId) => A; readonly Members: () => A },
) =>
	Match.valueTags(to, {
		Channel: ({ channelId }) => cases.Channel(channelId),
		Members: () => cases.Members(),
	})
