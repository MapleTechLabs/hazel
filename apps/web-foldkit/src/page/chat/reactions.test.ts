import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { emptyLookups } from "./lookups"
import { isLiveReactionChange, toDeriveContext, toDisplayRows, toThreadRows } from "./derive"
import type { ChatMessage, ChatReaction, DisplayRow, MessageRow } from "./rows"

/** Reaction pills in the channel list and the thread panel, and how they animate a change. */

const threadChannelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000001")
const ada = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000002")
const grace = Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000003")
const replyId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-000000000004")

const reply: ChatMessage = {
	id: replyId,
	channelId: threadChannelId,
	authorId: ada,
	content: "a reply",
	embeds: null,
	hasEmbeds: false,
	replyToMessageId: null,
	threadChannelId: null,
	createdAtMs: 0,
	updatedAtMs: null,
	isPinned: false,
	author: null,
}

const reaction = (id: string, userId: UserId, emoji = "👍"): ChatReaction => ({
	id,
	messageId: replyId,
	userId,
	emoji,
})

const context = toDeriveContext(emptyLookups, ada)

const pillsOf = (rows: ReadonlyArray<DisplayRow>) =>
	(rows.find((row) => row._tag === "MessageRow") as MessageRow).reactions

describe("thread panel reactions", () => {
	test("a reply's reactions show in the thread panel", () => {
		const rows = toThreadRows([reply], [reaction("r1", ada), reaction("r2", grace)], context, [])
		expect(pillsOf(rows)).toEqual([
			expect.objectContaining({ emoji: "👍", count: 2, hasReacted: true, motion: "none" }),
		])
	})

	test("a live reaction on a reply animates its pill", () => {
		const before = toThreadRows([reply], [], context, [])
		const after = toThreadRows([reply], [reaction("r1", grace)], context, before, true)
		expect(pillsOf(after)).toEqual([expect.objectContaining({ count: 1, motion: "enter" })])
	})
})

describe("reaction motion", () => {
	const derive = (
		reactions: ReadonlyArray<ChatReaction>,
		previous: ReadonlyArray<DisplayRow>,
		isLive: boolean,
	) => toDisplayRows([reply], reactions, context, previous, isLive)

	test("a row seen for the first time animates nothing", () => {
		expect(pillsOf(derive([reaction("r1", ada)], [], true))[0]!.motion).toBe("none")
	})

	test("a load (not live) animates nothing", () => {
		const empty = derive([], [], false)
		expect(pillsOf(derive([reaction("r1", ada)], empty, false))[0]!.motion).toBe("none")
	})

	test("the count's direction picks the roll, and an unrelated re-derive keeps it", () => {
		const one = derive([reaction("r1", ada)], derive([], [], false), true)
		const two = derive([reaction("r1", ada), reaction("r2", grace)], one, true)
		expect(pillsOf(two)[0]!.motion).toBe("up")
		const rederived = derive([reaction("r1", ada), reaction("r2", grace)], two, false)
		expect(pillsOf(rederived)[0]!.motion).toBe("up")
		const down = derive([reaction("r2", grace)], rederived, true)
		expect(pillsOf(down)[0]!.motion).toBe("down")
	})

	test("a burst of changes is a sync catching up, not someone reacting", () => {
		const burst = ["a", "b", "c", "d"].map((id) => reaction(id, grace, id))
		expect(isLiveReactionChange([], burst.slice(0, 1))).toBe(true)
		expect(isLiveReactionChange([], burst)).toBe(false)
	})
})
