import { AssistantItemId, AssistantThreadId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { ItemRow, ThreadRow } from "./model"
import {
	firstSentenceOf,
	formatDuration,
	hasReplyStarted,
	historyOf,
	isTurnLive,
	sortItems,
	timelineOf,
	workSummaryOf,
} from "./timeline"

/** How a thread reads: order, turns and their summary lines, and the history menu's groups. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const threadId = Schema.decodeSync(AssistantThreadId)(uuid(100))
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))

const item = (n: number, kind: ItemRow["kind"], overrides: Partial<ItemRow> = {}): ItemRow => ({
	id: Schema.decodeSync(AssistantItemId)(uuid(n)),
	threadId,
	kind,
	status: null,
	title: null,
	text: "",
	input: null,
	question: null,
	createdAtMs: n,
	updatedAtMs: n,
	...overrides,
})

const turnOf = (items: ReadonlyArray<ItemRow>) => {
	const [entry] = timelineOf(items)
	if (entry?._tag !== "Turn") throw new Error("expected a turn")
	return entry.turn
}

const turnsOf = (items: ReadonlyArray<ItemRow>) =>
	timelineOf(items).map((entry) =>
		entry._tag === "User"
			? "user"
			: `turn(${entry.turn.steps.map((step) => step.kind).join(",")} | ${entry.turn.said.map((said) => said.kind).join(",")})`,
	)

describe("timelineOf", () => {
	test("everything between two of the member's messages is one turn: steps, then what it said", () => {
		expect(
			turnsOf([
				item(1, "user"),
				item(2, "reasoning"),
				item(3, "tool"),
				item(4, "tool"),
				item(5, "reasoning"),
				item(6, "tool"),
				item(7, "assistant"),
				item(8, "question"),
				item(9, "user"),
				item(10, "assistant"),
			]),
		).toEqual([
			"user",
			"turn(reasoning,tool,tool,reasoning,tool | assistant,question)",
			"user",
			"turn( | assistant)",
		])
	})

	test("a turn is keyed by its first item, and items before any message still make a turn", () => {
		const turn = turnOf([item(3, "notice"), item(4, "tool")])
		expect(turn.key).toBe(uuid(3))
		expect(turn.steps.map((step) => step.id)).toEqual([uuid(4)])
	})

	test("no items, no entries", () => {
		expect(timelineOf([])).toEqual([])
	})
})

describe("isTurnLive", () => {
	test("its steps show live while it runs, until the reply has text", () => {
		const working = turnOf([item(1, "tool", { status: "running" }), item(2, "assistant", { text: " " })])
		expect(isTurnLive(working, true)).toBe(true)
		expect(isTurnLive(working, false)).toBe(false)
		const replying = turnOf([item(1, "tool"), item(2, "assistant", { text: "Here is" })])
		expect(hasReplyStarted(replying)).toBe(true)
		expect(isTurnLive(replying, true)).toBe(false)
	})
})

describe("workSummaryOf", () => {
	test("says how long the steps took and how many there were", () => {
		expect(
			workSummaryOf([
				item(1, "reasoning", { createdAtMs: 1_000, updatedAtMs: 3_000 }),
				item(2, "tool", { createdAtMs: 3_000, updatedAtMs: 13_400, status: "completed" }),
			]),
		).toEqual({ failed: 0, steps: 2, label: "Worked for 12s · 2 steps" })
	})

	test("counts failed steps, and a quick single step still reads as a second", () => {
		expect(
			workSummaryOf([item(1, "tool", { status: "failed", createdAtMs: 5, updatedAtMs: 80 })]).label,
		).toBe("Worked for 1s · 1 step · 1 failed")
	})

	test("minutes past a minute", () => {
		expect(formatDuration(72_000)).toBe("1m 12s")
		expect(formatDuration(59_400)).toBe("59s")
	})
})

describe("firstSentenceOf", () => {
	test("the first sentence, as plain text", () => {
		expect(
			firstSentenceOf("I need to bring in the Hazel tools. The customer tools aren't loaded yet."),
		).toBe("I need to bring in the Hazel tools.")
		expect(firstSentenceOf("Is it today? Maybe.")).toBe("Is it today?")
	})

	test("a bold title line is the sentence; markdown marks are dropped", () => {
		expect(firstSentenceOf("**Checking the channels**\n\nI'll read #general first.")).toBe(
			"Checking the channels",
		)
		expect(firstSentenceOf("  \n- Reading `list_channels` output")).toBe("Reading list_channels output")
	})

	test("a decimal or a version does not end the sentence", () => {
		expect(firstSentenceOf("Version 1.2 is out. Next")).toBe("Version 1.2 is out.")
	})

	test("no text, no sentence", () => {
		expect(firstSentenceOf("   ")).toBe("")
	})
})

describe("sortItems", () => {
	test("orders by createdAt, then id", () => {
		const sorted = sortItems([
			item(3, "assistant", { createdAtMs: 5 }),
			item(2, "user", { createdAtMs: 5 }),
			item(9, "user", { createdAtMs: 1 }),
		])
		expect(sorted.map((row) => row.id)).toEqual([uuid(9), uuid(2), uuid(3)])
	})
})

describe("historyOf", () => {
	const thread = (n: number, ownerId: UserId, lastActivityAtMs: number): ThreadRow => ({
		id: Schema.decodeSync(AssistantThreadId)(uuid(n)),
		ownerId,
		ownerName: null,
		title: `Thread ${n}`,
		visibility: "organization",
		engine: "t3code",
		status: "idle",
		errorMessage: null,
		externalLink: null,
		engineLabel: null,
		lastActivityAtMs,
	})

	test("puts the member's own threads first, each group newest first", () => {
		const { own, shared } = historyOf(
			[thread(1, ada, 10), thread(2, grace, 30), thread(3, ada, 20), thread(4, grace, 5)],
			ada,
		)
		expect(own.map((row) => row.title)).toEqual(["Thread 3", "Thread 1"])
		expect(shared.map((row) => row.title)).toEqual(["Thread 2", "Thread 4"])
	})
})
