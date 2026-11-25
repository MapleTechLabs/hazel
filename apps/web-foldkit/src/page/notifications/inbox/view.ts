import { ChannelId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconHashtag, IconMsgs, IconSupport } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { avatar } from "../../../ui/avatar"
import { card } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import { heading } from "../../../ui/heading"
import { iconTile } from "../../../ui/icon-tile"
import { loadingState } from "../../../ui/loader"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { statusDot } from "../../../ui/status-dot"
import type { PageViewInputs } from "../../contract"
import { formatDistanceToNow } from "~/lib/format-distance"
import { contextOf, filterByCategory, groupByTime, isSupportAlert, previewOf, supportAlertOf } from "./format"
import { Message } from "./message"
import type { Category, Model, NotificationItem } from "./model"

/** Ports of `routes/_app/$orgSlug/notifications/{index,general,threads,dms}.tsx` and `NotificationList`. */

const COPY: Record<
	Category,
	{ heading: string; subheading: string; emptyTitle: string; emptyDescription: string }
> = {
	all: {
		heading: "All activity",
		subheading: "Stay updated on messages and activity in your channels.",
		emptyTitle: "No notifications",
		emptyDescription: "You're all caught up! Notifications about messages and activity will appear here.",
	},
	general: {
		heading: "Channels",
		subheading: "Notifications from public and private channels.",
		emptyTitle: "No channel notifications",
		emptyDescription: "Notifications from channels will appear here.",
	},
	threads: {
		heading: "Threads",
		subheading: "Notifications from thread conversations.",
		emptyTitle: "No thread notifications",
		emptyDescription: "Notifications from thread conversations will appear here.",
	},
	dms: {
		heading: "Direct messages",
		subheading: "Notifications from your direct message conversations.",
		emptyTitle: "No DM notifications",
		emptyDescription: "Notifications from direct messages will appear here.",
	},
}

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

/** `NotificationItem` (`components/notifications/notification-item.tsx`). */
const notificationItem = (
	h: HtmlBuilder<Message>,
	item: NotificationItem,
	orgSlug: string | null,
	nowMs: number,
): Html => {
	const hasValidTarget = item.targetedResourceId !== null && item.targetedResourceType === "channel"
	const clicked = Message.ClickedNotification({ id: item.id })
	const isButton = !hasValidTarget && item.isUnread
	const attributes = [
		h.Class(
			twMerge(
				"group flex items-start gap-3 px-4 py-3 transition-colors",
				hasValidTarget && "cursor-pointer hover:bg-secondary/50",
				!hasValidTarget && item.isUnread && "cursor-pointer hover:bg-secondary/50",
				!hasValidTarget && !item.isUnread && "cursor-default",
			),
		),
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
	]
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
										"line-clamp-2 text-sm",
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
				h.p([h.Class("mt-0.5 text-muted-fg text-xs")], [contextOf(item)]),
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
	return href !== null
		? h.keyed("a")(
				item.id,
				[h.Class("block"), h.Href(href), h.OnClick(clicked)],
				[h.div(attributes, children)],
			)
		: h.keyed("div")(item.id, attributes, children)
}

/** `NotificationList` (`components/notifications/notification-list.tsx`). */
const notificationList = (
	h: HtmlBuilder<Message>,
	model: Model,
	orgSlug: string | null,
	nowMs: number,
): Html => {
	const copy = COPY[model.category]
	if (model.notifications._tag === "Loading") {
		return loadingState(h, { className: "h-full py-16" })
	}
	const filtered = filterByCategory(model.notifications.items, model.category)
	if (filtered.length === 0) {
		return emptyState(h, {
			icon: (className) => IconBell(h, { className }),
			title: copy.emptyTitle,
			description: copy.emptyDescription,
		})
	}
	return h.div(
		[h.Class("flex flex-col gap-6")],
		groupByTime(filtered, nowMs).map((group) =>
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

export const inboxView = (model: Model, { shared }: PageViewInputs, h: HtmlBuilder<Message>): Html => {
	const copy = COPY[model.category]
	return pageLayout(h, {}, [
		// On a phone the top bar names the inbox (`shell/mobile.ts`).
		pageHeader(h, { title: copy.heading, subtitle: copy.subheading, className: "max-md:hidden" }),
		notificationList(h, model, shared.orgSlug, shared.nowMs),
	])
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>(inboxView)
