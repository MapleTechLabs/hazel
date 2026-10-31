import { describe, expect, it } from "@effect/vitest"
import type { T3Item, T3Read, T3Waited } from "@hazel/integrations/t3code"
import { T3CodeUnreachableError } from "@hazel/integrations/t3code"
import type { ChannelId } from "@hazel/schema"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import {
	answersFrom,
	type ChatPort,
	followThread,
	type LiveMessage,
	type Mcp,
	type T3Run,
	viewOf,
} from "./runner"

const thread = "thread-1" as ChannelId

const baseRun: T3Run = {
	organizationId: "org",
	ownerId: "alice",
	threadChannelId: thread,
	t3ThreadId: "t3-thread",
	link: "https://mac.t3.example/env/t3-thread",
	projectTitle: "hazel",
	environmentLabel: "Alice's MacBook",
	cursor: null,
	pendingQuestion: null,
	notifiedApprovals: [],
}

const item = (position: number, fields: Partial<T3Item> & Pick<T3Item, "type">): T3Item => ({
	position,
	itemId: `item-${position}`,
	runId: "run-1",
	status: "completed",
	title: null,
	text: "",
	...fields,
})

const readOf = (items: ReadonlyArray<T3Item>, activeRunId: string | null = null): T3Read => ({
	thread: { threadId: "t3-thread", title: "t", status: "idle", activeRunId, latestRunId: "run-1" },
	items,
	nextPosition: items.at(-1)?.position ?? null,
	hasMore: false,
})

/** A T3 thread scripted as wait results and the activity after each `afterPosition`. */
const scripted = (script: {
	readonly waits: ReadonlyArray<T3Waited | "offline">
	/** Each read's items; `{ items, active }` while the run is still going. */
	readonly reads: ReadonlyArray<
		ReadonlyArray<T3Item> | { readonly items: ReadonlyArray<T3Item>; readonly active: string }
	>
	readonly questions?: ReadonlyArray<string>
}) => {
	const calls = { reads: [] as Array<number | undefined> }
	let waitIndex = 0
	let readIndex = 0
	const mcp: Mcp = {
		wait: () =>
			Effect.suspend(() => {
				const next = script.waits[Math.min(waitIndex++, script.waits.length - 1)]!
				return next === "offline"
					? Effect.fail(new T3CodeUnreachableError({ message: "offline" }))
					: Effect.succeed(next)
			}) as Mcp["wait"] extends (...args: any) => infer R ? R : never,
		read: (input) =>
			Effect.sync(() => {
				calls.reads.push(input.afterPosition)
				const next = script.reads[Math.min(readIndex++, script.reads.length - 1)] ?? []
				return "items" in next ? readOf(next.items, next.active) : readOf(next)
			}) as Mcp["read"] extends (...args: any) => infer R ? R : never,
		pendingQuestions: () => Effect.succeed(script.questions ?? []) as never,
		readQuestion: (_thread, requestId) =>
			Effect.succeed({
				requestId,
				questions: [
					{
						id: "q1",
						question: "Which database?",
						options: [{ label: "SQLite" }, { label: "D1" }],
					},
				],
			}) as never,
	}
	return { mcp, calls }
}

const recordingChat = () => {
	const log: Array<string> = []
	const posts: Array<string> = []
	const saved: Array<Partial<T3Run>> = []
	let steps = 0
	const live: LiveMessage = {
		setText: (text) => Effect.sync(() => void log.push(`text:${text}`)),
		startToolCall: (name, input) =>
			Effect.sync(() => {
				log.push(`tool:${name}:${JSON.stringify(input)}`)
				return `step-${++steps}`
			}),
		startThinking: () =>
			Effect.sync(() => {
				log.push("thinking")
				return `step-${++steps}`
			}),
		updateStepContent: (id, content) => Effect.sync(() => void log.push(`content:${id}:${content}`)),
		completeStep: (id, result) =>
			Effect.sync(() => void log.push(`done:${id}:${JSON.stringify(result ?? {})}`)),
		complete: () => Effect.sync(() => void log.push("complete")),
		fail: (error) => Effect.sync(() => void log.push(`fail:${error}`)),
	}
	const chat: ChatPort = {
		post: (_channel, content) => Effect.sync(() => void posts.push(content)),
		live: () => Effect.sync(() => (log.push("live"), live)),
		updateRun: (patch) => Effect.sync(() => void saved.push(patch)),
	}
	return { chat, log, posts, saved }
}

const waited = (status: string, timedOut = false): T3Waited => ({
	threadId: "t3-thread",
	runId: "run-1",
	status,
	timedOut,
})

describe("followThread", () => {
	it.effect("mirrors a run's activity into one live message and finishes with the reply", () =>
		Effect.gen(function* () {
			const { mcp, calls } = scripted({
				waits: [waited("running", true), waited("completed")],
				reads: [
					{
						active: "run-1",
						items: [
							item(1, { type: "user_message", text: "Fix the test" }),
							item(2, { type: "reasoning", text: "Looking at the test", status: "completed" }),
							item(3, {
								type: "command_execution",
								text: "$ bun test\nrunning…",
								status: "running",
							}),
						],
					},
					[
						item(3, {
							type: "command_execution",
							text: "$ bun test\n1 passed",
							status: "completed",
						}),
						item(4, { type: "assistant_message", text: "Fixed: the clock was not mocked." }),
					],
				],
			})
			const { chat, log, saved } = recordingChat()
			const final = yield* followThread({ mcp, chat, run: baseRun, takePoke: Effect.succeed(false) })

			expect(log).toEqual([
				"live",
				"thinking",
				"content:step-1:Looking at the test",
				"done:step-1:{}",
				'tool:Run command:{"command":"bun test"}',
				'done:step-2:{"output":"1 passed"}',
				"text:Fixed: the clock was not mocked.",
				"complete",
			])
			// The unfinished command kept the cursor before it, so it was read again.
			expect(calls.reads).toEqual([undefined, 2])
			expect(final.cursor).toBe(4)
			expect(saved.filter((patch) => "cursor" in patch).at(-1)?.cursor).toBe(4)
		}),
	)

	it.effect("points the owner at T3 Code for an approval, once", () =>
		Effect.gen(function* () {
			const approval = item(2, {
				type: "approval_request",
				text: "Run rm -rf build?",
				status: "pending",
			})
			const { mcp } = scripted({
				waits: [waited("waiting", true), waited("waiting", true), waited("completed")],
				reads: [
					{ items: [approval], active: "run-1" },
					{ items: [approval], active: "run-1" },
					[item(3, { type: "assistant_message", text: "Done" })],
				],
			})
			const { chat, posts } = recordingChat()
			yield* followThread({ mcp, chat, run: baseRun, takePoke: Effect.succeed(false) })
			expect(posts).toHaveLength(1)
			expect(posts[0]).toContain("Waiting for approval in T3 Code")
			expect(posts[0]).toContain("Run rm -rf build?")
			expect(posts[0]).toContain("@[userId:alice]")
			expect(posts[0]).toContain(baseRun.link!)
		}),
	)

	it.effect("posts the agent's question and keeps it for the next reply", () =>
		Effect.gen(function* () {
			const { mcp } = scripted({
				waits: [waited("waiting", true), waited("waiting", true), waited("completed")],
				reads: [[], [], []],
				questions: ["req-1"],
			})
			const { chat, posts, saved } = recordingChat()
			const final = yield* followThread({ mcp, chat, run: baseRun, takePoke: Effect.succeed(false) })
			expect(posts).toEqual([expect.stringContaining("Which database?")])
			expect(posts[0]).toContain("- SQLite")
			expect(final.pendingQuestion).toEqual({ requestId: "req-1", questionIds: ["q1"] })
			expect(saved.some((patch) => patch.pendingQuestion?.requestId === "req-1")).toBe(true)
		}),
	)

	it.effect("fails the live message when the run fails", () =>
		Effect.gen(function* () {
			const { mcp } = scripted({
				waits: [waited("failed")],
				reads: [[item(1, { type: "command_execution", text: "$ make\nerror", status: "failed" })]],
			})
			const { chat, log } = recordingChat()
			yield* followThread({ mcp, chat, run: baseRun, takePoke: Effect.succeed(false) })
			expect(log).toContain('done:step-1:{"error":"error"}')
			expect(log.at(-1)).toBe("fail:The run failed.")
		}),
	)

	it.effect("waits out an offline machine, saying so once", () =>
		Effect.gen(function* () {
			const { mcp } = scripted({
				waits: ["offline", "offline", waited("completed")],
				reads: [[item(1, { type: "assistant_message", text: "Back" })]],
			})
			const { chat, posts, log } = recordingChat()
			const fiber = yield* followThread({
				mcp,
				chat,
				run: baseRun,
				takePoke: Effect.succeed(false),
			}).pipe(Effect.forkChild)
			yield* TestClock.adjust("2 minutes")
			yield* Fiber.join(fiber)
			expect(posts).toEqual([expect.stringContaining("is not answering")])
			expect(log.at(-1)).toBe("complete")
		}),
	)
})

describe("followThread across runs", () => {
	it.effect("keeps following when a follow-up was sent as the run ended", () =>
		Effect.gen(function* () {
			const { mcp } = scripted({
				waits: [waited("completed"), waited("completed")],
				reads: [
					[item(1, { type: "assistant_message", text: "First" })],
					[item(2, { type: "assistant_message", text: "Second", runId: "run-2" })],
				],
			})
			const { chat, log } = recordingChat()
			let pokes = 1
			yield* followThread({
				mcp,
				chat,
				run: baseRun,
				takePoke: Effect.sync(() => pokes-- > 0),
			})
			// One message per run, each finished.
			expect(log.filter((entry) => entry === "live")).toHaveLength(2)
			expect(log).toContain("text:Second")
			expect(log.at(-1)).toBe("complete")
		}),
	)

	it.effect("does not let a stuck item of a finished run hold the cursor", () =>
		Effect.gen(function* () {
			const { mcp } = scripted({
				waits: [waited("completed")],
				reads: [
					[
						item(5, {
							type: "command_execution",
							text: "$ sleep 999",
							status: "running",
							runId: "run-0",
						}),
						item(6, { type: "assistant_message", text: "Done" }),
					],
				],
			})
			const { chat, log } = recordingChat()
			const final = yield* followThread({ mcp, chat, run: baseRun, takePoke: Effect.succeed(false) })
			expect(final.cursor).toBe(6)
			// The old run's item is not shown either.
			expect(log.some((entry) => entry.includes("sleep 999"))).toBe(false)
		}),
	)
})

describe("viewOf", () => {
	it("hides the prompt and shows unknown items as named steps", () => {
		expect(viewOf(item(1, { type: "user_message", text: "hi" }))._tag).toBe("hidden")
		expect(
			viewOf(item(1, { type: "web_search", title: "Search docs", text: "effect schedule" })),
		).toMatchObject({
			_tag: "step",
			name: "Search docs",
		})
	})
})

describe("answersFrom", () => {
	it("answers one question with the reply, several with one line each", () => {
		expect(answersFrom(["q1"], "  D1 please \n")).toEqual({ q1: "D1 please" })
		expect(answersFrom(["a", "b"], "SQLite\n\nyes")).toEqual({ a: "SQLite", b: "yes" })
	})
})
