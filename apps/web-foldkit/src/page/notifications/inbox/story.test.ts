// @vitest-environment jsdom
import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { uuid } from "../../../test/pages-fixtures"
import { AppRoute } from "../../../route"
import { Message } from "./message"
import type { Model, NotificationItem } from "./model"
import { init, MarkNotificationRead, routeChanged, update } from "./update"

/** The inbox update loop: live rows, marking unread rows read, and the category tabs. */

const notification = (n: number, isUnread: boolean): NotificationItem => ({
	id: Schema.decodeSync(NotificationId)(uuid(n)),
	isUnread,
	createdAtMs: 0,
	resourceType: "message",
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent: `message ${n}`,
	channel: { name: "general", type: "public" },
	author: null,
})
const unread = notification(1, true)
const read = notification(2, false)
const loaded: Model = { category: "all", notifications: [unread, read] }

describe("notifications inbox update", () => {
	test("starts loading on the route's tab and takes the live rows", () => {
		const started = init(AppRoute.NotificationsThreads.make({ orgSlug: "hazel" }))
		expect(started.model).toEqual({ category: "threads", notifications: null })
		story(
			update,
			given(started.model),
			message(Message.UpdatedNotifications({ notifications: [unread] })),
			model((current) => expect(current.notifications).toEqual([unread])),
		)
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

	test("a read row, or a row no longer in the list, is not marked", () => {
		story(update, given(loaded), message(Message.ClickedNotification({ id: read.id })), Command.expectNone())
		story(update, given(loaded), message(Message.ClickedNotification({ id: notification(3, true).id })), Command.expectNone())
	})

	test("a failed mark-read leaves the row unread and reports nothing", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedNotification({ id: unread.id })),
			Command.resolve(MarkNotificationRead, Message.FailedMarkNotificationRead({ id: unread.id, reason: "offline" })),
			expectNoOutMessage(),
			model((current) => expect(current.notifications?.[0]?.isUnread).toBe(true)),
		)
	})

	test("switching tabs keeps the loaded rows", () => {
		const dms = routeChanged(loaded, AppRoute.NotificationsDms.make({ orgSlug: "hazel" })).model
		expect(dms).toEqual({ category: "dms", notifications: loaded.notifications })
	})
})
