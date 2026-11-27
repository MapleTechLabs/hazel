// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene, Story } from "@effect/ui/testing"
import { assert, describe, it } from "@effect/vitest"
import { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { Navigate, ShowToast } from "../../app/requests"
import type { Session } from "../../app/session"
import {
	MarkAllChannelsRead,
	MarkChannelRead,
	NotificationsMessage,
	NotificationsPage,
	type NotificationsProps,
} from "./NotificationsPage"
import { type UnreadChannel, unreadChannelDetail, unreadChannelTitle, visibleUnreadChannels } from "./unreads"

const NOW = Date.parse("2026-11-26T15:00:00.000Z")
const MINUTE = 60_000
const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")

const session: Session = {
	auth: "SignedIn",
	user: {
		id: UserId.make("00000002-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

const props = (overrides: Partial<NotificationsProps> = {}): NotificationsProps => ({
	session,
	tab: "unreads",
	nowMs: NOW,
	isMobile: false,
	...overrides,
})

const channel = (n: number, overrides: Partial<UnreadChannel> = {}): UnreadChannel => ({
	channelId: ChannelId.make(`00000005-0000-4000-8000-${n.toString(16).padStart(12, "0")}`),
	name: `channel-${n}`,
	type: "public",
	mentionCount: n,
	lastMessageAtMs: NOW - n * MINUTE,
	mutedUntilMs: null,
	...overrides,
})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const item = (title: string) => byProp("item", "title", title)
// The Unreads query's subscription key, as the instance reports it.
const UNREADS = `unreadChannels:"${organizationId}","${session.user?.id}"`
const spinner = byProp("progress", "label", "Loading...")

describe("notifications page", () => {
	test("Mentions and All are the Activity screen, under the tab's header", () => {
		Scene.start(NotificationsPage, props({ tab: "mentions" }))
			.expect(byProp("heading", "level", "1"))
			.toExist()
			.expect(spinner)
			.toBeAbsent()
	})

	test("Unreads loads, then lists the unread channels with their mentions", () => {
		const s = Scene.start(NotificationsPage, props())
		s.expect(spinner).toExist()
		s.subscription(
			UNREADS,
			NotificationsMessage.UpdatedUnreadChannels({ channels: [channel(2), channel(1)] }),
		)
			.expect(item("#channel-1"))
			.toExist()
		expect(s.get(item("#channel-2")).props).toMatchObject({
			subtitle: "2 mentions",
			badge: 2,
			unread: "dot",
		})
		s.expect(button("Mark all as read")).toExist()
	})

	test("an empty Unreads says so, and has nothing to mark", () => {
		Scene.start(NotificationsPage, props())
			.subscription(UNREADS, NotificationsMessage.UpdatedUnreadChannels({ channels: [] }))
			.expect(byProp("emptyState", "title", "No unread channels"))
			.toExist()
			.expect(button("Mark all as read"))
			.toBeAbsent()
	})

	test("a phone draws no header; the action sits over the list", () => {
		Scene.start(NotificationsPage, props({ isMobile: true }))
			.subscription(UNREADS, NotificationsMessage.UpdatedUnreadChannels({ channels: [channel(1)] }))
			.expect(byProp("heading", "level", "1"))
			.toBeAbsent()
			.expect(button("Mark all as read"))
			.toExist()
	})

	test("a row opens its channel", () => {
		const row = channel(1)
		Scene.start(NotificationsPage, props())
			.subscription(UNREADS, NotificationsMessage.UpdatedUnreadChannels({ channels: [row] }))
			.fire(item("#channel-1"), "press")
			.expectExact(Navigate.make({ href: `/hazel/chat/${row.channelId}`, replace: false }))
			.resolve(Navigate, Component.noop)
	})
})

describe("notifications page story", () => {
	it.effect("Mark as read hides the row until it syncs; a failure brings it back and says so", () =>
		Effect.gen(function* () {
			const row = channel(1)
			const s = yield* Story.make(NotificationsPage, props())
			s.send(NotificationsMessage.UpdatedUnreadChannels({ channels: [row] }))
				.send(NotificationsMessage.PressedMarkChannelRead({ channelId: row.channelId }))
				.expectExact(MarkChannelRead)
			assert.strictEqual(s.model.markedRead.length, 1)
			s.resolve(
				MarkChannelRead,
				NotificationsMessage.FailedMarkChannelRead({ channelId: row.channelId, reason: "Other" }),
			).expectExact(ShowToast)
			assert.strictEqual(s.model.markedRead.length, 0)
			s.resolve(ShowToast, Component.noop)
		}),
	)

	it.effect("Mark all as read marks every visible channel once, and puts them back on failure", () =>
		Effect.gen(function* () {
			const ids = [channel(1).channelId, channel(2).channelId]
			const s = yield* Story.make(NotificationsPage, props())
			s.send(NotificationsMessage.UpdatedUnreadChannels({ channels: [channel(1), channel(2)] }))
				.send(NotificationsMessage.PressedMarkAllRead())
				.expectExact(MarkAllChannelsRead)
			assert.deepStrictEqual(s.pending[0]?.command.args, { organizationId, channelIds: ids })
			assert.isTrue(s.model.isMarkingAllRead)
			s.resolve(
				MarkAllChannelsRead,
				NotificationsMessage.FailedMarkAllRead({ channelIds: ids }),
			).expectExact(ShowToast)
			assert.isFalse(s.model.isMarkingAllRead)
			assert.strictEqual(s.model.markedRead.length, 0)
			s.resolve(ShowToast, Component.noop)
		}),
	)
})

describe("unreads format", () => {
	it("hides muted and just-marked channels, newest first", () => {
		const rows = [channel(3), channel(1), channel(2, { mutedUntilMs: NOW + MINUTE })]
		const marked = [{ channelId: channel(3).channelId, upToMs: NOW }]
		assert.deepStrictEqual(
			visibleUnreadChannels(rows, marked, NOW).map((row) => row.name),
			["channel-1"],
		)
		assert.strictEqual(unreadChannelTitle(channel(1, { name: "", type: "single" })), "Direct message")
		assert.strictEqual(unreadChannelTitle(channel(1, { name: "", type: "thread" })), "Thread")
		assert.strictEqual(unreadChannelDetail(channel(0)), "New messages")
		assert.strictEqual(unreadChannelDetail(channel(1)), "1 mention")
	})
})
