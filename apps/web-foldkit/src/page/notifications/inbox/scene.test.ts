// @vitest-environment jsdom
import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { makeShared, pageScene, uuid } from "../../../test/pages-fixtures"
import { AppRoute } from "../../../route"
import { Message } from "./message"
import { init, MarkNotificationRead, update } from "./update"
import { view } from "./view"

/** The inbox fed by its live query: rows replace the loader, and a channel row links to the chat. */

const shared = makeShared({ nowMs: 600_000 })
const unread = {
	id: Schema.decodeSync(NotificationId)(uuid(1)),
	isUnread: true,
	createdAtMs: 0,
	resourceType: "message",
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent: "Ship it",
	channel: { name: "general", type: "public" },
	author: { firstName: "Grace", lastName: "Hopper", avatarUrl: null },
}

describe("notifications inbox view", () => {
	test("rows arrive from the live query; a channel row links to the chat and marks itself read", () => {
		Scene.scene(
			pageScene(update, view, shared),
			Scene.given(init(AppRoute.NotificationsAll.make({ orgSlug: "hazel" })).model),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.Subscription.emit(Message.UpdatedNotifications({ notifications: [unread] })),
			Scene.expect(Scene.role("progressbar")).toBeAbsent(),
			Scene.expect(Scene.role("link", { name: /Ship it/ })).toHaveAttr("href", `/hazel/chat/${uuid(900)}`),
			Scene.click(Scene.role("link", { name: /Ship it/ })),
			Scene.Command.expectExact(MarkNotificationRead({ id: unread.id })),
			Scene.Command.resolve(MarkNotificationRead, Message.SucceededMarkNotificationRead({ id: unread.id })),
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
