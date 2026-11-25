// @vitest-environment jsdom
import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { makeShared, organizationId, storyUpdate, uuid } from "../../../test/pages-fixtures"
import { errorToast } from "../../../data/actions"
import { AppRoute } from "../../../route"
import { PageOutMessage } from "../../out-message"
import { visibleUnreadChannels } from "./format"
import { Message } from "./message"
import {
	type Model,
	type NotificationItem,
	Notifications,
	type UnreadChannelItem,
	UnreadChannels,
} from "./model"
import {
	init,
	MarkAllChannelsRead,
	MarkChannelRead,
	MarkNotificationRead,
	routeChanged,
	update as pageUpdate,
} from "./update"

/** The inbox update loop: live rows, the tabs, and every "Mark as read". */

const NOW = 1_000_000
const shared = makeShared({ nowMs: NOW })
const update = storyUpdate(pageUpdate, shared)

const notification = (n: number, isUnread: boolean): NotificationItem => ({
	id: Schema.decodeSync(NotificationId)(uuid(n)),
	isUnread,
	createdAtMs: 0,
	resourceType: "message",
	reason: null,
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent: `message ${n}`,
	channel: { name: "general", type: "public" },
	author: null,
})
const unread = notification(1, true)
const read = notification(2, false)

const channel = (n: number, fields: Partial<UnreadChannelItem> = {}): UnreadChannelItem => ({
	channelId: Schema.decodeSync(ChannelId)(uuid(800 + n)),
	name: `channel-${n}`,
	type: "public",
	mentionCount: 0,
	lastMessageAtMs: NOW - n * 1000,
	mutedUntilMs: null,
	...fields,
})
const design = channel(1, { mentionCount: 2 })
const random = channel(2)

const base = init(AppRoute.NotificationsAll.make({ orgSlug: "hazel" })).model
const loaded: Model = { ...base, notifications: Notifications.Loaded({ items: [unread, read] }) }
const unreads: Model = {
	...base,
	tab: "unreads",
	unreadChannels: UnreadChannels.Loaded({ channels: [random, design] }),
}
const visibleIds = (current: Model) =>
	visibleUnreadChannels(
		current.unreadChannels._tag === "Loaded" ? current.unreadChannels.channels : [],
		current.markedRead,
		NOW,
	).map((entry) => entry.channelId)

describe("notifications inbox update", () => {
	test("opens on Mentions at /notifications and takes the live rows", () => {
		const started = init(AppRoute.NotificationsMentions.make({ orgSlug: "hazel" }))
		expect(started.model).toEqual({
			tab: "mentions",
			notifications: Notifications.Loading(),
			unreadChannels: UnreadChannels.Loading(),
			markedRead: [],
			isMarkingAllRead: false,
		})
		story(
			update,
			given(started.model),
			message(Message.UpdatedNotifications({ notifications: [unread] })),
			model((current) =>
				expect(current.notifications).toEqual(Notifications.Loaded({ items: [unread] })),
			),
		)
	})

	test("each route picks its tab; the former source tabs show All", () => {
		const tabOfRoute = (route: Parameters<typeof init>[0]) => init(route).model.tab
		expect(tabOfRoute(AppRoute.NotificationsUnreads.make({ orgSlug: "hazel" }))).toBe("unreads")
		expect(tabOfRoute(AppRoute.NotificationsAll.make({ orgSlug: "hazel" }))).toBe("all")
		expect(tabOfRoute(AppRoute.NotificationsGeneral.make({ orgSlug: "hazel" }))).toBe("all")
		expect(tabOfRoute(AppRoute.NotificationsThreads.make({ orgSlug: "hazel" }))).toBe("all")
		expect(tabOfRoute(AppRoute.NotificationsDms.make({ orgSlug: "hazel" }))).toBe("all")
	})

	test("clicking an unread row marks exactly that row read; the live query reflects the change", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: unread.id })),
			Command.expectExact(MarkNotificationRead({ id: unread.id })),
			Command.resolve(MarkNotificationRead, Message.SucceededMarkNotificationRead({ id: unread.id })),
			expectNoOutMessage(),
			model((current) => expect(current).toEqual(loaded)),
		)
	})

	test("the row's Mark as read action marks it read without opening it", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedMarkNotificationRead({ id: unread.id })),
			Command.expectExact(MarkNotificationRead({ id: unread.id })),
			Command.resolve(MarkNotificationRead, Message.SucceededMarkNotificationRead({ id: unread.id })),
			expectNoOutMessage(),
		)
		story(
			update,
			given(loaded),
			message(Message.ClickedMarkNotificationRead({ id: read.id })),
			Command.expectNone(),
		)
	})

	test("a read row, or a row no longer in the list, is not marked", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: read.id })),
			Command.expectNone(),
		)
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: notification(3, true).id })),
			Command.expectNone(),
		)
	})

	test("a failed mark-read leaves the row unread and says so", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: unread.id })),
			Command.resolve(
				MarkNotificationRead,
				Message.FailedMarkNotificationRead({ id: unread.id, reason: "Offline" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Couldn't mark the notification as read",
						"Check your internet connection and try again.",
					),
				}),
			),
			model((current) => expect(current).toEqual(loaded)),
		)
	})

	test("a notification that is already gone fails quietly", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: unread.id })),
			Command.resolve(
				MarkNotificationRead,
				Message.FailedMarkNotificationRead({ id: unread.id, reason: "NotFound" }),
			),
			expectNoOutMessage(),
		)
	})

	test("switching tabs keeps the loaded rows", () => {
		const next = routeChanged(loaded, AppRoute.NotificationsUnreads.make({ orgSlug: "hazel" })).model
		expect(next).toEqual({ ...loaded, tab: "unreads" })
	})
})

describe("unreads", () => {
	test("lists unread channels newest first, leaving out the ones muted for now", () => {
		const muted = channel(0, { mutedUntilMs: NOW + 60_000 })
		const mutedEarlier = channel(3, { mutedUntilMs: NOW - 1 })
		expect(
			visibleUnreadChannels([random, muted, mutedEarlier, design], [], NOW).map((c) => c.channelId),
		).toEqual([design.channelId, random.channelId, mutedEarlier.channelId])
	})

	test("Mark as read clears the channel and hides it until its read position syncs back", () => {
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkChannelRead({ channelId: design.channelId })),
			Command.expectExact(MarkChannelRead({ channelId: design.channelId })),
			model((current) => expect(visibleIds(current)).toEqual([random.channelId])),
			Command.resolve(
				MarkChannelRead,
				Message.SucceededMarkChannelRead({ channelId: design.channelId }),
			),
			expectNoOutMessage(),
			// The read position syncs: the channel leaves the live rows, and the mark is dropped.
			message(Message.UpdatedUnreadChannels({ channels: [random] })),
			model((current) => {
				expect(current.markedRead).toEqual([])
				expect(visibleIds(current)).toEqual([random.channelId])
			}),
		)
	})

	test("a message newer than the mark shows the channel again", () => {
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkChannelRead({ channelId: design.channelId })),
			Command.resolve(
				MarkChannelRead,
				Message.SucceededMarkChannelRead({ channelId: design.channelId }),
			),
			message(
				Message.UpdatedUnreadChannels({
					channels: [random, { ...design, lastMessageAtMs: NOW }],
				}),
			),
			model((current) => expect(visibleIds(current)).toEqual([design.channelId, random.channelId])),
		)
	})

	test("a failed clear shows the channel again and says so; a deleted channel fails quietly", () => {
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkChannelRead({ channelId: design.channelId })),
			Command.resolve(
				MarkChannelRead,
				Message.FailedMarkChannelRead({ channelId: design.channelId, reason: "Offline" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Couldn't mark the channel as read",
						"Check your internet connection and try again.",
					),
				}),
			),
			model((current) => expect(visibleIds(current)).toEqual([design.channelId, random.channelId])),
		)
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkChannelRead({ channelId: design.channelId })),
			Command.resolve(
				MarkChannelRead,
				Message.FailedMarkChannelRead({ channelId: design.channelId, reason: "ChannelNotFound" }),
			),
			expectNoOutMessage(),
			// The deleted channel stays hidden, and its mark goes once it leaves the live rows.
			model((current) => expect(visibleIds(current)).toEqual([random.channelId])),
			message(Message.UpdatedUnreadChannels({ channels: [random] })),
			model((current) => {
				expect(current.markedRead).toEqual([])
				expect(visibleIds(current)).toEqual([random.channelId])
			}),
		)
	})

	test("Mark all as read marks the organization read with the shown channels hidden meanwhile", () => {
		const channelIds = [design.channelId, random.channelId]
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkAllChannelsRead()),
			Command.expectExact(MarkAllChannelsRead({ organizationId, channelIds })),
			model((current) => {
				expect(current.isMarkingAllRead).toBe(true)
				expect(visibleIds(current)).toEqual([])
			}),
			Command.resolve(MarkAllChannelsRead, Message.SucceededMarkAllChannelsRead()),
			expectNoOutMessage(),
			model((current) => expect(current.isMarkingAllRead).toBe(false)),
		)
	})

	test("a failed Mark all as read shows the channels again and says so", () => {
		const channelIds = [design.channelId, random.channelId]
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkAllChannelsRead()),
			Command.resolve(
				MarkAllChannelsRead,
				Message.FailedMarkAllChannelsRead({ channelIds, reason: "Offline" }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast(
						"Couldn't mark the channels as read",
						"Check your internet connection and try again.",
					),
				}),
			),
			model((current) => {
				expect(current.isMarkingAllRead).toBe(false)
				expect(visibleIds(current)).toEqual(channelIds)
			}),
		)
	})

	test("Mark all as read before the organization loads does nothing; a later press marks them", () => {
		story(
			storyUpdate(pageUpdate, makeShared({ nowMs: NOW, organization: null })),
			given(unreads),
			message(Message.ClickedMarkAllChannelsRead()),
			Command.expectNone(),
			model((current) => expect(current).toEqual(unreads)),
		)
		story(
			update,
			given(unreads),
			message(Message.ClickedMarkAllChannelsRead()),
			Command.expectExact(
				MarkAllChannelsRead({ organizationId, channelIds: [design.channelId, random.channelId] }),
			),
			Command.resolve(MarkAllChannelsRead, Message.SucceededMarkAllChannelsRead()),
		)
	})
})
