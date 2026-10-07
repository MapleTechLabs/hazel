import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Scene } from "foldkit"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { formatDistanceToNow, groupByTime } from "./format"
import { Message } from "./message"
import type { Model, NotificationItem } from "./model"
import { MarkNotificationRead, routeChanged, update } from "./update"
import { inboxView } from "./view"
import { sharedDefaults } from "../../test-shared"

/** Inbox update and view: grouping, category tabs, and marking unread notifications read. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const notificationId = (n: number) => Schema.decodeSync(NotificationId)(uuid(n))
// A Thursday; the en-US week started on Sunday the 14th.
const NOW = new Date(2026, 5, 18, 12, 0).getTime()
const MINUTE = 60_000

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: null,
	member: null,
	nowMs: NOW,
	...sharedDefaults,
}

const item = (n: number, overrides: Partial<NotificationItem>): NotificationItem => ({
	id: notificationId(n),
	isUnread: false,
	createdAtMs: NOW - 3 * MINUTE,
	resourceType: "message",
	targetedResourceId: uuid(900),
	targetedResourceType: "channel",
	messageContent: `message ${n}`,
	channel: { name: "general", type: "public" },
	author: { firstName: "Grace", lastName: "Hopper", avatarUrl: null },
	...overrides,
})

const unreadChannel = item(1, { isUnread: true, messageContent: "Have a **good** one!" })
const readDm = item(2, {
	createdAtMs: NOW - 26 * 60 * MINUTE,
	messageContent: "Sent you the rubric",
	channel: { name: "Grace Hopper", type: "single" },
})
const unreadOrphan = item(3, {
	isUnread: true,
	createdAtMs: NOW - 3 * 24 * 60 * MINUTE,
	resourceType: null,
	targetedResourceId: null,
	targetedResourceType: null,
	messageContent: null,
	channel: null,
	author: null,
})
const olderThread = item(4, {
	createdAtMs: NOW - 9 * 24 * 60 * MINUTE,
	channel: { name: "Onboarding", type: "thread" },
})

const inbox: Model = { category: "all", notifications: [unreadChannel, readDm, unreadOrphan, olderThread] }
const view = Scene.withViewInputs(inboxView, { shared })

describe("notifications inbox", () => {
	test("groups by day and week, newest group first", () => {
		expect(groupByTime(inbox.notifications ?? [], NOW).map((group) => group.label)).toEqual([
			"Today",
			"Yesterday",
			"This Week",
			"Older",
		])
		Scene.scene(
			{ update, view: view() },
			Scene.given(inbox),
			Scene.expect(Scene.role("heading", { name: "All Activity" })).toExist(),
			Scene.expect(Scene.text("Have a good one!")).toExist(),
			Scene.expect(Scene.text("3 minutes ago")).toExist(),
			Scene.expect(Scene.text("New message in #general")).toExist(),
			Scene.expect(Scene.text("New notification")).toExist(),
		)
	})

	test("clicking an unread notification marks it read with the legacy RPC", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(inbox),
			Scene.click(Scene.text("Have a good one!")),
			Scene.Command.expectExact(MarkNotificationRead),
			Scene.Command.resolve(
				MarkNotificationRead,
				Message.SucceededMarkNotificationRead({ id: unreadChannel.id }),
			),
		)
	})

	test("an unread notification without a channel is a button that Enter activates", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(inbox),
			Scene.keydown(Scene.role("button"), "Enter"),
			Scene.Command.expectExact(MarkNotificationRead),
			Scene.Command.resolve(
				MarkNotificationRead,
				Message.FailedMarkNotificationRead({ id: unreadOrphan.id, reason: "offline" }),
			),
		)
	})

	test("a read notification is not marked again", () => {
		const next = update(inbox, Message.ClickedNotification({ id: readDm.id }))
		expect(next.commands ?? []).toEqual([])
	})

	test("a category tab keeps the rows and filters them", () => {
		const dms = routeChanged(inbox, { _tag: "NotificationsDms", orgSlug: "hazel" }).model
		Scene.scene(
			{ update, view: view() },
			Scene.given(dms),
			Scene.expect(Scene.role("heading", { name: "Direct Messages" })).toExist(),
			Scene.expect(Scene.text("Sent you the rubric")).toExist(),
			Scene.expect(Scene.text("Have a good one!")).toBeAbsent(),
		)
		Scene.scene(
			{ update, view: view() },
			Scene.given({ ...dms, notifications: [unreadChannel] }),
			Scene.expect(Scene.text("No DM notifications")).toExist(),
		)
	})

	test("shows the loader until the first rows arrive", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given<Model>({ category: "all", notifications: null }),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.expect(Scene.text("No notifications")).toBeAbsent(),
		)
	})

	test("formats distances like date-fns", () => {
		const ago = (minutes: number) => formatDistanceToNow(NOW - minutes * MINUTE, NOW)
		expect(ago(0)).toBe("less than a minute ago")
		expect(ago(1)).toBe("1 minute ago")
		expect(ago(44)).toBe("44 minutes ago")
		expect(ago(60)).toBe("about 1 hour ago")
		expect(ago(168)).toBe("about 3 hours ago")
		expect(ago(26 * 60)).toBe("1 day ago")
		expect(ago(9 * 24 * 60)).toBe("9 days ago")
		expect(ago(40 * 24 * 60)).toBe("about 1 month ago")
	})
})
