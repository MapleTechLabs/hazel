import type { ChannelId } from "@hazel/schema"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { cx } from "~/utils/cx"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusDotColor } from "~/utils/status"
import { IconHashtag } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { styles as avatarStyles } from "../../ui/avatar-styles"
import { sidebarItem, sidebarLink } from "../../ui/sidebar"
import type { ChannelEntry, DiscoverableChannel, DmChannel, DmMember, PartnerOrg, Presence } from "./rows"
import { dotsMenuTrigger } from "./tree"

/** `ChannelItem`, `DmChannelItem` and `DiscoverableChannelItem` (`components/sidebar/*`). */

export const CHANNEL_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

export interface ItemContext {
	readonly orgSlug: string
	readonly pathname: string
	readonly currentUserId: string | null
	readonly nowMs: number
	readonly presenceByUser: ReadonlyMap<string, Presence>
}

/** TanStack's default (non-exact) active match. */
const isActiveFuzzy = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`)

const chatHref = (context: ItemContext, channelId: ChannelId) =>
	hrefOf(AppRoute.ChatChannel({ orgSlug: context.orgSlug, channelId }))

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
				"absolute inset-y-1/2 right-1.5 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary px-1.5 font-semibold text-[11px] text-primary-fg tabular-nums transition-all group-hover/sidebar-item:right-8",
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
	context: ItemContext,
	menu: Html = dotsMenuTrigger(h),
): Html => {
	const href = chatHref(context, entry.channel.id)
	return sidebarItem(h, {}, [
		sidebarLink(
			h,
			{ href, isActive: isActiveFuzzy(context.pathname, href), activeClassName: CHANNEL_ACTIVE },
			[
				h.span(
					[h.Class("relative shrink-0")],
					[channelIcon(h, entry.channel.icon), ...partnerOrgMarks(h, partners)],
				),
				label(h, [entry.channel.name]),
			],
		),
		menu,
		...badgeIf(h, notificationCount),
	])
}

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
				isActive: isActiveFuzzy(context.pathname, href),
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
	h.span(
		[
			h.Class(
				cx(
					"absolute right-0 bottom-0 rounded-full ring-[1.5px] ring-bg",
					getStatusDotColor(status),
					"size-1.5",
				),
			),
		],
		[],
	)

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
						h.Attribute("data-rac", ""),
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
	context: ItemContext,
) => {
	const fullName = `${partner.firstName} ${partner.lastName}`
	const presence = context.presenceByUser.get(partner.userId)
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

export const dmItem = <M>(
	h: HtmlBuilder<M>,
	channel: DmChannel,
	notificationCount: number,
	context: ItemContext,
): Html => {
	const href = chatHref(context, channel.id)
	const partners = dmPartners(channel, context.currentUserId)
	const only = partners[0]
	return sidebarItem(h, {}, [
		sidebarLink(
			h,
			{ href, isActive: isActiveFuzzy(context.pathname, href), activeClassName: CHANNEL_ACTIVE },
			channel.type === "single" && partners.length === 1 && only
				? singleDmContent(h, channel, only, context)
				: groupDmContent(h, channel, partners),
		),
		dotsMenuTrigger(h),
		...badgeIf(h, notificationCount),
	])
}
