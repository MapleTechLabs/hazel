import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import * as MessageList from "../../mount/message-list"
import { likeRowsOf, marginShiftsOf } from "./derive"
import type { DisplayRow, GroupPosition, MessageRow } from "./rows"

/** Heights for rows not measured yet (a message just sent), so a new message lands where it stays. */

const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000001")
const authorId = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000002")
const messageId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-000000000003")

const row = (key: string, groupPosition: GroupPosition, content = "short line"): MessageRow => ({
	_tag: "MessageRow",
	key,
	message: {
		id: messageId,
		channelId,
		authorId,
		content,
		embeds: null,
		hasEmbeds: false,
		replyToMessageId: null,
		threadChannelId: null,
		createdAtMs: 0,
		updatedAtMs: null,
		isPinned: false,
		author: null,
	},
	groupPosition,
	reactions: [],
	author: { displayName: "Ada", avatarUrl: null, isBot: false, syncProvider: null },
	hasAuthor: true,
	status: null,
	syncedFrom: null,
	agentName: null,
	authorSide: null,
	reply: null,
	thread: null,
	attachments: [],
	refs: { mentions: [], emojis: [] },
	urlEmbeds: [],
	live: null,
	htmlRenders: [],
	isEntering: false,
})

const header = (key: string): DisplayRow => ({ _tag: "DateHeader", key, label: key })

describe("likeRowsOf", () => {
	test("a new one-line message takes the nearest measured row of its kind", () => {
		const rows = [row("a", "standalone"), row("b", "standalone"), row("new", "standalone")]
		expect(likeRowsOf(rows, { a: 72, b: 72 }, {})).toEqual({ new: { key: "b", deltaPx: 0 } })
	})

	test("rows of a kind differ by their group margins", () => {
		const rows = [row("a", "middle"), row("new", "end")]
		expect(likeRowsOf(rows, { a: 32 }, {})).toEqual({ new: { key: "a", deltaPx: 8 } })
	})

	test("the first line-only row is worked out from a measured row with the header", () => {
		// 64 = mt-2 + py-1 + header + line: the line is 24, so an `end` row is py-1 + 24 + mb-2.
		const rows = [row("a", "start"), row("new", "end")]
		const likes = likeRowsOf(rows, { a: 64 }, {})
		expect(64 + likes["new"]!.deltaPx).toBe(40)
	})

	test("a date divider takes a measured divider's height", () => {
		const rows = [header("monday"), row("a", "standalone"), header("tuesday")]
		expect(likeRowsOf(rows, { monday: 40, a: 72 }, {})).toEqual({
			tuesday: { key: "monday", deltaPx: 0 },
		})
	})

	test("rows that could wrap or draw taller keep the estimate", () => {
		const rows = [
			row("a", "standalone"),
			row("long", "standalone", "a message long enough that it may wrap onto a second line"),
			row("emoji", "standalone", "🚀"),
			row("quote", "standalone", "> quoted"),
		]
		expect(likeRowsOf(rows, { a: 72 }, {})).toEqual({})
	})

	test("an older page has no measured row above it and keeps the estimate", () => {
		const rows = [row("old", "standalone"), row("a", "standalone")]
		expect(likeRowsOf(rows, { a: 72 }, {})).toEqual({})
	})

	test("the same likes come back as the same object", () => {
		const rows = [row("a", "standalone"), row("new", "standalone")]
		const previous = likeRowsOf(rows, { a: 72 }, {})
		expect(likeRowsOf(rows, { a: 72 }, previous)).toBe(previous)
	})
})

describe("marginShiftsOf", () => {
	test("a row that a new message joins loses its bottom margin", () => {
		const before = [row("a", "standalone")]
		const after = [row("a", "start"), row("new", "end")]
		expect(marginShiftsOf(before, after)).toEqual([{ key: "a", deltaPx: -8 }])
	})

	test("a row that starts or stops starting a group is left to measure (its header changes)", () => {
		expect(marginShiftsOf([row("a", "middle")], [row("a", "start")])).toEqual([])
	})
})

describe("the list's height hints", () => {
	const list = MessageList.init({ id: "list", estimatedRowHeightPx: 80, viewportHeight: 100 })

	test("an unmeasured row is laid out at its like row's height", () => {
		const measured = { ...list, measuredHeights: { a: 72 } }
		const { model } = MessageList.setKeys(measured, ["a", "new"], [], {
			likeRowsOf: () => ({ new: { key: "a", deltaPx: -8 } }),
		})
		expect(MessageList.layoutOf(model).totalHeight).toBe(72 + 64)
	})

	test("a height shift applies before the like rows are worked out", () => {
		const measured = { ...list, keys: ["a"], measuredHeights: { a: 72 } }
		const { model } = MessageList.setKeys(measured, ["a", "new"], [], {
			heightShifts: [{ key: "a", deltaPx: -8 }],
			likeRowsOf: (heights) => {
				expect(heights["a"]).toBe(64)
				return {}
			},
		})
		expect(MessageList.layoutOf(model).totalHeight).toBe(64 + 80)
	})
})
