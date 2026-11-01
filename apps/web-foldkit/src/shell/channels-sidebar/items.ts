import type { ChannelId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { styles as avatarStyles } from "~/components/ui/avatar/styles"
import { cx } from "~/utils/cx"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusDotColor } from "~/utils/status"
import { IconHashtag } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { sidebarItem, sidebarLink } from "../../ui/sidebar"
import type {
	ChannelEntry,
	DiscoverableChannel,
	DmChannel,
	DmMember,
	PartnerOrg,
	Presence,
	SidebarThread,
} from "./rows"
import { dotsMenuTrigger } from "./tree"

/** `ChannelItem`, `DmChannelItem` and `DiscoverableChannelItem` (`components/sidebar/*`). */

export const CHANNEL_ACTIVE = "bg-wash-strong faux-medium text-fg **:data-[slot=icon]:text-fg-3"

export interface ItemContext {
	readonly orgSlug: string
	/** The channel the route shows (its chat or its files), whose link is active. */
	readonly activeChannelId: ChannelId | null
	readonly currentUserId: string | null
	readonly nowMs: number
	readonly presenceByUser: ReadonlyMap<string, Presence>
}

const chatHref = (context: { readonly orgSlug: string }, channelId: ChannelId) =>
	hrefOf(AppRoute.ChatChannel({ orgSlug: context.orgSlug, channelId }))

/** What one memoized row reads instead of the whole `ItemContext`. */
export interface RowLinkContext {
	readonly orgSlug: string
	readonly isActive: boolean
}

/** `SidebarLabel` with a `className`. */
export const label = <M>(h: HtmlBuilder<M>, children: Array<Html | string>, className?: string): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"col-start-2 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis outline-hidden",
					className,
				),
			),
			h.Attribute("data-slot", "sidebar-label"),
			h.Attribute("tabindex", "-1"),
			h.Attribute("slot", "label"),
		],
		children,
	)

/** `SidebarItem`'s expanded unread badge. */
const sidebarBadge = <M>(h: HtmlBuilder<M>, count: number): Html =>
	h.span(
		[
			h.Attribute("data-slot", "sidebar-badge"),
			h.Class(
				"absolute inset-y-1/2 right-1.5 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-[11px] text-primary-fg tabular-nums group-hover/sidebar-item:right-8",
			),
		],
		[String(count)],
	)

const badgeIf = <M>(h: HtmlBuilder<M>, count: number): Html[] => (count > 0 ? [sidebarBadge(h, count)] : [])

/** `components/channel-icon.tsx`. */
const channelIcon = <M>(h: HtmlBuilder<M>, icon: string | null): Html =>
	icon ? h.span([h.Attribute("data-slot", "icon")], [icon]) : IconHashtag(h)

const partnerOrgMarks = <M>(h: HtmlBuilder<M>, partners: ReadonlyArray<PartnerOrg>): Html[] => {
	const first = partners[0]
	if (!first) return []
	return [
		h.span(
			[h.Class("absolute -right-1 -bottom-0.5 flex items-end -space-x-0.5")],
			[
				first.logoUrl
					? h.img([
							h.Attribute("src", first.logoUrl),
							h.Attribute("alt", ""),
							h.Class("size-2.5 rounded-sm object-cover ring-[1.5px] ring-sidebar"),
						])
					: h.span(
							[
								h.Class(
									"flex size-2.5 items-center justify-center rounded-sm bg-muted text-[6px] font-semibold ring-[1.5px] ring-sidebar",
								),
							],
							[first.name[0] ?? ""],
						),
				...(partners.length > 1
					? [
							h.span(
								[
									h.Class(
										"flex h-2.5 items-center rounded-sm bg-muted px-0.5 text-[7px] font-semibold leading-none ring-[1.5px] ring-sidebar",
									),
								],
								[`+${partners.length - 1}`],
							),
						]
					: []),
			],
		),
	]
}

export const channelItem = <M>(
	h: HtmlBuilder<M>,
	entry: ChannelEntry,
	notificationCount: number,
	partners: ReadonlyArray<PartnerOrg>,
	context: RowLinkContext,
	menu: Html = dotsMenuTrigger(h, "Channel options"),
): Html => {
	const href = chatHref(context, entry.channel.id)
	return sidebarItem(h, {}, [
		sidebarLink(h, { href, isActive: context.isActive, activeClassName: CHANNEL_ACTIVE }, [
			h.span(
				// Positioned only for the partner marks: needless positioned spans slow every hit test.
				[h.Class(partners.length > 0 ? "relative shrink-0" : "shrink-0")],
				[channelIcon(h, entry.channel.icon), ...partnerOrgMarks(h, partners)],
			),
			// Unread: the name steps up to full ink and medium, the count says how many.
			label(h, [entry.channel.name], notificationCount > 0 ? "font-medium text-fg" : undefined),
		]),
		menu,
		...badgeIf(h, notificationCount),
	])
}

/** One joined thread under its channel, on a branch of the spine that runs down from the channel. */
const threadItem = <M>(
	h: HtmlBuilder<M>,
	thread: SidebarThread,
	isActive: boolean,
	isLast: boolean,
	orgSlug: string,
): Html => {
	const count = thread.notificationCount
	return h.a(
		[
			h.Href(chatHref({ orgSlug }, thread.id)),
			h.Attribute("data-react-aria-pressable", "true"),
			...(isActive ? [h.Attribute("aria-current", "page"), h.Attribute("data-current", "true")] : []),
			h.Class(
				cx(
					"relative ml-[26px] flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-fg-3 text-sm/5",
					"outline-hidden hover:bg-wash hover:text-fg focus-visible:bg-wash",
					"before:pointer-events-none before:absolute before:top-0 before:-left-[11px] before:h-1/2 before:w-2",
					"before:rounded-bl-md before:border-fg/15 before:border-b-[1.5px] before:border-l-[1.5px]",
					!isLast &&
						"after:pointer-events-none after:absolute after:top-1/2 after:bottom-0 after:-left-[11px] after:border-fg/15 after:border-l-[1.5px]",
					isActive && CHANNEL_ACTIVE,
					count > 0 && "font-medium text-fg",
				),
			),
		],
		[
			h.span([h.Class("min-w-0 flex-1 truncate")], [thread.name]),
			count > 0
				? h.span(
						[
							h.Class(
								"flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-[11px] text-primary-fg tabular-nums",
							),
						],
						[String(count)],
					)
				: h.empty,
		],
	)
}

/** The channel's joined threads, below its row. */
export const threadItems = <M>(
	h: HtmlBuilder<M>,
	threads: ReadonlyArray<SidebarThread>,
	activeThreadId: ChannelId | null,
	orgSlug: string,
): Html =>
	threads.length === 0
		? h.empty
		: h.div(
				[h.Class("col-span-full flex min-w-0 flex-col"), h.Attribute("aria-label", "Threads")],
				threads.map((thread, index) =>
					threadItem(
						h,
						thread,
						thread.id === activeThreadId,
						index === threads.length - 1,
						orgSlug,
					),
				),
			)

export const discoverableItem = <M>(
	h: HtmlBuilder<M>,
	channel: DiscoverableChannel,
	context: ItemContext,
): Html => {
	const href = chatHref(context, channel.id)
	return sidebarItem(h, { className: "opacity-50 hover:opacity-100 [&:has(.active)]:opacity-100" }, [
		sidebarLink(
			h,
			{
				href,
				isActive: context.activeChannelId === channel.id,
				activeClassName: `active ${CHANNEL_ACTIVE}`,
			},
			[channelIcon(h, channel.icon), label(h, [channel.name])],
		),
	])
}

/** The DM members other than the signed-in user. */
export const dmPartners = (channel: DmChannel, currentUserId: string | null): ReadonlyArray<DmMember> =>
	channel.members.filter((member) => member.userId !== currentUserId)

/** `DmChannelItem`'s `tooltipName`, also the tree row's text value. */
export const dmDisplayName = (channel: DmChannel, partners: ReadonlyArray<DmMember>): string => {
	const only = partners[0]
	return channel.type === "single" && partners.length === 1 && only
		? `${only.firstName} ${only.lastName}`
		: partners.map((member) => member.firstName).join(", ")
}

/** `AvatarOnlineIndicator` at size xs. */
const statusDot = <M>(h: HtmlBuilder<M>, status: string): Html =>
	h.span([
		h.Class(
			cx(
				"absolute right-0 bottom-0 rounded-full ring-[1.5px] ring-bg",
				getStatusDotColor(status),
				"size-1.5",
			),
		),
	])

/** `DmUserStatusEmoji` (a tooltip trigger when the user set an emoji). */
const statusEmoji = <M>(h: HtmlBuilder<M>, presence: Presence | undefined): Html[] =>
	presence?.statusEmoji
		? [
				h.button(
					[
						h.Class(
							twMerge(
								"cursor-default border-none bg-transparent p-0 text-sm",
								"ml-1 text-xs opacity-80",
							),
						),
						h.Attribute("type", "button"),
						h.Attribute("tabindex", "0"),
						h.Attribute("data-react-aria-pressable", "true"),
					],
					[presence.statusEmoji],
				),
			]
		: []

const singleDmContent = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel,
	partner: DmMember,
	context: DmRowContext,
) => {
	const fullName = `${partner.firstName} ${partner.lastName}`
	const presence = context.presence
	const status = getEffectivePresenceStatus(
		presence
			? {
					status: presence.status,
					lastSeenAt: presence.lastSeenMs === null ? null : new Date(presence.lastSeenMs),
				}
			: null,
		context.nowMs,
	)
	return [
		avatar(h, {
			size: "xs",
			src: partner.avatarUrl,
			alt: fullName,
			seed: fullName,
			badge: statusDot(h, status),
		}),
		label(
			h,
			[h.span([h.Class("truncate")], [fullName]), ...statusEmoji(h, presence)],
			cx("flex items-center max-w-40", channel.currentUser.isMuted && "opacity-60"),
		),
	]
}

/** The "+N" avatar: an `Avatar` with only a `placeholder`. */
const overflowAvatar = <M>(h: HtmlBuilder<M>, count: number): Html =>
	h.div(
		[
			h.Attribute("data-avatar", "true"),
			h.Attribute("data-slot", "avatar"),
			h.Class(
				cx(
					"relative inline-flex shrink-0 items-center justify-center overflow-visible bg-muted outline-transparent",
					"rounded-xl",
					avatarStyles.xs.root,
					"ring-[1.5px] ring-sidebar",
				),
			),
			h.Attribute("style", "corner-shape: squircle;"),
		],
		[
			h.span(
				[h.Class("flex items-center justify-center font-semibold text-quaternary text-sm")],
				[`+${count}`],
			),
		],
	)

const groupDmContent = <M>(h: HtmlBuilder<M>, channel: DmChannel, partners: ReadonlyArray<DmMember>) => [
	h.div(
		[h.Attribute("data-slot", "avatar"), h.Class("flex -space-x-2")],
		[
			...partners.slice(0, 2).map((member) =>
				avatar(h, {
					size: "xs",
					src: member.avatarUrl,
					alt: member.firstName[0],
					seed: `${member.firstName} ${member.lastName}`,
					className: "ring-[1.5px] ring-sidebar",
				}),
			),
			...(partners.length > 2 ? [overflowAvatar(h, partners.length - 2)] : []),
		],
	),
	label(
		h,
		[partners.map((member) => member.firstName).join(", ")],
		cx("max-w-40 truncate", channel.currentUser.isMuted && "opacity-60"),
	),
]

/** A DM row's inputs: the single partner's presence is looked up before the row's memo. */
export interface DmRowContext extends RowLinkContext {
	readonly currentUserId: string | null
	readonly nowMs: number
	readonly presence: Presence | undefined
}

export const dmItem = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel,
	notificationCount: number,
	context: DmRowContext,
): Html => {
	const href = chatHref(context, channel.id)
	const partners = dmPartners(channel, context.currentUserId)
	const only = partners[0]
	return sidebarItem(h, {}, [
		sidebarLink(
			h,
			{ href, isActive: context.isActive, activeClassName: CHANNEL_ACTIVE },
			channel.type === "single" && partners.length === 1 && only
				? singleDmContent(h, channel, only, context)
				: groupDmContent(h, channel, partners),
		),
		dotsMenuTrigger(h, "Conversation options"),
		...badgeIf(h, notificationCount),
	])
}
