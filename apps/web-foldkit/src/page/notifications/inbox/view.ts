import { ChannelId } from "@hazel/schema"
import { Match, Option, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconCheck, IconHashtag, IconMsgs, IconSupport, IconThread } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { avatar } from "../../../ui/avatar"
import { button, iconButton } from "../../../ui/button"
import { card } from "../../../ui/card"
import { countBadge } from "../../../ui/count-badge"
import { emptyState } from "../../../ui/empty-state"
import { heading } from "../../../ui/heading"
import { iconTile } from "../../../ui/icon-tile"
import { loadingState } from "../../../ui/loader"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { statusDot } from "../../../ui/status-dot"
import type { PageViewInputs } from "../../contract"
import { activityIsland, activityIslandView, isActivityIslandEnabled } from "../../../islands/activity"
import { OrganizationMemberId } from "@hazel/schema"
import { formatDistanceToNow } from "~/lib/format-distance"
import {
	contextOf,
	groupByTime,
	isSupportAlert,
	notificationsOfTab,
	previewOf,
	supportAlertOf,
	unreadChannelDetail,
	unreadChannelTitle,
	visibleUnreadChannels,
} from "./format"
import { Message } from "./message"
import type { Model, NotificationItem, Tab, UnreadChannelItem } from "./model"

/** Discord's inbox: Mentions, Unreads and All, each row with a "Mark as read" action. */

const COPY: Record<
	Tab,
	{ heading: string; subheading: string; emptyTitle: string; emptyDescription: string }
> = {
	mentions: {
		heading: "Mentions",
		subheading: "Mentions, replies and direct messages for you.",
		emptyTitle: "No mentions",
		emptyDescription: "You're all caught up! Mentions, replies and direct messages will appear here.",
	},
	unreads: {
		heading: "Unreads",
		subheading: "Channels with messages you haven't read.",
		emptyTitle: "No unread channels",
		emptyDescription: "You're all caught up! Channels with new messages will appear here.",
	},
	all: {
		heading: "All activity",
		subheading: "Stay updated on messages and activity in your channels.",
		emptyTitle: "No notifications",
		emptyDescription: "You're all caught up! Notifications about messages and activity will appear here.",
	},
}

const ROW_CLASS =
	"group flex items-center transition-colors hover:bg-secondary/50 focus-within:bg-secondary/50"

/**
 * Shown on hover or focus (always on a phone, which has no hover). Named after its row, so a
 * screen reader tells the rows' buttons apart.
 */
const rowAction = (h: HtmlBuilder<Message>, onPress: Message, what: string): Html =>
	iconButton(
		h,
		{
			label: `Mark as read: ${what}`,
			size: "sq-xs",
			className:
				"mr-3 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100",
			onPress,
		},
		IconCheck(h),
	)

const leadingVisual = (h: HtmlBuilder<Message>, item: NotificationItem): Html => {
	if (isSupportAlert(item))
		return iconTile(
			h,
			{ intent: supportAlertOf(item).isWarning ? "warning" : "danger", size: "md" },
			IconSupport(h),
		)
	if (item.author !== null) {
		const fullName = `${item.author.firstName} ${item.author.lastName}`
		return avatar(h, { size: "md", src: item.author.avatarUrl, alt: fullName, seed: fullName })
	}
	const isChannel = item.channel?.type === "public" || item.channel?.type === "private"
	return iconTile(h, { size: "md" }, (isChannel ? IconHashtag : IconMsgs)(h))
}

const decodeChannelId = Schema.decodeUnknownOption(ChannelId)

/** `NotificationItem` (`components/notifications/notification-item.tsx`), with its "Mark as read". */
const notificationItem = (
	h: HtmlBuilder<Message>,
	item: NotificationItem,
	orgSlug: string | null,
	nowMs: number,
): Html => {
	const hasValidTarget = item.targetedResourceId !== null && item.targetedResourceType === "channel"
	const clicked = Message.ClickedNotification({ id: item.id })
	const isButton = !hasValidTarget && item.isUnread
	const contentClass = twMerge(
		"flex min-w-0 flex-1 items-start gap-3 px-4 py-3 outline-hidden",
		(hasValidTarget || item.isUnread) && "cursor-pointer",
		!hasValidTarget && !item.isUnread && "cursor-default",
	)
	const children = [
		h.div(
			[h.Class("flex h-10 w-2 shrink-0 items-center justify-center")],
			item.isUnread
				? [
						statusDot(h, { tone: "primary", className: "size-2" }),
						h.span([h.Class("sr-only")], ["Unread:"]),
					]
				: [],
		),
		h.div([h.Class("shrink-0")], [leadingVisual(h, item)]),
		h.div(
			[h.Class("min-w-0 flex-1")],
			[
				h.div(
					[h.Class("flex items-start justify-between gap-2")],
					[
						h.p(
							[
								h.Class(
									twMerge(
										"line-clamp-2 min-w-0 text-sm wrap-anywhere",
										item.isUnread ? "font-medium text-fg" : "text-fg",
									),
								),
							],
							[previewOf(item)],
						),
						h.span(
							[h.Class("shrink-0 text-muted-fg text-xs")],
							[formatDistanceToNow(item.createdAtMs, nowMs)],
						),
					],
				),
				h.p([h.Class("mt-0.5 truncate text-muted-fg text-xs")], [contextOf(item)]),
			],
		),
	]
	const href =
		hasValidTarget && orgSlug
			? Option.getOrNull(
					Option.map(decodeChannelId(item.targetedResourceId), (channelId) =>
						hrefOf(AppRoute.ChatChannel({ orgSlug, channelId })),
					),
				)
			: null
	const content =
		href !== null
			? h.a([h.Class(contentClass), h.Href(href), h.OnClick(clicked)], children)
			: h.div(
					[
						h.Class(contentClass),
						...(hasValidTarget ? [] : [h.OnClick(clicked)]),
						...(isButton
							? [
									h.Role("button"),
									h.Tabindex(0),
									h.OnKeyDownPreventDefault((key) =>
										key === "Enter" || key === " " ? Option.some(clicked) : Option.none(),
									),
								]
							: []),
					],
					children,
				)
	return h.keyed("div")(
		item.id,
		[h.Class(ROW_CLASS)],
		[
			content,
			...(item.isUnread
				? [rowAction(h, Message.ClickedMarkNotificationRead({ id: item.id }), contextOf(item))]
				: []),
		],
	)
}

const emptyOf = (h: HtmlBuilder<Message>, tab: Tab): Html =>
	emptyState(h, {
		icon: (className) => IconBell(h, { className }),
		title: COPY[tab].emptyTitle,
		description: COPY[tab].emptyDescription,
	})

/** `NotificationList` (`components/notifications/notification-list.tsx`), for Mentions and All. */
const notificationList = (
	h: HtmlBuilder<Message>,
	model: Model,
	tab: Exclude<Tab, "unreads">,
	orgSlug: string | null,
	nowMs: number,
): Html => {
	if (model.notifications._tag === "Loading") {
		return loadingState(h, { className: "h-full py-16" })
	}
	const listed = notificationsOfTab(model.notifications.items, tab)
	if (listed.length === 0) return emptyOf(h, tab)
	return h.div(
		[h.Class("flex flex-col gap-6")],
		groupByTime(listed, nowMs).map((group) =>
			h.keyed("div")(
				group.label,
				[],
				[
					h.div(
						[h.Class("sticky top-0 z-10 bg-bg/95 backdrop-blur-sm px-4 py-2")],
						[heading(h, { variant: "label", level: 2 }, [group.label])],
					),
					card(h, {}, [
						h.div(
							[h.Class("divide-y divide-border")],
							group.notifications.map((item) => notificationItem(h, item, orgSlug, nowMs)),
						),
					]),
				],
			),
		),
	)
}

/** `hazel:island:activity`: the shared Activity list (`islands/activity.ts`) in place of the one above. */
const MountActivityIsland = Mount.defineStream("MountActivityIsland", {
	args: { memberId: OrganizationMemberId, orgSlug: Schema.String },
	messages: [Message.RequestedIslandNavigation],
	execute: ({ element, memberId, orgSlug }) =>
		activityIsland(element, { memberId, orgSlug }).pipe(
			Stream.map((channelId) => Message.RequestedIslandNavigation({ orgSlug, channelId })),
		),
})

const channelVisual = (h: HtmlBuilder<Message>, channel: UnreadChannelItem): Html =>
	iconTile(
		h,
		{ size: "md" },
		Match.value(channel.type).pipe(
			Match.when("thread", () => IconThread(h)),
			Match.whenOr("public", "private", () => IconHashtag(h)),
			Match.orElse(() => IconMsgs(h)),
		),
	)

/** An Unreads row: the channel, how much there is, and when; it opens the channel. */
const unreadChannelRow = (
	h: HtmlBuilder<Message>,
	channel: UnreadChannelItem,
	orgSlug: string | null,
	nowMs: number,
): Html => {
	const children = [
		h.div(
			[h.Class("flex h-10 w-2 shrink-0 items-center justify-center")],
			[
				statusDot(h, { tone: "primary", className: "size-2" }),
				h.span([h.Class("sr-only")], ["Unread:"]),
			],
		),
		h.div([h.Class("shrink-0")], [channelVisual(h, channel)]),
		h.div(
			[h.Class("min-w-0 flex-1")],
			[
				h.div(
					[h.Class("flex items-center justify-between gap-2")],
					[
						h.p([h.Class("truncate font-medium text-fg text-sm")], [unreadChannelTitle(channel)]),
						h.span(
							[h.Class("shrink-0 text-muted-fg text-xs")],
							[formatDistanceToNow(channel.lastMessageAtMs, nowMs)],
						),
					],
				),
				h.p([h.Class("mt-0.5 text-muted-fg text-xs")], [unreadChannelDetail(channel)]),
			],
		),
		...(channel.mentionCount > 0
			? [
					countBadge(h, {
						count: channel.mentionCount,
						isCapped: true,
						attributes: [h.AriaHidden(true)],
					}),
				]
			: []),
	]
	const contentClass = "flex min-w-0 flex-1 items-start gap-3 px-4 py-3 outline-hidden"
	return h.keyed("div")(
		channel.channelId,
		[h.Class(ROW_CLASS)],
		[
			orgSlug === null
				? h.div([h.Class(contentClass)], children)
				: h.a(
						[
							h.Class(twMerge(contentClass, "cursor-pointer")),
							h.Href(hrefOf(AppRoute.ChatChannel({ orgSlug, channelId: channel.channelId }))),
						],
						children,
					),
			rowAction(
				h,
				Message.ClickedMarkChannelRead({ channelId: channel.channelId }),
				unreadChannelTitle(channel),
			),
		],
	)
}

const visibleChannelsOf = (model: Model, nowMs: number) =>
	model.unreadChannels._tag === "Loaded"
		? visibleUnreadChannels(model.unreadChannels.channels, model.markedRead, nowMs)
		: []

const markAllReadButton = (h: HtmlBuilder<Message>, model: Model): Html =>
	button(
		h,
		{
			intent: "outline",
			size: "sm",
			isPending: model.isMarkingAllRead,
			onPress: Message.ClickedMarkAllChannelsRead(),
		},
		[IconCheck(h), "Mark all as read"],
	)

/** The Unreads tab: unread channels, newest first. */
const unreadList = (h: HtmlBuilder<Message>, model: Model, orgSlug: string | null, nowMs: number): Html => {
	if (model.unreadChannels._tag === "Loading") return loadingState(h, { className: "h-full py-16" })
	const channels = visibleChannelsOf(model, nowMs)
	if (channels.length === 0) return emptyOf(h, "unreads")
	return h.div(
		[h.Class("flex flex-col gap-3")],
		[
			// On a phone the page header (and its action) is hidden.
			h.div([h.Class("flex justify-end md:hidden")], [markAllReadButton(h, model)]),
			card(h, {}, [
				h.div(
					[h.Class("divide-y divide-border")],
					channels.map((channel) => unreadChannelRow(h, channel, orgSlug, nowMs)),
				),
			]),
		],
	)
}

export const inboxView = (model: Model, { shared }: PageViewInputs, h: HtmlBuilder<Message>): Html => {
	const copy = COPY[model.tab]
	const hasUnreads = model.tab === "unreads" && visibleChannelsOf(model, shared.nowMs).length > 0
	return pageLayout(h, {}, [
		// On a phone the top bar names the inbox (`shell/mobile.ts`).
		pageHeader(h, {
			title: copy.heading,
			subtitle: copy.subheading,
			className: "max-md:hidden",
			actions: hasUnreads ? [markAllReadButton(h, model)] : [],
		}),
		Match.value(model.tab).pipe(
			Match.when("unreads", () => unreadList(h, model, shared.orgSlug, shared.nowMs)),
			Match.whenOr("mentions", "all", (tab) =>
				isActivityIslandEnabled && shared.member !== null && shared.orgSlug !== null
					? activityIslandView(h, {
							memberId: shared.member.id,
							tab,
							onMount: h.OnMount(
								MountActivityIsland({ memberId: shared.member.id, orgSlug: shared.orgSlug }),
							),
						})
					: notificationList(h, model, tab, shared.orgSlug, shared.nowMs),
			),
			Match.exhaustive,
		),
	])
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>(inboxView)
