// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The inbox's notification list (Mentions and All, `web-foldkit/src/page/notifications/inbox`) as a
 * shared `hazel` screen over `@hazel/client-data`. The host provides `ClientData`, `HazelRpc` (the
 * mark-read RPC) and `RequestActivityNavigation`; the tab comes in as props, then as `ChangedTab`.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, NotificationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Clock, Duration, Effect, Layer, Match, Schedule, Schema, Stream } from "effect"
import {
	contextOf,
	formatDistanceToNow,
	groupByTime,
	initialsOf,
	isDirect,
	isSupportAlert,
	itemsOfTab,
	mentionedUserIds,
	previewOf,
	type Tab,
} from "./format"

export const ActivityTab = Schema.Literals(["mentions", "all"])

export const ActivityItem = Schema.Struct({
	id: NotificationId,
	isUnread: Schema.Boolean,
	createdAtMs: Schema.Finite,
	resourceType: Schema.NullOr(Schema.String),
	reason: Schema.NullOr(Schema.String),
	targetedResourceId: Schema.NullOr(Schema.String),
	targetedResourceType: Schema.NullOr(Schema.String),
	messageContent: Schema.NullOr(Schema.String),
	mentionNames: Schema.Record(Schema.String, Schema.String),
	channel: Schema.NullOr(Schema.Struct({ name: Schema.String, type: Schema.String })),
	author: Schema.NullOr(
		Schema.Struct({
			firstName: Schema.String,
			lastName: Schema.String,
			avatarUrl: Schema.NullOr(Schema.String),
		}),
	),
})
export type ActivityItem = typeof ActivityItem.Type

export const ActivityMessage = UiSchema.TaggedEnum({
	UpdatedNotifications: { items: Schema.Array(ActivityItem) },
	ChangedTab: { tab: ActivityTab },
	Ticked: { nowMs: Schema.Finite },
	/** The row: opens its channel, and an unread notification is marked read on the way. */
	PressedNotification: { id: NotificationId },
	/** The row's "Mark as read" button. */
	PressedMarkRead: { id: NotificationId },
	SucceededMarkRead: { id: NotificationId },
	/** `NotFound`: the notification is gone, so there is nothing to say. */
	FailedMarkRead: { id: NotificationId, reason: Schema.Literals(["NotFound", "Other"]) },
	DismissedError: {},
	CompletedRequestNavigation: {},
})
export type ActivityMessage = typeof ActivityMessage.Type

export const ActivityProps = Schema.Struct({
	memberId: OrganizationMemberId,
	orgSlug: Schema.String,
	tab: ActivityTab,
	nowMs: Schema.Finite,
	/** The host draws no page header of its own (iOS): the screen shows its title bar. */
	titled: Schema.Boolean,
})
export type ActivityProps = typeof ActivityProps.Type

export const ActivityModel = Schema.Struct({
	tab: ActivityTab,
	nowMs: Schema.Finite,
	/** Null until the live query first emits. */
	items: Schema.NullOr(Schema.Array(ActivityItem)),
	showError: Schema.Boolean,
})
export type ActivityModel = typeof ActivityModel.Type

/** Asks the host to open a channel; the host owns routing. */
export class RequestActivityNavigation extends Command.Service<RequestActivityNavigation>()(
	"hazel/activity/RequestNavigation",
	{ args: { channelId: ChannelId }, success: ActivityMessage },
) {
	static readonly layerWith = (navigate: (channelId: ChannelId) => void) =>
		this.toLayer(
			Effect.succeed(({ channelId }) =>
				Effect.sync(() => {
					navigate(channelId)
					return ActivityMessage.CompletedRequestNavigation()
				}),
			),
		)
}

/** `notification.update` with `readAt` now, applied to the collection at once. */
export class MarkNotificationRead extends Command.Service<MarkNotificationRead>()(
	"hazel/activity/MarkNotificationRead",
	{ args: { id: NotificationId }, success: ActivityMessage },
) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return ({ id }) =>
				Effect.gen(function* () {
					const nowMs = yield* Clock.currentTimeMillis
					yield* data.actions.markNotificationReadAction({
						notificationId: id,
						readAt: new Date(nowMs),
					})
					return ActivityMessage.SucceededMarkRead({ id })
				}).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.catchTag("NotificationNotFoundError", () =>
						Effect.succeed(ActivityMessage.FailedMarkRead({ id, reason: "NotFound" })),
					),
					// BOUNDARY: every other failure (offline, unauthorized, sync timeout) reads the same here.
					Effect.tapCause((cause) => Effect.logWarning("mark read failed", cause)),
					Effect.catchCause(() =>
						Effect.succeed(ActivityMessage.FailedMarkRead({ id, reason: "Other" })),
					),
				)
		}),
	)
}

/** A row of the inbox's join (the collections decode with the domain schemas). */
interface NotificationRow {
	readonly notification: {
		readonly id: NotificationId
		readonly targetedResourceId: string | null
		readonly targetedResourceType: string | null
		readonly resourceType: string | null
		readonly reason?: string | null
		readonly createdAt: Date
		readonly readAt: Date | null
	}
	readonly message?: { readonly content?: string | null } | null
	readonly channel?: { readonly name: string; readonly type: string } | null
	readonly author?: {
		readonly firstName: string
		readonly lastName: string
		readonly avatarUrl?: string | null
	} | null
}

/** Channels opened for message previews: those of the newest notifications. */
const MAX_PREVIEW_CHANNELS = 25

/** Same query as the web inbox (`useNotifications`), with mentioned users named. */
const notificationsStream = (memberId: OrganizationMemberId) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) => {
				const nameOf = (id: string) => {
					const user = data.collections.userCollection.get(UserId.make(id))
					return user === undefined ? "" : `${user.firstName} ${user.lastName}`.trim()
				}
				const toItem = (row: NotificationRow): ActivityItem => {
					const content = row.message?.content ?? null
					return {
						id: row.notification.id,
						isUnread: row.notification.readAt === null,
						createdAtMs: new Date(row.notification.createdAt).getTime(),
						resourceType: row.notification.resourceType,
						reason: row.notification.reason ?? null,
						targetedResourceId: row.notification.targetedResourceId,
						targetedResourceType: row.notification.targetedResourceType,
						messageContent: content,
						mentionNames: Object.fromEntries(
							(content === null ? [] : mentionedUserIds(content)).flatMap((id) => {
								const name = nameOf(id)
								return name === "" ? [] : [[id, name]]
							}),
						),
						channel: row.channel ? { name: row.channel.name, type: row.channel.type } : null,
						author: row.author
							? {
									firstName: row.author.firstName,
									lastName: row.author.lastName,
									avatarUrl: row.author.avatarUrl ?? null,
								}
							: null,
					}
				}
				const { notificationCollection, messageCollection, channelCollection, userCollection } =
					data.collections
				return data.liveQueryStream<NotificationRow, ActivityMessage>(
					(q) =>
						q
							.from({ notification: notificationCollection })
							.leftJoin({ message: messageCollection }, ({ notification, message }) =>
								eq(notification.resourceId, message.id),
							)
							.leftJoin({ channel: channelCollection }, ({ notification, channel }) =>
								eq(notification.targetedResourceId, channel.id),
							)
							.leftJoin({ author: userCollection }, ({ message, author }) =>
								eq(message?.authorId, author.id),
							)
							.where(({ notification }) => eq(notification.memberId, memberId))
							.orderBy(({ notification }) => notification.createdAt, "desc"),
					(rows) => ActivityMessage.UpdatedNotifications({ items: rows.map(toItem) }),
				)
			},
		),
	)

/** Holds the preview channels' sources open while subscribed (messages sync per channel). */
const retainedChannels = (ids: ReadonlyArray<string>) =>
	Stream.unwrap(
		Effect.map(
			ClientData.useSync((data) => data),
			(data) => data.retainChannels(ids) as Stream.Stream<never>,
		),
	)

/** The relative times move on once a minute. */
const clock = Stream.fromEffectSchedule(
	Effect.map(Clock.currentTimeMillis, (nowMs) => ActivityMessage.Ticked({ nowMs })),
	Schedule.spaced(Duration.minutes(1)),
)

const COPY = {
	mentions: {
		heading: "Mentions",
		emptyTitle: "No mentions",
		emptyDescription: "You're all caught up! Mentions, replies and direct messages will appear here.",
	},
	all: {
		heading: "All activity",
		emptyTitle: "No notifications",
		emptyDescription: "You're all caught up! Notifications about messages and activity will appear here.",
	},
} as const satisfies Record<Tab, { heading: string; emptyTitle: string; emptyDescription: string }>

/** The channel a row opens, when it names one. */
const targetOf = (item: ActivityItem): ChannelId | null =>
	item.targetedResourceType === "channel" && item.targetedResourceId !== null
		? ChannelId.make(item.targetedResourceId)
		: null

const unreadOf = (model: ActivityModel, id: NotificationId) =>
	(model.items ?? []).some((item) => item.id === id && item.isUnread)

const previewChannels = (model: ActivityModel) =>
	[
		...new Set(
			(model.items ?? []).flatMap((item) =>
				item.targetedResourceType === "channel" && item.targetedResourceId !== null
					? [item.targetedResourceId]
					: [],
			),
		),
	]
		.slice(0, MAX_PREVIEW_CHANNELS)
		.join(",")

export const Activity = Hazel.component({
	name: "Activity",
	props: ActivityProps,
	model: ActivityModel,
	message: ActivityMessage,
}).make({
	init: ({ props }) => ({ tab: props.tab, nowMs: props.nowMs, items: null, showError: false }),
	update: {
		UpdatedNotifications: ($, { items }) => $.evolve({ items: () => items }),
		ChangedTab: ($, { tab }) => $.evolve({ tab: () => tab }),
		Ticked: ($, { nowMs }) => $.evolve({ nowMs: () => nowMs }),
		PressedNotification: ($, { id }) => {
			const item = ($.model.items ?? []).find((entry) => entry.id === id)
			const target = item === undefined ? null : targetOf(item)
			return $.run(
				...(unreadOf($.model, id) ? [MarkNotificationRead.make({ id })] : []),
				...(target === null ? [] : [RequestActivityNavigation.make({ channelId: target })]),
			)
		},
		PressedMarkRead: ($, { id }) =>
			unreadOf($.model, id) ? $.run(MarkNotificationRead.make({ id })) : $.model,
		// Rows read `readAt` from the collection, so success changes nothing here.
		SucceededMarkRead: ($) => $.model,
		FailedMarkRead: ($, { reason }) =>
			reason === "NotFound" ? $.model : $.evolve({ showError: () => true }),
		DismissedError: ($) => $.evolve({ showError: () => false }),
		CompletedRequestNavigation: ($) => $.model,
	},
	subscriptions: ({ props, model }) => [
		Subscription.make("notifications", [props.memberId], ([memberId]) => notificationsStream(memberId)),
		Subscription.make("previewChannels", [previewChannels(model)], ([ids]) =>
			retainedChannels(ids === "" ? [] : ids.split(",")),
		),
		Subscription.make("clock", [], () => clock),
	],
	view: (h, model) => {
		const leading = (item: ActivityItem) => {
			if (isSupportAlert(item))
				// HAZEL-GAP(activity-icon-tile): a toned icon tile (`iconTile` intent warning or danger).
				return h.icon.name("warning")
			if (item.author !== null) {
				const name = `${item.author.firstName} ${item.author.lastName}`.trim()
				return h.avatar
					.name(name)
					.initials(initialsOf(name))
					.src(item.author.avatarUrl ?? undefined)
			}
			return isDirect(item.channel?.type)
				? // HAZEL-GAP(icon-messages): the web's `IconMsgs` for a direct message has no `IconName`.
					h.icon.name("users")
				: h.icon.name("hashtag")
		}

		const row = (item: ActivityItem) => {
			const target = targetOf(item)
			const context = contextOf(item)
			// HAZEL-GAP(item-unread-dot): today's row leads with a brand dot when unread; `emphasized` stands in.
			// HAZEL-GAP(item-title-lines): the preview wraps to two lines (`line-clamp-2`); `title` truncates to one.
			// HAZEL-GAP(item-leading-size): a 40px avatar or tile leads the row; the item's leading slot is icon-sized.
			return h.item
				.key(item.id)
				.title(previewOf(item))
				.subtitle(context)
				.emphasized(item.isUnread)
				.leading(leading(item))
				.href(target === null ? undefined : `/${h.props.orgSlug}/chat/${target}`)
				.trailing(
					h.text
						.role("caption")
						.tone("muted")
						.numeric()
						// A row newer than the Model's clock (it ticks once a minute) is "less than a minute ago".
						.children(formatDistanceToNow(Math.min(item.createdAtMs, model.nowMs), model.nowMs)),
					item.isUnread
						? h.button
								.icon("check")
								.iconOnly()
								.variant("ghost")
								.size("xsmall")
								.label(`Mark as read: ${context}`)
								.on("press", ActivityMessage.PressedMarkRead({ id: item.id }))
						: null,
				)
				.on("press", ActivityMessage.PressedNotification({ id: item.id }))
		}

		const list = (items: ReadonlyArray<ActivityItem>) =>
			groupByTime(items, model.nowMs).map((group) =>
				// Not a `section`: that is the sidebar's group, inset and titled in sidebar ink.
				h.stack
					.key(group.label)
					.density("compact")
					.children(
						// HAZEL-GAP(text-overline): the group label is the kit's uppercase `label` heading.
						h.text.role("caption").tone("muted").strong().children(group.label),
						// HAZEL-GAP(frame-flush): today's card is a bordered box with no padding, rows split by hairlines.
						h.frame.children(
							...group.items.flatMap((item, index) =>
								index === 0 ? [row(item)] : [h.divider.key(`divider:${item.id}`), row(item)],
							),
						),
					),
			)

		const copy = COPY[model.tab]
		const listed = model.items === null ? null : itemsOfTab(model.items, model.tab)
		const body =
			listed === null
				? [h.list.loading()]
				: listed.length === 0
					? [h.emptyState.icon("bell").title(copy.emptyTitle).description(copy.emptyDescription)]
					: list(listed)
		const error = h.toast
			.open(model.showError)
			.tone("danger")
			.title("Couldn't mark the notification as read")
			.description("Check your connection and try again.")
			.on("dismiss", ActivityMessage.DismissedError())
		return Match.value(h.props.titled).pipe(
			Match.when(true, () =>
				h.screen.title(copy.heading).children(h.stack.density("relaxed").children(...body), error),
			),
			Match.orElse(() => h.stack.density("relaxed").children(...body, error)),
		)
	},
})

/** What a host provides: its data instance, its RPC client and its navigation. */
export const activityLayer = (
	data: ClientData["Service"],
	rpc: HazelRpc["Service"],
	navigate: (channelId: ChannelId) => void,
) =>
	Layer.mergeAll(MarkNotificationRead.layer, RequestActivityNavigation.layerWith(navigate)).pipe(
		Layer.provideMerge(Layer.mergeAll(Layer.succeed(ClientData, data), Layer.succeed(HazelRpc, rpc))),
	)
