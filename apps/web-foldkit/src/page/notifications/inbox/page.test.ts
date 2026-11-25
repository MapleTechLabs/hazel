import { NotificationId } from "@hazel/schema"
import { Schema } from "effect"
import { Scene } from "foldkit"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { groupByTime, notificationsOfTab } from "./format"
import { Message } from "./message"
import { type Model, type NotificationItem, Notifications, UnreadChannels } from "./model"
import { MarkNotificationRead, routeChanged, update as pageUpdate } from "./update"
import { inboxView } from "./view"
import { sharedDefaults } from "../../test-shared"

/** Inbox update and view: grouping, the Mentions and All tabs, and marking unread notifications read. */

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
	reason: null,
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

const items = [unreadChannel, readDm, unreadOrphan, olderThread]
const modelOf = (fields: Partial<Model>): Model => ({
	tab: "all",
	notifications: Notifications.Loading(),
	unreadChannels: UnreadChannels.Loading(),
	markedRead: [],
	isMarkingAllRead: false,
	...fields,
})
const inbox = modelOf({ notifications: Notifications.Loaded({ items }) })
const update = (model: Model, message: Message) => pageUpdate(model, message, shared)
const view = Scene.withViewInputs(inboxView, { shared })

describe("notifications inbox", () => {
	test("groups by day and week, newest group first", () => {
		expect(groupByTime(items, NOW).map((group) => group.label)).toEqual([
			"Today",
			"Yesterday",
			"This week",
			"Older",
		])
		Scene.scene(
			{ update, view: view() },
			Scene.given(inbox),
			Scene.expect(Scene.role("heading", { name: "All activity" })).toExist(),
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
			Scene.keydown(Scene.role("button", { name: /View notification/ }), "Enter"),
			Scene.Command.expectExact(MarkNotificationRead),
			Scene.Command.resolve(
				MarkNotificationRead,
				Message.FailedMarkNotificationRead({ id: unreadOrphan.id, reason: "NotFound" }),
			),
		)
	})

	test("a read notification is not marked again", () => {
		const next = update(inbox, Message.ClickedNotification({ id: readDm.id }))
		expect(next.commands ?? []).toEqual([])
	})

	test("Mentions lists what names the user (and rows from before reasons); All lists everything", () => {
		const mention = item(7, { reason: "mention", messageContent: "@Ada can you look?" })
		const reply = item(8, { reason: "reply", messageContent: "Replying to you" })
		const everyone = item(9, { reason: "everyone", messageContent: "Heads up, all" })
		const direct = item(10, { reason: "direct", messageContent: "Hey Ada" })
		const message = item(11, { reason: "message", messageContent: "Just chatting" })
		const sla = item(12, { reason: "sla_reply_breach", resourceType: "customer_issue" })
		const legacy = item(13, { reason: null, messageContent: "From before reasons" })
		const all = [mention, reply, everyone, direct, message, sla, legacy]
		expect(notificationsOfTab(all, "mentions")).toEqual([mention, reply, everyone, direct, legacy])
		expect(notificationsOfTab(all, "all")).toEqual(all)
		const mentions = routeChanged(modelOf({ notifications: Notifications.Loaded({ items: all }) }), {
			_tag: "NotificationsMentions",
			orgSlug: "hazel",
		}).model
		Scene.scene(
			{ update, view: view() },
			Scene.given(mentions),
			Scene.expect(Scene.role("heading", { name: "Mentions" })).toExist(),
			Scene.expect(Scene.text("@Ada can you look?")).toExist(),
			Scene.expect(Scene.text("Hey Ada")).toExist(),
			Scene.expect(Scene.text("Just chatting")).toBeAbsent(),
			Scene.expect(Scene.text("A support issue is past its reply deadline")).toBeAbsent(),
		)
		Scene.scene(
			{ update, view: view() },
			Scene.given({ ...mentions, notifications: Notifications.Loaded({ items: [message] }) }),
			Scene.expect(Scene.text("No mentions")).toExist(),
		)
	})

	test("shows the loader until the first rows arrive", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(modelOf({})),
			Scene.expect(Scene.role("progressbar")).toExist(),
			Scene.expect(Scene.text("No notifications")).toBeAbsent(),
		)
	})
})

describe("support SLA alerts", () => {
	const breach = item(5, {
		isUnread: true,
		resourceType: "customer_issue",
		reason: "sla_reply_breach",
		messageContent: null,
		author: null,
		channel: { name: "SSO login loops", type: "thread" },
	})
	const warning = item(6, {
		...breach,
		id: notificationId(6),
		reason: "sla_resolution_warning",
		channel: { name: "ext-acme", type: "public" },
	})

	test("read as the issue's state in its channel, not as a message", () => {
		Scene.scene(
			{ update, view: view() },
			Scene.given(
				modelOf({ notifications: Notifications.Loaded({ items: [breach, warning, unreadChannel] }) }),
			),
			Scene.expect(Scene.text("Reply overdue in #SSO login loops")).toExist(),
			Scene.expect(Scene.text("A support issue is past its reply deadline")).toExist(),
			Scene.expect(Scene.text("Resolution due soon in #ext-acme")).toExist(),
			Scene.expect(Scene.text("A support issue is close to its resolution deadline")).toExist(),
			Scene.expect(Scene.text("New message in #general")).toExist(),
		)
	})
})
