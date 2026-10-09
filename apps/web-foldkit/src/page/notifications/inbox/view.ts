import { ChannelId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { IconBell, IconHashtag, IconMsgs } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { avatar } from "../../../ui/avatar"
import { emptyState } from "../../../ui/empty-state"
import { loader } from "../../../ui/loader"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../../ui/section-header"
import type { PageViewInputs } from "../../contract"
import { contextOf, filterByCategory, formatDistanceToNow, groupByTime, previewOf } from "./format"
import { Message } from "./message"
import type { Category, Model, NotificationItem } from "./model"

/** Ports of `routes/_app/$orgSlug/notifications/{index,general,threads,dms}.tsx` and `NotificationList`. */

const COPY: Record<
	Category,
	{ heading: string; subheading: string; emptyTitle: string; emptyDescription: string }
> = {
	all: {
		heading: "All Activity",
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
		heading: "Direct Messages",
		subheading: "Notifications from your direct message conversations.",
		emptyTitle: "No DM notifications",
		emptyDescription: "Notifications from direct messages will appear here.",
	},
}

const leadingVisual = (h: HtmlBuilder<Message>, item: NotificationItem): Html => {
	if (item.author !== null) {
		const fullName = `${item.author.firstName} ${item.author.lastName}`
		return avatar(h, { size: "md", src: item.author.avatarUrl, alt: fullName, seed: fullName })
	}
	const isChannel = item.channel?.type === "public" || item.channel?.type === "private"
	return h.div(
		[h.Class("flex size-10 items-center justify-center rounded-lg bg-secondary")],
		[(isChannel ? IconHashtag : IconMsgs)(h, { className: "size-5 text-muted-fg" })],
	)
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
			item.isUnread ? [h.div([h.Class("size-2 rounded-full bg-primary")])] : [],
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
	if (model.notifications === null) {
		return h.div(
			[h.Class("flex h-full items-center justify-center py-16")],
			[loader(h, { className: "size-8" })],
		)
	}
	const filtered = filterByCategory(model.notifications, model.category)
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
						[
							h.h2(
								[h.Class("text-xs font-semibold uppercase tracking-wider text-muted-fg")],
								[group.label],
							),
						],
					),
					h.div(
						[h.Class("overflow-hidden rounded-xl border border-border bg-bg shadow-sm")],
						[
							h.div(
								[h.Class("divide-y divide-border")],
								group.notifications.map((item) => notificationItem(h, item, orgSlug, nowMs)),
							),
						],
					),
				],
			),
		),
	)
}

export const inboxView = (model: Model, { shared }: PageViewInputs, h: HtmlBuilder<Message>): Html => {
	const copy = COPY[model.category]
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			sectionHeaderRoot(h, { className: "border-none pb-0" }, [
				sectionHeaderGroup(h, {}, [
					h.div(
						[h.Class("space-y-0.5")],
						[
							sectionHeaderHeading(h, { size: "xl" }, [copy.heading]),
							sectionHeaderSubheading(h, {}, [copy.subheading]),
						],
					),
				]),
			]),
			notificationList(h, model, shared.orgSlug, shared.nowMs),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>(inboxView)
