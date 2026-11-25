// @vitest-environment jsdom
import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { userId, uuid } from "../../../test/pages-fixtures"
import { toUnreadChannels, type UnreadChannelRow } from "./subscription"

/** The Unreads derivation: the joined rows the user has not read, as the tab's items. */

const other = Schema.decodeSync(UserId)(uuid(77))
const at = (ms: number) => new Date(ms)

const row = (n: number, fields: Partial<UnreadChannelRow> = {}): UnreadChannelRow => ({
	channelId: Schema.decodeSync(ChannelId)(uuid(800 + n)),
	name: `channel-${n}`,
	type: "public",
	notificationCount: 0,
	isMuted: false,
	mutedUntil: null,
	joinedAt: at(1_000),
	lastReadAt: at(5_000),
	readStateSince: null,
	lastMessageAt: at(6_000),
	lastMessageAuthorId: other,
	...fields,
})

describe("toUnreadChannels", () => {
	test("a muted section or organization hides the channel; a timed one ends with the latest mute", () => {
		expect(toUnreadChannels([row(1, { sectionMuted: true })], userId)).toEqual([])
		expect(toUnreadChannels([row(2, { orgMuted: true })], userId)).toEqual([])
		// A DM takes no section or organization setting.
		expect(toUnreadChannels([row(3, { type: "single", orgMuted: true })], userId)).toHaveLength(1)
		const [timed] = toUnreadChannels(
			[row(4, { mutedUntil: at(7_000), sectionMutedUntil: at(9_000), orgMutedUntil: null })],
			userId,
		)
		expect(timed?.mutedUntilMs).toBe(9_000)
	})

	test("keeps channels where someone else wrote after the read position, with their mentions", () => {
		const unread = row(1, { notificationCount: 2, mutedUntil: at(9_000) })
		expect(toUnreadChannels([unread], userId)).toEqual([
			{
				channelId: unread.channelId,
				name: "channel-1",
				type: "public",
				mentionCount: 2,
				lastMessageAtMs: 6_000,
				mutedUntilMs: 9_000,
			},
		])
	})

	test("drops channels read past their newest message, or whose newest message is the user's own", () => {
		const read = row(2, { lastReadAt: at(6_000) })
		const own = row(3, { lastMessageAuthorId: userId })
		expect(toUnreadChannels([read, own], userId)).toEqual([])
	})

	test("never read: read up to joining, or to when unread state began if later", () => {
		const joinedBefore = row(4, { lastReadAt: undefined, joinedAt: at(1_000) })
		const sinceAfter = row(5, { lastReadAt: null, readStateSince: at(7_000) })
		expect(toUnreadChannels([joinedBefore, sinceAfter], userId).map((c) => c.channelId)).toEqual([
			joinedBefore.channelId,
		])
	})
})
