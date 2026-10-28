import { ChannelId, MessageId } from "@hazel/schema"
import { Effect, Fiber, Ref, Schema, Stream } from "effect"
import { describe, expect, test, vi } from "vitest"
import { type LiveReply, liveRepliesStream } from "./live-state"
import { live } from "./live-socket-fake.test-support"

/** The live reply streams against a fake socket: per-reply failures, reconnects, keyed sockets. */

vi.mock("~/lib/live-socket", () => import("./live-socket-fake.test-support"))

const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-000000000999")
const replyOf = (n: number): LiveReply => ({
	messageId: Schema.decodeSync(MessageId)(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`),
	channelId,
})

const textChunks = (replies: () => ReadonlyArray<LiveReply>, count: number) =>
	liveRepliesStream(replies).pipe(
		Stream.filter((message) => message.event._tag === "TextChunk"),
		Stream.take(count),
		Stream.runCollect,
	)

describe("live reply streams", () => {
	test("a snapshot then chunks: each chunk carries the whole text so far", async () => {
		const reply = replyOf(5)
		const chunks = await Effect.runPromise(textChunks(() => [reply], 2))
		expect(chunks.map((message) => message.event)).toEqual([
			{ _tag: "TextChunk", fullText: "hi " },
			{ _tag: "TextChunk", fullText: `hi ${reply.messageId}` },
		])
	})

	test("a reply whose socket cannot open or is refused does not stop the others", async () => {
		const [broken, refused, ok] = [replyOf(1), replyOf(2), replyOf(3)]
		live.broken.add(broken.messageId)
		live.refused.add(refused.messageId)
		const chunks = await Effect.runPromise(textChunks(() => [broken, refused, ok], 2))
		expect(new Set(chunks.map((message) => message.messageId))).toEqual(new Set([ok.messageId]))
		// A refused reader (4003) is not retried.
		expect(live.opened.filter((id) => id === refused.messageId)).toHaveLength(1)
	})

	test("a refused token (4001) is dropped and the socket reconnects", async () => {
		const reply = replyOf(7)
		live.reauthOnce.add(reply.messageId)
		const chunks = await Effect.runPromise(textChunks(() => [reply], 1))
		expect(chunks).toHaveLength(1)
		expect(live.invalidated).toContain("token")
		expect(live.opened.filter((id) => id === reply.messageId)).toHaveLength(2)
	})

	test("a reply joining the set connects alone; the running ones are not reconnected", async () => {
		live.opened.length = 0
		const first = replyOf(10)
		const second = replyOf(11)
		const program = Effect.gen(function* () {
			const replies = yield* Ref.make<ReadonlyArray<LiveReply>>([first])
			const fiber = yield* textChunks(() => Ref.getUnsafe(replies), 3).pipe(Effect.forkChild)
			yield* Effect.sleep("100 millis")
			yield* Ref.set(replies, [first, second])
			return yield* Fiber.join(fiber)
		})
		const chunks = await Effect.runPromise(program)
		expect(chunks.map((message) => message.messageId)).toEqual([
			first.messageId,
			first.messageId,
			second.messageId,
		])
		expect(live.opened).toEqual([first.messageId, second.messageId])
		expect(live.closed).toEqual(expect.arrayContaining([first.messageId, second.messageId]))
	})
})
