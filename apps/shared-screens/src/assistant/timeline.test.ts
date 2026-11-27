import { AssistantItemId, AssistantThreadId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import {
	historyOf,
	isFoldOpen,
	type ItemRow,
	showsWorkingIndicator,
	sortItems,
	suggestionsFor,
	type ThreadRow,
	timelineOf,
	workSummaryOf,
	workTitleOf,
} from "./timeline"

/** How a thread reads: order, work logs, and the history menu's groups. */

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
	...overrides,
})

const entryKinds = (items: ReadonlyArray<ItemRow>) =>
	timelineOf(items).map((entry) =>
		entry._tag === "Work" ? `work(${entry.items.length})` : entry.item.kind,
	)

describe("timelineOf", () => {
	test("folds consecutive tool calls into one work log; thinking stays where it happened", () => {
		expect(
			entryKinds([
				item(1, "user"),
				item(2, "reasoning"),
				item(3, "tool"),
				item(4, "tool"),
				item(5, "reasoning"),
				item(6, "tool"),
				item(7, "assistant"),
				item(8, "question"),
			]),
		).toEqual(["user", "reasoning", "work(2)", "reasoning", "work(1)", "assistant", "question"])
	})

	test("a work log is keyed by its first item", () => {
		const [entry] = timelineOf([item(3, "tool"), item(4, "tool")])
		expect(entry?._tag === "Work" ? entry.key : null).toBe(uuid(3))
	})
})

describe("workSummaryOf", () => {
	test("reads running and failed steps", () => {
		expect(
			workSummaryOf([item(1, "tool", { status: "completed" }), item(2, "tool", { status: "running" })]),
		).toEqual({ isRunning: true, failed: 0, steps: 2 })
		expect(workSummaryOf([item(1, "tool", { status: "failed" })])).toMatchObject({ failed: 1 })
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

describe("isFoldOpen", () => {
	test("a row nobody touched is open while it runs and folded once done", () => {
		expect(isFoldOpen({}, "a", true)).toBe(true)
		expect(isFoldOpen({}, "a", false)).toBe(false)
	})

	test("a row the member opened stays open once done, and one they folded stays folded while it runs", () => {
		expect(isFoldOpen({ a: true }, "a", false)).toBe(true)
		expect(isFoldOpen({ a: false }, "a", true)).toBe(false)
	})

	test("another row's choice does not apply", () => {
		expect(isFoldOpen({ b: true }, "a", false)).toBe(false)
	})
})

describe("showsWorkingIndicator", () => {
	test("shows while the thread runs and only a reply streams", () => {
		expect(showsWorkingIndicator("running", [item(1, "assistant", { status: "running" })], false)).toBe(
			true,
		)
		expect(showsWorkingIndicator("running", [], false)).toBe(true)
	})

	test("steps aside while a thought or tool step runs: its thought line shows the work", () => {
		expect(showsWorkingIndicator("running", [item(1, "reasoning", { status: "running" })], false)).toBe(
			false,
		)
		expect(showsWorkingIndicator("running", [item(2, "tool", { status: "running" })], false)).toBe(false)
	})

	test("shows while a message is on its way, and not once the thread is idle", () => {
		expect(showsWorkingIndicator("idle", [], true)).toBe(true)
		expect(showsWorkingIndicator("idle", [], false)).toBe(false)
		expect(showsWorkingIndicator(null, [], false)).toBe(false)
	})
})

describe("workTitleOf", () => {
	test("says how many steps ran, and how many failed", () => {
		expect(workTitleOf([item(1, "tool", { status: "completed" }), item(2, "tool")])).toBe(
			"Worked · 2 steps",
		)
		expect(workTitleOf([item(1, "tool", { status: "running" })])).toBe("Working · 1 step")
		expect(workTitleOf([item(1, "tool", { status: "failed" })])).toBe("Worked · 1 step · 1 failed")
	})
})

describe("suggestionsFor", () => {
	test("adapts the suggestions to the page", () => {
		const at = (route: string) => ({ label: "", path: "/", route, entities: [] })
		expect(suggestionsFor(at("CustomerDetail"))).toContain("Summarize this customer")
		expect(suggestionsFor(at("ChatChannel"))).toContain("Summarize this channel")
		expect(suggestionsFor(null)).toHaveLength(3)
	})
})
