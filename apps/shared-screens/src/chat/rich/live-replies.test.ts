import { initialLiveState as initialServerState } from "@hazel/domain/live"
import { ChannelId, MessageId } from "@hazel/schema"
import { Effect, Fiber, Ref, Schema, Stream } from "effect"
import { describe, expect, test } from "vitest"
import {
	initialLiveState,
	LiveConnection,
	type LiveReply,
	type LiveSocket,
	liveRepliesStream,
	reduceLive,
} from "./live-replies"

/** The live reply streams against a fake socket: per-reply failures, reconnects, keyed sockets. */

const live = {
	opened: [] as Array<string>,
	closed: [] as Array<string>,
	invalidated: [] as Array<string>,
	/** Opening throws. */
	broken: new Set<string>(),
	/** Closed with 4003 (not a viewer). */
	refused: new Set<string>(),
	/** Closed with 4001 on the first open only. */
	reauthOnce: new Set<string>(),
}

/** Sockets open at once, send a snapshot and two text chunks. */
const fakeConnection: LiveConnection["Service"] = {
	readToken: () => Promise.resolve("token"),
	invalidateToken: (token) => void live.invalidated.push(token),
	open: ({ messageId }) => {
		if (live.broken.has(messageId)) throw new Error("bad url")
		live.opened.push(messageId)
		const socket: LiveSocket = {
			onopen: null,
			onmessage: null,
			onclose: null,
			onerror: null,
			close: () => void live.closed.push(messageId),
		}
		const frame = (value: unknown) => socket.onmessage?.({ data: JSON.stringify(value) })
		setTimeout(() => {
			if (live.refused.has(messageId)) return socket.onclose?.({ code: 4003 })
			if (live.reauthOnce.delete(messageId)) return socket.onclose?.({ code: 4001 })
			socket.onopen?.()
			frame({ _tag: "Snapshot", state: initialServerState })
			frame({ _tag: "TextAppended", chunk: "hi " })
			frame({ _tag: "TextAppended", chunk: messageId })
		}, 5)
		return socket
	},
}

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
		Effect.provideService(LiveConnection, fakeConnection),
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

describe("reduceLive", () => {
	test("chunks stream the text, the end and completion settle it", () => {
		const events = [
			{ _tag: "Started" },
			{ _tag: "TextChunk", fullText: "Hel" },
			{ _tag: "TextChunk", fullText: "Hello" },
			{ _tag: "StreamEnd", text: "Hello" },
			{ _tag: "Completed" },
		] as const
		const states = events.reduce<Array<typeof initialLiveState>>(
			(all, event) => [...all, reduceLive(all.at(-1) ?? initialLiveState, event)],
			[],
		)
		expect(states.map((state) => [state.status, state.text, state.isStreaming])).toEqual([
			["active", "", false],
			["active", "Hel", true],
			["active", "Hello", true],
			["active", "Hello", false],
			["completed", "Hello", false],
		])
	})
})
