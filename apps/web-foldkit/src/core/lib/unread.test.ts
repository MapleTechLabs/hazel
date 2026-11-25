import type { UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { isChannelUnread, type UnreadMember } from "./unread"

const me = "00000000-0000-4000-8000-000000000001" as UserId
const them = "00000000-0000-4000-8000-000000000002" as UserId
const at = (minute: number) => new Date(Date.UTC(2026, 10, 25, 12, minute))
const now = at(30).getTime()

const member = (overrides: Partial<UnreadMember> = {}): UnreadMember => ({
	isMuted: false,
	mutedUntil: null,
	lastReadAt: at(10),
	joinedAt: at(0),
	readStateSince: null,
	...overrides,
})

describe("isChannelUnread", () => {
	test("someone else's message after the last read is unread", () => {
		expect(isChannelUnread(member(), { lastMessageAt: at(20), lastMessageAuthorId: them }, me, now)).toBe(
			true,
		)
	})

	test("a message read past, or the user's own, is not", () => {
		expect(isChannelUnread(member(), { lastMessageAt: at(5), lastMessageAuthorId: them }, me, now)).toBe(
			false,
		)
		expect(isChannelUnread(member(), { lastMessageAt: at(20), lastMessageAuthorId: me }, me, now)).toBe(
			false,
		)
		expect(isChannelUnread(member(), undefined, me, now)).toBe(false)
	})

	test("never read: read up to joining", () => {
		const fresh = member({ lastReadAt: null, joinedAt: at(15) })
		expect(isChannelUnread(fresh, { lastMessageAt: at(12), lastMessageAuthorId: them }, me, now)).toBe(
			false,
		)
		expect(isChannelUnread(fresh, { lastMessageAt: at(20), lastMessageAuthorId: them }, me, now)).toBe(
			true,
		)
	})

	test("never read in an org older than unread state: read up to when it began", () => {
		const old = member({ lastReadAt: null, joinedAt: at(0), readStateSince: at(15) })
		expect(isChannelUnread(old, { lastMessageAt: at(12), lastMessageAuthorId: them }, me, now)).toBe(
			false,
		)
		expect(isChannelUnread(old, { lastMessageAt: at(20), lastMessageAuthorId: them }, me, now)).toBe(true)
	})

	test("muted, or muted until later, never shows unread; an expired mute does", () => {
		const activity = { lastMessageAt: at(20), lastMessageAuthorId: them }
		expect(isChannelUnread(member({ isMuted: true }), activity, me, now)).toBe(false)
		expect(isChannelUnread(member({ mutedUntil: at(40) }), activity, me, now)).toBe(false)
		expect(isChannelUnread(member({ mutedUntil: at(25) }), activity, me, now)).toBe(true)
	})
})
