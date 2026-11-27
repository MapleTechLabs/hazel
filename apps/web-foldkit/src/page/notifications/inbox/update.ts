import { ChannelId, NotificationId, OrganizationId } from "@hazel/schema"
import { Array, Clock, Effect, Match, Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { catchCommon, errorToastOf } from "../../../data/actions"
import { HazelRpc } from "../../../rpc"
import type { RouteOf } from "../../../route"
import { type CommonReason, commonMessage } from "~/lib/error-messages"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { AppRoute } from "../../../route"
import { visibleUnreadChannels } from "./format"
import { Message } from "./message"
import { type MarkedRead, type Model, Notifications, type Tab, UnreadChannels } from "./model"

export type InboxRoute = RouteOf<
	| "NotificationsMentions"
	| "NotificationsUnreads"
	| "NotificationsAll"
	| "NotificationsGeneral"
	| "NotificationsThreads"
	| "NotificationsDms"
>

/** The former per-source tabs show All until `routeRedirect` replaces their URL. */
export const tabOf = (route: InboxRoute): Tab =>
	Match.value(route._tag).pipe(
		Match.when("NotificationsMentions", (): Tab => "mentions"),
		Match.when("NotificationsUnreads", (): Tab => "unreads"),
		Match.whenOr(
			"NotificationsAll",
			"NotificationsGeneral",
			"NotificationsThreads",
			"NotificationsDms",
			(): Tab => "all",
		),
		Match.exhaustive,
	)

/** `markAsRead` in `hooks/use-notifications.ts`: the same RPC and payload. */
export const MarkNotificationRead = Command.define("MarkNotificationRead", {
	args: { id: NotificationId },
	messages: [Message.SucceededMarkNotificationRead, Message.FailedMarkNotificationRead],
	execute: ({ id }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const nowMs = yield* Clock.currentTimeMillis
			yield* client("notification.update", { id, readAt: new Date(nowMs) })
			return Message.SucceededMarkNotificationRead({ id })
		}).pipe(
			Effect.catchTags({
				NotificationNotFoundError: () =>
					Effect.succeed(Message.FailedMarkNotificationRead({ id, reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedMarkNotificationRead({ id, reason })),
		),
})

/** One channel read: its read position moves to now and its notifications go (as opening it does). */
export const MarkChannelRead = Command.define("MarkChannelRead", {
	args: { channelId: ChannelId },
	messages: [Message.SucceededMarkChannelRead, Message.FailedMarkChannelRead],
	execute: ({ channelId }) =>
		HazelRpc.use((rpc) => rpc("channelMember.clearNotifications", { channelId })).pipe(
			Effect.as(Message.SucceededMarkChannelRead({ channelId })),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(Message.FailedMarkChannelRead({ channelId, reason: "ChannelNotFound" })),
			}),
			catchCommon((reason) => Message.FailedMarkChannelRead({ channelId, reason })),
		),
})

/** Every channel of the organization read (Shift+Escape's `channelMember.markAllRead`). */
export const MarkAllChannelsRead = Command.define("MarkAllChannelsRead", {
	args: { organizationId: OrganizationId, channelIds: Schema.Array(ChannelId) },
	messages: [Message.SucceededMarkAllChannelsRead, Message.FailedMarkAllChannelsRead],
	execute: ({ organizationId, channelIds }) =>
		HazelRpc.use((rpc) => rpc("channelMember.markAllRead", { organizationId })).pipe(
			Effect.as(Message.SucceededMarkAllChannelsRead()),
			catchCommon((reason) => Message.FailedMarkAllChannelsRead({ channelIds, reason })),
		),
})

export const init = (route: InboxRoute): PageReturn<Model, Message> => ({
	model: {
		tab: tabOf(route),
		notifications: Notifications.Loading(),
		unreadChannels: UnreadChannels.Loading(),
		markedRead: [],
		isMarkingAllRead: false,
	},
})

/** The tabs share one instance, so switching tabs keeps the loaded rows. */
export const routeChanged = (model: Model, route: InboxRoute): PageReturn<Model, Message> => ({
	model: modifyFields(model, { tab: () => tabOf(route) }),
})

const isUnread = (model: Model, id: NotificationId) =>
	Option.exists(
		Array.findFirst(
			model.notifications._tag === "Loaded" ? model.notifications.items : [],
			(item) => item.id === id,
		),
		(item) => item.isUnread,
	)

/** Only unread notifications are marked; a link still navigates. */
const markNotificationRead = (model: Model, id: NotificationId): PageReturn<Model, Message> =>
	isUnread(model, id) ? { model, commands: [MarkNotificationRead({ id })] } : { model }

const loadedChannels = (model: Model) =>
	model.unreadChannels._tag === "Loaded" ? model.unreadChannels.channels : []

/** Hides the channels as read up to their newest message, until the read position syncs back. */
const markChannelsRead = (model: Model, channelIds: ReadonlyArray<ChannelId>): Model => {
	const marked: ReadonlyArray<MarkedRead> = loadedChannels(model).flatMap((channel) =>
		channelIds.includes(channel.channelId)
			? [{ channelId: channel.channelId, upToMs: channel.lastMessageAtMs }]
			: [],
	)
	return modifyFields(model, {
		markedRead: (current) => [
			...current.filter((entry) => !channelIds.includes(entry.channelId)),
			...marked,
		],
	})
}

const unmarkChannels = (model: Model, channelIds: ReadonlyArray<ChannelId>): Model =>
	modifyFields(model, {
		markedRead: (current) => current.filter((entry) => !channelIds.includes(entry.channelId)),
	})

const errorToast = (title: string, reason: CommonReason) =>
	PageOutMessage.RequestedToast({
		toast: errorToastOf({ title, description: commonMessage(reason).description }),
	})

export const update = (model: Model, message: Message, shared: Shared): PageReturn<Model, Message> =>
	Message.match<PageReturn<Model, Message>>(message, {
		UpdatedNotifications: ({ notifications }) => ({
			model: modifyFields(model, {
				notifications: () => Notifications.Loaded({ items: notifications }),
			}),
		}),
		// A mark that left the unread rows, or that a newer message outdated, is no longer needed.
		UpdatedUnreadChannels: ({ channels }) => ({
			model: modifyFields(model, {
				unreadChannels: () => UnreadChannels.Loaded({ channels }),
				markedRead: (current) =>
					current.filter((entry) =>
						channels.some(
							(channel) =>
								channel.channelId === entry.channelId &&
								channel.lastMessageAtMs <= entry.upToMs,
						),
					),
			}),
		}),
		ClickedNotification: ({ id }) => markNotificationRead(model, id),
		ClickedMarkNotificationRead: ({ id }) => markNotificationRead(model, id),
		// Rows read `readAt` straight from the collection, so the write changes nothing here.
		SucceededMarkNotificationRead: () => ({ model }),
		// A notification that is gone has nothing left to mark; anything else stays unread and says so.
		FailedMarkNotificationRead: ({ reason }) =>
			reason === "NotFound"
				? { model }
				: {
						model,
						outMessage: errorToast("Couldn't mark the notification as read", reason),
					},
		ClickedMarkChannelRead: ({ channelId }) => ({
			model: markChannelsRead(model, [channelId]),
			commands: [MarkChannelRead({ channelId })],
		}),
		SucceededMarkChannelRead: () => ({ model }),
		// A channel that is gone leaves the list on its own; anything else shows it unread again.
		FailedMarkChannelRead: ({ channelId, reason }) =>
			reason === "ChannelNotFound"
				? { model }
				: {
						model: unmarkChannels(model, [channelId]),
						outMessage: errorToast("Couldn't mark the channel as read", reason),
					},
		ClickedMarkAllChannelsRead: () => {
			const organizationId = shared.organization?.id
			if (organizationId === undefined || model.isMarkingAllRead) return { model }
			const channelIds = visibleUnreadChannels(
				loadedChannels(model),
				model.markedRead,
				shared.nowMs,
			).map((channel) => channel.channelId)
			return {
				model: modifyFields(markChannelsRead(model, channelIds), { isMarkingAllRead: () => true }),
				commands: [MarkAllChannelsRead({ organizationId, channelIds })],
			}
		},
		SucceededMarkAllChannelsRead: () => ({
			model: modifyFields(model, { isMarkingAllRead: () => false }),
		}),
		FailedMarkAllChannelsRead: ({ channelIds, reason }) => ({
			model: modifyFields(unmarkChannels(model, channelIds), { isMarkingAllRead: () => false }),
			outMessage: errorToast("Couldn't mark the channels as read", reason),
		}),
	})
