import { MessageId } from "@hazel/schema"
import { Effect, Fiber, Ref, Schema, Stream } from "effect"
import { describe, expect, test, vi } from "vitest"
import { liveRepliesStream } from "./live-state"
import { rivet } from "./rivet-fake.test-support"

/** The live reply streams against a fake Rivet client: per-reply failures and keyed connections. */

vi.mock("~/lib/rivet-client", () => import("./rivet-fake.test-support"))

const messageIdOf = (n: number) =>
	Schema.decodeSync(MessageId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`)

describe("live reply streams", () => {
	test("a reply whose connection or state fetch fails does not stop the others", async () => {
		const broken = String(messageIdOf(1))
		const stateless = String(messageIdOf(2))
		rivet.brokenConnect.add(broken)
		rivet.brokenState.add(stateless)
		const ids = [messageIdOf(1), messageIdOf(2), messageIdOf(3)]
		const chunks = await Effect.runPromise(
			liveRepliesStream(() => ids).pipe(
				Stream.filter((message) => message.event._tag === "TextChunk"),
				Stream.take(2),
				Stream.runCollect,
			),
		)
		expect(chunks.map((message) => message.messageId).sort()).toEqual([messageIdOf(2), messageIdOf(3)].sort())
	})

	test("a reply joining the set connects alone; the running ones are not reconnected", async () => {
		rivet.connects.length = 0
		const first = messageIdOf(10)
		const second = messageIdOf(11)
		const program = Effect.gen(function* () {
			const ids = yield* Ref.make<ReadonlyArray<typeof first>>([first])
			const fiber = yield* liveRepliesStream(() => Ref.getUnsafe(ids)).pipe(
				Stream.filter((message) => message.event._tag === "TextChunk"),
				Stream.take(2),
				Stream.runCollect,
				Effect.forkChild,
			)
			yield* Effect.sleep("100 millis")
			yield* Ref.set(ids, [first, second])
			return yield* Fiber.join(fiber)
		})
		const chunks = await Effect.runPromise(program)
		expect(chunks.map((message) => message.messageId)).toEqual([first, second])
		expect(rivet.connects).toEqual([first, second])
		expect(rivet.disposed).toEqual(expect.arrayContaining([first, second]))
	})
})
