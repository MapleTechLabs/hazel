// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Story } from "@effect/ui/testing"
import { NotificationId, OrganizationMemberId } from "@hazel/schema"
import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import {
	Activity,
	type ActivityItem,
	ActivityMessage,
	MarkNotificationRead,
	RequestActivityNavigation,
} from "./Activity"
import { contextOf, formatDistanceToNow, groupByTime, itemsOfTab, previewOf } from "./format"

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const HOUR = 3_600_000

const props = {
	memberId: OrganizationMemberId.make("00000002-0000-4000-8000-000000000001"),
	orgSlug: "acme",
	tab: "mentions" as const,
	nowMs: NOW,
	titled: false,
}

const item = (n: number, overrides: Partial<ActivityItem> = {}): ActivityItem => ({
	id: NotificationId.make(`00000008-0000-4000-8000-${n.toString(16).padStart(12, "0")}`),
	isUnread: true,
	createdAtMs: NOW - n * HOUR,
	resourceType: "message",
	reason: "mention",
	targetedResourceId: "00000005-0000-4000-8000-000000000005",
	targetedResourceType: "channel",
	messageContent: "Can you review this?",
	mentionNames: {},
	channel: { name: "design", type: "public" },
	author: { firstName: "Grace", lastName: "Hopper", avatarUrl: null },
	...overrides,
})

describe("Activity", () => {
	it.effect("starts loading, with its live query, preview channels and clock", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(Activity, props)
			assert.isTrue(s.model.items === null)
			assert.deepStrictEqual(s.subscriptions, [
				`notifications:"${props.memberId}"`,
				'previewChannels:""',
				"clock:",
				`tab:"${props.tab}"`,
			])
			const rows = [item(1), item(2, { targetedResourceId: "00000005-0000-4000-8000-000000000009" })]
			s.send(ActivityMessage.UpdatedNotifications({ items: rows }))
			assert.strictEqual(s.model.items?.length, 2)
			assert.deepStrictEqual(s.subscriptions, [
				`notifications:"${props.memberId}"`,
				'previewChannels:"00000005-0000-4000-8000-000000000005,00000005-0000-4000-8000-000000000009"',
				"clock:",
				`tab:"${props.tab}"`,
			])
		}),
	)

	it.effect("a press on an unread row marks it read and opens its channel", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(Activity, props)
			const row = item(1)
			s.send(ActivityMessage.UpdatedNotifications({ items: [row] }))
				.send(ActivityMessage.PressedNotification({ id: row.id }))
				.expectExact(MarkNotificationRead, RequestActivityNavigation)
			assert.deepStrictEqual(
				s.pending.map((entry) => entry.command.args),
				[{ id: row.id }, { channelId: row.targetedResourceId }],
			)
			s.resolve(MarkNotificationRead, ActivityMessage.SucceededMarkRead({ id: row.id })).resolve(
				RequestActivityNavigation,
				ActivityMessage.CompletedRequestNavigation(),
			)
		}),
	)

	it.effect("a press on a read row only navigates; one with no channel does nothing", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(Activity, props)
			const read = item(1, { isUnread: false })
			const nowhere = item(2, { isUnread: false, targetedResourceType: null, targetedResourceId: null })
			s.send(ActivityMessage.UpdatedNotifications({ items: [read, nowhere] }))
				.send(ActivityMessage.PressedNotification({ id: read.id }))
				.expectExact(RequestActivityNavigation)
				.resolve(RequestActivityNavigation, ActivityMessage.CompletedRequestNavigation())
				.send(ActivityMessage.PressedNotification({ id: nowhere.id }))
				.expectNone()
		}),
	)

	it.effect("Mark as read runs once per unread row; a failure shows the error until dismissed", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(Activity, props)
			const row = item(1)
			s.send(ActivityMessage.UpdatedNotifications({ items: [row] }))
				.send(ActivityMessage.PressedMarkRead({ id: row.id }))
				.expectExact(MarkNotificationRead)
				.resolve(
					MarkNotificationRead,
					ActivityMessage.FailedMarkRead({ id: row.id, reason: "Other" }),
				)
			assert.isTrue(s.model.showError)
			s.send(ActivityMessage.DismissedError())
			assert.isFalse(s.model.showError)
			// Gone already: nothing to say.
			s.send(ActivityMessage.PressedMarkRead({ id: row.id }))
				.expectExact(MarkNotificationRead)
				.resolve(
					MarkNotificationRead,
					ActivityMessage.FailedMarkRead({ id: row.id, reason: "NotFound" }),
				)
			assert.isFalse(s.model.showError)
			// Read (the collection synced back): the button is gone, and a stray press does nothing.
			s.send(ActivityMessage.UpdatedNotifications({ items: [{ ...row, isUnread: false }] }))
				.send(ActivityMessage.PressedMarkRead({ id: row.id }))
				.expectNone()
		}),
	)

	it.effect("takes the host's tab and the clock's ticks", () =>
		Effect.gen(function* () {
			const s = yield* Story.make(Activity, props)
			s.send(ActivityMessage.ChangedTab({ tab: "all" }))
			assert.strictEqual(s.model.tab, "all")
			s.send(ActivityMessage.Ticked({ nowMs: NOW + HOUR }))
			assert.strictEqual(s.model.nowMs, NOW + HOUR)
		}),
	)
})

describe("activity format", () => {
	it("words rows as the web inbox does", () => {
		assert.strictEqual(previewOf(item(1, { messageContent: null })), "View notification")
		assert.strictEqual(
			previewOf(
				item(1, {
					messageContent: "Hi @[userId:u1] and @[directive:here], **look**",
					mentionNames: { u1: "Ada" },
				}),
			),
			"Hi @Ada and @here, look",
		)
		assert.strictEqual(contextOf(item(1)), "New message in #design")
		assert.strictEqual(
			contextOf(item(1, { channel: { name: "", type: "single" } })),
			"New direct message",
		)
		assert.strictEqual(contextOf(item(1, { channel: null })), "New notification")
		assert.strictEqual(formatDistanceToNow(NOW - 3 * HOUR, NOW), "about 3 hours ago")
		assert.strictEqual(formatDistanceToNow(NOW - 10_000, NOW), "less than a minute ago")
	})

	it("filters Mentions by reason and groups by day", () => {
		const rows = [item(1), item(2, { reason: "message" }), item(3, { reason: "direct" }), item(30)]
		assert.deepStrictEqual(
			itemsOfTab(rows, "mentions").map((row) => row.reason),
			["mention", "direct", "mention"],
		)
		assert.strictEqual(itemsOfTab(rows, "all").length, 4)
		const groups = groupByTime(rows, NOW).map((group) => group.label)
		assert.strictEqual(groups[0], "Today")
		assert.include(["Yesterday", "This week", "Older"], groups.at(-1))
	})
})
