// @vitest-environment jsdom
import { ChannelId, NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, organizationId, pageScene, uuid } from "../../../test/pages-fixtures"
import { AppRoute } from "../../../route"
import { Message } from "./message"
import type { UnreadChannelItem } from "./model"
import { init, MarkAllChannelsRead, MarkChannelRead, MarkNotificationRead, update } from "./update"
import { view } from "./view"

/** The inbox fed by its live queries: rows replace the loader, rows link to the chat, and Mark as read. */

const shared = makeShared({ nowMs: 600_000 })
const unread = {
	id: Schema.decodeSync(NotificationId)(uuid(1)),
	isUnread: true,
	createdAtMs: 0,
	resourceType: "message",
	reason: "mention",
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent: "Ship it",
	mentionNames: {},
	channel: { name: "general", type: "public" },
	author: { firstName: "Grace", lastName: "Hopper", avatarUrl: null },
}
const design: UnreadChannelItem = {
	channelId: Schema.decodeSync(ChannelId)(uuid(801)),
	name: "design",
	type: "public",
	mentionCount: 3,
	lastMessageAtMs: 540_000,
	mutedUntilMs: null,
}

const mentions = () => init(AppRoute.NotificationsMentions.make({ orgSlug: "hazel" })).model
const unreads = () => init(AppRoute.NotificationsUnreads.make({ orgSlug: "hazel" })).model

describe("notifications inbox view", () => {
	test("rows arrive from the live query; a channel row links to the chat and marks itself read", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(mentions()),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.Subscription.emit(Message.UpdatedNotifications({ notifications: [unread] })),
			Scene.expect(Scene.role("progressbar")).toBeAbsent(),
			Scene.expect(Scene.role("heading", { name: "Mentions" })).toExist(),
			Scene.expect(Scene.role("link", { name: /Ship it/ })).toHaveAttr(
				"href",
				`/hazel/chat/${uuid(900)}`,
			),
			Scene.click(Scene.role("link", { name: /Ship it/ })),
			Scene.Command.expectExact(MarkNotificationRead({ id: unread.id })),
			Scene.Command.resolve(
				MarkNotificationRead,
				Message.SucceededMarkNotificationRead({ id: unread.id }),
			),
		)
	})

	test("an unread notification's Mark as read action marks it read", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(mentions()),
			Scene.Subscription.emit(Message.UpdatedNotifications({ notifications: [unread] })),
			Scene.click(Scene.role("button", { name: "Mark as read" })),
			Scene.Command.expectExact(MarkNotificationRead({ id: unread.id })),
			Scene.Command.resolve(
				MarkNotificationRead,
				Message.SucceededMarkNotificationRead({ id: unread.id }),
			),
		)
	})

	test("an empty live result shows the all-caught-up state", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(AppRoute.NotificationsAll.make({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(Message.UpdatedNotifications({ notifications: [] })),
			Scene.expect(Scene.text("No notifications")).toExist(),
		)
	})
})

describe("unreads tab", () => {
	test("an unread channel links to the chat, with its mentions, and Mark as read clears it", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(unreads()),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.Subscription.emit(Message.UpdatedUnreadChannels({ channels: [design] })),
			Scene.expect(Scene.role("heading", { name: "Unreads" })).toExist(),
			Scene.expect(Scene.role("link", { name: /#design/ })).toHaveAttr(
				"href",
				`/hazel/chat/${uuid(801)}`,
			),
			Scene.expect(Scene.text("3 mentions")).toExist(),
			Scene.click(Scene.role("button", { name: "Mark as read" })),
			Scene.Command.expectExact(MarkChannelRead({ channelId: design.channelId })),
			// Hidden at once, before the read position syncs back.
			Scene.expect(Scene.text("#design")).toBeAbsent(),
			Scene.expect(Scene.text("No unread channels")).toExist(),
			Scene.Command.resolve(
				MarkChannelRead,
				Message.SucceededMarkChannelRead({ channelId: design.channelId }),
			),
		)
	})

	test("the header's Mark all as read marks the organization read", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(unreads()),
			Scene.Subscription.emit(Message.UpdatedUnreadChannels({ channels: [design] })),
			Scene.click(Scene.first(Scene.all.role("button", { name: "Mark all as read" }))),
			Scene.Command.expectExact(
				MarkAllChannelsRead({ organizationId, channelIds: [design.channelId] }),
			),
			Scene.expect(
				Scene.text("You're all caught up! Channels with new messages will appear here."),
			).toExist(),
			Scene.Command.resolve(MarkAllChannelsRead, Message.SucceededMarkAllChannelsRead()),
		)
	})

	test("no unread channels: all caught up, and no Mark all as read", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(unreads()),
			Scene.Subscription.emit(Message.UpdatedUnreadChannels({ channels: [] })),
			Scene.expect(Scene.text("No unread channels")).toExist(),
			Scene.expect(Scene.role("button", { name: "Mark all as read" })).toBeAbsent(),
		)
	})
})
