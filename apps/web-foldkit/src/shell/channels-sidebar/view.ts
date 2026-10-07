import { canPerform, RPC_SCOPE_MAP } from "@hazel/domain/scopes"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconMagnifier3, IconUsers } from "../../icons"
import { sidebarItem, sidebarLink } from "../../ui/sidebar"
import type { Model } from "./model"
import { createChannelHint } from "./create-channel-hint"
import { hotkeyLabel } from "./hotkey-label"
import {
	CHANNEL_ACTIVE,
	channelItem,
	discoverableItem,
	dmDisplayName,
	dmItem,
	dmPartners,
	type ItemContext,
	label,
} from "./items"
import { type ChannelEntry, type DmChannel, partnerOrgsByChannel } from "./rows"
import { sectionGroupHeader, strong, treeRow, treeSection } from "./tree"

/** `ChannelsSidebar`'s content: goto links, favorites, channel sections, discover, DMs. */

const MAX_DISCOVERABLE = 5

interface SectionsContext<M> extends ItemContext {
	readonly activeChannelId: string | undefined
	readonly onActiveMount: Attribute<M>
	readonly unreadByChannel: ReadonlyMap<string, number>
	readonly partnersByChannel: ReturnType<typeof partnerOrgsByChannel>
}

interface RowSpec {
	readonly key: string
	readonly label: string
	readonly content: Html
}

const rowsOf = <M>(
	h: HtmlBuilder<M>,
	context: SectionsContext<M>,
	treeId: string,
	allowsDragging: boolean,
	specs: ReadonlyArray<RowSpec>,
) =>
	specs.map((spec, index) =>
		treeRow(h, {
			isActive: spec.key === context.activeChannelId,
			onActiveMount: context.onActiveMount,
			treeId,
			key: spec.key,
			label: spec.label,
			position: index + 1,
			setSize: specs.length,
			allowsDragging,
			content: spec.content,
		}),
	)

const channelRow = <M>(h: HtmlBuilder<M>, entry: ChannelEntry, context: SectionsContext<M>): RowSpec => ({
	key: entry.channel.id,
	label: entry.channel.name,
	content: channelItem(
		h,
		entry,
		context.unreadByChannel.get(entry.channel.id) ?? entry.member.notificationCount,
		context.partnersByChannel.get(entry.channel.id) ?? [],
		context,
	),
})

/** A `DmChannelItem` renders nothing until its channel and the user's membership load. */
const dmRow = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel | null | undefined,
	context: SectionsContext<M>,
): RowSpec[] =>
	channel
		? [
				{
					key: channel.id,
					label: dmDisplayName(channel, dmPartners(channel, context.currentUserId)),
					content: dmItem(h, channel, context.unreadByChannel.get(channel.id) ?? 0, context),
				},
			]
		: []

const gotoSection = <M>(h: HtmlBuilder<M>, context: ItemContext): Html => {
	const membersHref = `/${context.orgSlug}`
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
					sidebarItem(h, {}, [
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
	const specs = [
		...model.favorites.filter(isPublicOrPrivate).map((entry) => channelRow(h, entry, context)),
		...model.favorites
			.filter(isDm)
			.flatMap((entry) => dmRow(h, model.dmChannels[entry.channel.id], context)),
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
			rows: rowsOf(h, context, "sidebar-tree-favorites", false, specs),
		}),
	]
}

const channelSection = <M>(
	h: HtmlBuilder<M>,
	options: {
		readonly key: string
		readonly name: string
		readonly entries: ReadonlyArray<ChannelEntry>
		readonly hasMenu: boolean
	},
	context: SectionsContext<M>,
): Html => {
	const treeId = `sidebar-tree-${options.key}`
	return treeSection(h, {
		id: treeId,
		ariaLabel: `${options.name} channels`,
		header: sectionGroupHeader(h, { name: options.name, isCollapsed: false, hasMenu: options.hasMenu }),
		allowsDragging: true,
		rows: rowsOf(
			h,
			context,
			treeId,
			true,
			options.entries.map((entry) => channelRow(h, entry, context)),
		),
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

export const sectionGroupContent = <M>(
	h: HtmlBuilder<M>,
	model: Model,
	itemContext: Omit<ItemContext, "presenceByUser" | "nowMs" | "currentUserId"> & {
		readonly activeChannelId: string | undefined
		readonly onActiveMount: Attribute<M>
		readonly onDismissCreateChannelHint: Attribute<M>
	},
): Html[] => {
	const context: SectionsContext<M> = {
		...itemContext,
		currentUserId: model.currentUserId,
		nowMs: model.nowMs,
		presenceByUser: new Map(model.presence.map((presence) => [presence.userId, presence])),
		unreadByChannel: new Map(model.unreadCounts.map((unread) => [unread.channelId, unread.count])),
		partnersByChannel: partnerOrgsByChannel(
			model.connectMounts,
			model.organizations,
			model.organizationId,
		),
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
							hasMenu: canCreateChannel,
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
								hasMenu: true,
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
							hasMenu: false,
						}),
						allowsDragging: false,
						rows: rowsOf(
							h,
							context,
							"sidebar-tree-dms",
							false,
							model.dmChannelIds.flatMap((channelId) =>
								dmRow(h, model.dmChannels[channelId], context),
							),
						),
					}),
				]),
	]
}
