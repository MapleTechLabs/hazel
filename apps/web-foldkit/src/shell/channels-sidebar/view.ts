import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import { type Attribute, createKeyedLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconMagnifier3, IconUsers } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { sidebarItem, sidebarLink } from "../../ui/sidebar"
import type * as Menu from "../../ui/menu"
import { canOn } from "./menu-update"
import { closedRowMenu, rowMenuView } from "./menus"
import { Message, type Model } from "./model"
import { createChannelHint } from "./create-channel-hint"
import { hotkeyLabel } from "./hotkey-label"
import {
	CHANNEL_ACTIVE,
	channelItem,
	discoverableItem,
	dmDisplayName,
	dmItem,
	dmPartners,
	isChannelLinkActive,
	type ItemContext,
	label,
} from "./items"
import {
	type ChannelEntry,
	type DmChannel,
	type PartnerOrg,
	partnerOrgsByChannel,
	type Presence,
} from "./rows"
import { sectionGroupHeader, strong, treeRow, treeSection } from "./tree"

/** `ChannelsSidebar`'s content: goto links, favorites, channel sections, discover, DMs. */

const MAX_DISCOVERABLE = 5

interface SectionsContext<M> extends ItemContext {
	readonly activeChannelId: string | undefined
	readonly onActiveMount: Attribute<M>
	readonly onBrowseChannels: Attribute<M>
	/** The row menus' inputs; each row builds its own menu inside its memo. */
	readonly openMenu: Model["openMenu"]
	readonly sections: Model["sections"]
	readonly canDeleteChannels: boolean
	readonly toParentMessage: (message: Message) => M
	readonly sectionAction: (sectionKey: string) => Html
	readonly unreadByChannel: ReadonlyMap<string, number>
	readonly partnersByChannel: ReturnType<typeof partnerOrgsByChannel>
}

/** A row's position in its tree; part of every row memo. */
interface RowPlace {
	readonly treeId: string
	readonly position: number
	readonly setSize: number
	readonly allowsDragging: boolean
}

/**
 * One memo slot per tree row, keyed like the row's DOM: a channel switch or an unread change
 * re-renders only the rows whose inputs changed, not all 500. Keys are bounded by the channels.
 */
const rowSlots = createKeyedLazy()

const NO_PARTNERS: ReadonlyArray<PartnerOrg> = []

const channelRowView = <M>(
	h: HtmlBuilder<M>,
	entry: ChannelEntry,
	notificationCount: number,
	partners: ReadonlyArray<PartnerOrg>,
	isLinkActive: boolean,
	orgSlug: string,
	treeId: string,
	position: number,
	setSize: number,
	allowsDragging: boolean,
	onActiveMount: Attribute<M> | null,
	openMenu: Menu.Model | null,
	sections: Model["sections"],
	canDelete: boolean,
	toParentMessage: (message: Message) => M,
): Html =>
	treeRow(h, {
		onActiveMount,
		treeId,
		key: entry.channel.id,
		label: entry.channel.name,
		position,
		setSize,
		allowsDragging,
		content: channelItem(
			h,
			entry,
			notificationCount,
			partners,
			{ orgSlug, isActive: isLinkActive },
			rowMenuView(h, {
				menu: openMenu ?? closedRowMenu(entry.channel.id, sections, canDelete),
				entry,
				sections,
				toMessage: (message) =>
					toParentMessage(
						Message.GotRowMenuMessage({ channelId: entry.channel.id, orgSlug, message }),
					),
			}),
		),
	})

const openRowMenu = (openMenu: Model["openMenu"], channelId: string): Menu.Model | null =>
	openMenu !== null && openMenu.target === `channel:${channelId}` ? openMenu.menu : null

/** Favorites render `ChannelItem` without `partnerOrgs`, so they never show the shared-org badge. */
const channelRow = <M>(
	h: HtmlBuilder<M>,
	entry: ChannelEntry,
	context: SectionsContext<M>,
	place: RowPlace,
	showsPartners: boolean,
): Html => {
	const id = entry.channel.id
	return (
		rowSlots(`${place.treeId}:${id}`, channelRowView<M>, [
			h,
			entry,
			context.unreadByChannel.get(id) ?? entry.member.notificationCount,
			showsPartners ? (context.partnersByChannel.get(id) ?? NO_PARTNERS) : NO_PARTNERS,
			isChannelLinkActive(context.pathname, context.orgSlug, id),
			context.orgSlug,
			place.treeId,
			place.position,
			place.setSize,
			place.allowsDragging,
			id === context.activeChannelId ? context.onActiveMount : null,
			openRowMenu(context.openMenu, id),
			context.sections,
			context.canDeleteChannels,
			context.toParentMessage,
		]) ?? h.empty
	)
}

const dmRowView = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel,
	notificationCount: number,
	presence: Presence | undefined,
	nowMs: number,
	currentUserId: string | null,
	isLinkActive: boolean,
	orgSlug: string,
	treeId: string,
	position: number,
	setSize: number,
	allowsDragging: boolean,
	onActiveMount: Attribute<M> | null,
): Html =>
	treeRow(h, {
		onActiveMount,
		treeId,
		key: channel.id,
		label: dmDisplayName(channel, dmPartners(channel, currentUserId)),
		position,
		setSize,
		allowsDragging,
		content: dmItem(h, channel, notificationCount, {
			orgSlug,
			isActive: isLinkActive,
			currentUserId,
			nowMs,
			presence,
		}),
	})

/** A `DmChannelItem` renders nothing until its channel and the user's membership load. */
const dmRow = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel,
	context: SectionsContext<M>,
	place: RowPlace,
): Html => {
	const partners = dmPartners(channel, context.currentUserId)
	const only = channel.type === "single" && partners.length === 1 ? partners[0] : undefined
	return (
		rowSlots(`${place.treeId}:${channel.id}`, dmRowView<M>, [
			h,
			channel,
			context.unreadByChannel.get(channel.id) ?? 0,
			only === undefined ? undefined : context.presenceByUser.get(only.userId),
			// Only a single DM's status dot reads the clock.
			only === undefined ? 0 : context.nowMs,
			context.currentUserId,
			isChannelLinkActive(context.pathname, context.orgSlug, channel.id),
			context.orgSlug,
			place.treeId,
			place.position,
			place.setSize,
			place.allowsDragging,
			channel.id === context.activeChannelId ? context.onActiveMount : null,
		]) ?? h.empty
	)
}

/** A tree's rows in order: each knows its position and the tree's size (`aria-posinset`). */
type RowOf = (place: RowPlace) => Html

const rowsOf = (treeId: string, allowsDragging: boolean, rows: ReadonlyArray<RowOf>): Html[] =>
	rows.map((row, index) => row({ treeId, position: index + 1, setSize: rows.length, allowsDragging }))

const channelRowOf =
	<M>(h: HtmlBuilder<M>, context: SectionsContext<M>, showsPartners: boolean) =>
	(entry: ChannelEntry): RowOf =>
	(place) =>
		channelRow(h, entry, context, place, showsPartners)

const dmRowOf =
	<M>(h: HtmlBuilder<M>, context: SectionsContext<M>) =>
	(channel: DmChannel | null | undefined): RowOf[] =>
		channel ? [(place) => dmRow(h, channel, context, place)] : []

const gotoSection = <M>(h: HtmlBuilder<M>, context: SectionsContext<M>): Html => {
	const membersHref = hrefOf(AppRoute.OrgHome({ orgSlug: context.orgSlug }))
	return h.div(
		[
			h.Attribute("aria-label", "Goto"),
			h.Attribute("data-slot", "sidebar-section"),
			h.Class(
				twMerge(
					"col-span-full flex min-w-0 flex-col gap-y-0.5 **:data-[slot=sidebar-section]:**:gap-y-0",
					"in-data-[state=collapsed]:p-2 p-4",
					undefined,
				),
			),
		],
		[
			h.div(
				[
					h.Attribute("data-slot", "sidebar-section-inner"),
					h.Class("grid grid-cols-[auto_1fr] gap-y-0.5 in-data-[state=collapsed]:gap-y-1.5"),
				],
				[
					sidebarItem(h, { attributes: [context.onBrowseChannels] }, [
						IconMagnifier3(h),
						label(h, ["Browse channels"]),
						h.kbd(
							[
								h.Attribute("data-slot", "keyboard"),
								h.Attribute("dir", "ltr"),
								h.Class(
									twMerge(
										"hidden font-mono text-[0.80rem]/6 text-current/60 group-hover:text-fg group-focus:text-fg group-focus:opacity-90 group-disabled:opacity-50 lg:inline forced-colors:group-focus:text-[HighlightText",
										"absolute top-1/2 right-2 -translate-y-1/2 font-mono text-muted-fg text-xs",
									),
								),
							],
							[hotkeyLabel("Mod+K")],
						),
					]),
					sidebarItem(h, {}, [
						sidebarLink(
							h,
							{
								href: membersHref,
								isActive: context.pathname === membersHref,
								activeClassName: CHANNEL_ACTIVE,
							},
							[IconUsers(h), label(h, ["Members"])],
						),
					]),
				],
			),
		],
	)
}

const favoritesSection = <M>(h: HtmlBuilder<M>, model: Model, context: SectionsContext<M>): Html[] => {
	if (model.favorites.length === 0) return []
	const isPublicOrPrivate = (entry: ChannelEntry) =>
		entry.channel.type === "public" || entry.channel.type === "private"
	const isDm = (entry: ChannelEntry) => entry.channel.type === "direct" || entry.channel.type === "single"
	const rows = [
		...model.favorites.filter(isPublicOrPrivate).map(channelRowOf(h, context, false)),
		...model.favorites
			.filter(isDm)
			.flatMap((entry) => dmRowOf(h, context)(model.dmChannels[entry.channel.id])),
	]
	return [
		treeSection(h, {
			id: "sidebar-tree-favorites",
			ariaLabel: "Favorite channels",
			header: h.div(
				[
					h.Class(
						"col-span-full flex items-center justify-between gap-x-2 pl-2.5 text-muted-fg text-xs/5",
					),
				],
				[strong(h, ["Favorites"])],
			),
			allowsDragging: false,
			rows: rowsOf("sidebar-tree-favorites", false, rows),
		}),
	]
}

const channelSection = <M>(
	h: HtmlBuilder<M>,
	options: {
		readonly key: string
		readonly name: string
		readonly entries: ReadonlyArray<ChannelEntry>
	},
	context: SectionsContext<M>,
): Html => {
	const treeId = `sidebar-tree-${options.key}`
	return treeSection(h, {
		id: treeId,
		ariaLabel: `${options.name} channels`,
		header: sectionGroupHeader(h, {
			name: options.name,
			isCollapsed: false,
			action: context.sectionAction(options.key),
		}),
		allowsDragging: true,
		rows: rowsOf(treeId, true, options.entries.map(channelRowOf(h, context, true))),
	})
}

/** `DiscoverableChannels`: shown while the user is in fewer than three channels. */
const discoverSection = <M>(h: HtmlBuilder<M>, model: Model, context: ItemContext): Html[] => {
	const memberCount = model.memberChannelIds?.length ?? 0
	if (model.discoverableChannels.length === 0 || memberCount >= 3) return []
	return [
		h.div(
			[h.Class("grid grid-cols-[auto_1fr] gap-y-0.5 px-2 pb-1")],
			[
				h.div(
					[h.Class("col-span-full pl-2.5 pt-2 pb-0.5 text-muted-fg/60 text-xs")],
					[strong(h, ["Discover"])],
				),
				...model.discoverableChannels
					.slice(0, MAX_DISCOVERABLE)
					.map((channel) => discoverableItem(h, channel, context)),
				...(model.discoverableChannels.length > MAX_DISCOVERABLE
					? [
							h.button(
								[
									h.Attribute("type", "button"),
									h.Class(
										"col-span-full w-full rounded-lg py-1 pl-2.5 text-left text-muted-fg/60 text-sm transition-colors hover:bg-sidebar-accent hover:text-fg",
									),
								],
								["Browse all channels..."],
							),
						]
					: []),
			],
		),
	]
}

// Pure memo on the frozen inputs, so the partner arrays (row memo args) keep their identity.
const partnersMemo = new WeakMap<
	Model["connectMounts"],
	{
		readonly organizations: Model["organizations"]
		readonly organizationId: Model["organizationId"]
		readonly result: ReturnType<typeof partnerOrgsByChannel>
	}
>()
const partnersOf = (model: Model) => {
	const cached = partnersMemo.get(model.connectMounts)
	if (
		cached &&
		cached.organizations === model.organizations &&
		cached.organizationId === model.organizationId
	)
		return cached.result
	const result = partnerOrgsByChannel(model.connectMounts, model.organizations, model.organizationId)
	partnersMemo.set(model.connectMounts, {
		organizations: model.organizations,
		organizationId: model.organizationId,
		result,
	})
	return result
}

export const sectionGroupContent = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	itemContext: Omit<ItemContext, "presenceByUser" | "nowMs" | "currentUserId"> & {
		readonly activeChannelId: string | undefined
		readonly onActiveMount: Attribute<M>
		readonly onBrowseChannels: Attribute<M>
		readonly onDismissCreateChannelHint: Attribute<M>
		readonly toParentMessage: (message: Message) => M
		readonly sectionAction: (sectionKey: string) => Html
	},
): Html[] => {
	const context: SectionsContext<M> = {
		...itemContext,
		currentUserId: model.currentUserId,
		nowMs: model.nowMs,
		presenceByUser: new Map(model.presence.map((presence) => [presence.userId, presence])),
		unreadByChannel: new Map(model.unreadCounts.map((unread) => [unread.channelId, unread.count])),
		partnersByChannel: partnersOf(model),
		openMenu: model.openMenu,
		sections: model.sections,
		canDeleteChannels: canOn(model, "channel.delete"),
	}
	const role = model.membership?.role
	const canCreateChannel = role !== undefined && canPerform(RPC_SCOPE_MAP, role, "channel.create")
	const defaultEntries = model.sectionChannels["default"] ?? []
	return [
		gotoSection(h, context),
		...(model.organizationId === null
			? []
			: [
					...favoritesSection(h, model, context),
					channelSection(
						h,
						{
							key: "default",
							name: "Channels",
							entries: defaultEntries,
						},
						context,
					),
					...discoverSection(h, model, context),
					...(defaultEntries.length === 0 && canCreateChannel && !model.isCreateChannelHintDismissed
						? [createChannelHint(h, itemContext.onDismissCreateChannelHint)]
						: []),
					...model.sections.map((section) =>
						channelSection(
							h,
							{
								key: section.id,
								name: section.name,
								entries: model.sectionChannels[section.id] ?? [],
							},
							context,
						),
					),
					treeSection(h, {
						id: "sidebar-tree-dms",
						ariaLabel: "Direct Messages channels",
						header: sectionGroupHeader(h, {
							name: "Direct Messages",
							isCollapsed: false,
							action: context.sectionAction("dms"),
						}),
						allowsDragging: false,
						rows: rowsOf(
							"sidebar-tree-dms",
							false,
							model.dmChannelIds.flatMap((channelId) =>
								dmRowOf(h, context)(model.dmChannels[channelId]),
							),
						),
					}),
				]),
	]
}
