import { createLiveQueryCollection, eq } from "@tanstack/db"
import { Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { channelPartition, createEffectCollection } from "./collection"
import { SyncHub } from "./hub"
import { type FakeSocket, fakeSockets } from "./testing/fake-websocket"

const Message = Schema.Struct({
	id: Schema.String,
	channelId: Schema.String,
	content: Schema.String,
	createdAt: Schema.String,
})
type Message = typeof Message.Type

const hubs: Array<SyncHub> = []
let collectionCount = 0

afterEach(() => {
	for (const hub of hubs.splice(0)) hub.close()
})

/** Message `n` of channel c1, one second apart. */
const message = (n: number, content = `m${n}`): Message => ({
	id: `m${String(n).padStart(3, "0")}`,
	channelId: "c1",
	content,
	createdAt: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
})

const cursorOf = (row: Message) => ({ createdAt: row.createdAt, id: row.id })

const setup = () => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 5, maxDelayMs: 20, jitter: false },
		releaseGraceMs: 0,
		log: vi.fn(),
	})
	hubs.push(hub)
	const messages = createEffectCollection({
		id: `messages-${++collectionCount}`,
		table: "messages",
		schema: Message,
		getKey: (row) => row.id,
		hub,
		sources: channelPartition(),
	})
	return { sockets, hub, messages }
}

const socketFor = async (sockets: ReturnType<typeof fakeSockets>, count = 1) => {
	await vi.waitFor(() => expect(sockets.count("/sync/channel/c1")).toBeGreaterThanOrEqual(count))
	return sockets.latest("/sync/channel/c1")!
}

/** A windowed snapshot of `rows` (newest first); `hasMore` says older ones exist. */
const snapshot = (socket: FakeSocket, seq: number, rows: ReadonlyArray<Message>, hasMore: boolean) => {
	if (socket.readyState === 0) socket.open()
	socket.receive({
		_tag: "Begin",
		reset: true,
		windows: [{ table: "messages", oldest: rows.length === 0 ? null : cursorOf(rows.at(-1)!), hasMore }],
	})
	socket.receive({ _tag: "Rows", table: "messages", upserts: rows, deletes: [] })
	socket.receive({ _tag: "Commit", seq })
	socket.receive({ _tag: "Ready" })
}

const loadOlderFrames = (socket: FakeSocket) => socket.sent.filter((frame) => frame._tag === "LoadOlder")

/** Answers the last `LoadOlder` with `rows` (newest first). */
const answerPage = (socket: FakeSocket, seq: number, rows: ReadonlyArray<Message>, hasMore: boolean) => {
	const request = loadOlderFrames(socket).at(-1)!
	socket.receive({
		_tag: "Begin",
		reset: false,
		request: request.requestId,
		windows: [
			{
				table: "messages",
				oldest: rows.length === 0 ? request.before : cursorOf(rows.at(-1)!),
				hasMore,
			},
		],
	})
	socket.receive({ _tag: "Rows", table: "messages", upserts: rows, deletes: [] })
	socket.receive({ _tag: "Commit", seq })
}

const range = (from: number, to: number) => {
	const rows: Array<Message> = []
	for (let n = from; n >= to; n--) rows.push(message(n))
	return rows
}

const channelQuery = (messages: ReturnType<typeof setup>["messages"]) =>
	createLiveQueryCollection((q) => q.from({ m: messages }).where(({ m }) => eq(m.channelId, "c1")))

describe("paged history", () => {
	it("loadOlder pages from the window's start; paged rows survive later deltas", async () => {
		const { sockets, messages } = setup()
		const live = channelQuery(messages)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(10, 8), true)
		await ready
		expect(messages.utils.historyOf("c1")).toEqual({ loaded: 3, hasMore: true })

		const more = messages.utils.loadOlder("c1", 2)
		expect(loadOlderFrames(socket)).toEqual([
			{ _tag: "LoadOlder", requestId: 1, table: "messages", before: cursorOf(message(8)), limit: 2 },
		])
		answerPage(socket, 5, range(7, 6), true)
		expect(await more).toBe(true)
		expect(messages.utils.historyOf("c1")).toEqual({ loaded: 5, hasMore: true })

		// A live delta for another row leaves the paged rows alone; an edit of a paged row applies.
		socket.commit(6, { messages: { upserts: [message(11), message(6, "edited")] } })
		expect(live.size).toBe(6)
		expect(messages.get(message(6).id)?.content).toBe("edited")
		await live.cleanup()
	})

	it("drops live upserts of rows below the window it does not hold", async () => {
		const { sockets, messages } = setup()
		const live = channelQuery(messages)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(10, 8), true)
		await ready

		socket.commit(6, { messages: { upserts: [message(2, "old edit")] } })
		expect(messages.has(message(2).id)).toBe(false)
		// Once paged in, the same row takes edits.
		void messages.utils.loadOlder("c1")
		answerPage(socket, 6, range(7, 1), false)
		socket.commit(7, { messages: { upserts: [message(2, "old edit")] } })
		expect(messages.get(message(2).id)?.content).toBe("old edit")
		// The history is whole: nothing is below the window any more.
		socket.commit(8, { messages: { upserts: [message(0)] } })
		expect(messages.has(message(0).id)).toBe(true)
		expect(await messages.utils.loadOlder("c1")).toBe(false)
		await live.cleanup()
	})

	it("retainHistory pages until the demand is met and pages again after a reset", async () => {
		const { sockets, messages } = setup()
		const live = channelQuery(messages)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(20, 18), true)
		await ready

		const demand = messages.utils.retainHistory("c1", 6)
		expect(loadOlderFrames(socket)).toHaveLength(1)
		answerPage(socket, 5, range(17, 16), true)
		// Still short of 6: the next page goes out on its own.
		await vi.waitFor(() => expect(loadOlderFrames(socket)).toHaveLength(2))
		expect(loadOlderFrames(socket)[1]!.before).toEqual(cursorOf(message(16)))
		answerPage(socket, 5, range(15, 14), true)
		await demand.settled
		expect(messages.utils.historyOf("c1")?.loaded).toBe(7)

		// A reset drops the pages; the held demand asks for them again from the new window.
		snapshot(socket, 9, range(22, 20), true)
		expect(messages.has(message(16).id)).toBe(false)
		await vi.waitFor(() => expect(loadOlderFrames(socket)).toHaveLength(3))
		expect(loadOlderFrames(socket)[2]!.before).toEqual(cursorOf(message(20)))
		answerPage(socket, 9, range(19, 17), true)
		expect(messages.utils.historyOf("c1")?.loaded).toBe(6)

		// Released: a reset no longer pages.
		demand.release()
		snapshot(socket, 10, range(22, 20), true)
		await new Promise((resolve) => setTimeout(resolve, 5))
		expect(loadOlderFrames(socket)).toHaveLength(3)
		await live.cleanup()
	})

	it("an unbounded demand (a thread panel) pages the whole history in", async () => {
		const { sockets, messages } = setup()
		const live = channelQuery(messages)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(20, 18), true)
		await ready

		const demand = messages.utils.retainHistory("c1", Number.POSITIVE_INFINITY)
		expect(loadOlderFrames(socket)[0]!.limit).toBe(200)
		answerPage(socket, 5, range(17, 10), true)
		await vi.waitFor(() => expect(loadOlderFrames(socket)).toHaveLength(2))
		answerPage(socket, 5, range(9, 0), false)
		await demand.settled
		expect(messages.utils.historyOf("c1")).toEqual({ loaded: 21, hasMore: false })
		expect(loadOlderFrames(socket)).toHaveLength(2)
		demand.release()
		await live.cleanup()
	})

	it("drops a page a reset overtook", async () => {
		const { sockets, messages } = setup()
		const live = channelQuery(messages)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(10, 8), true)
		await ready

		const page = messages.utils.loadOlder("c1", 2)
		const stale = loadOlderFrames(socket)[0]!
		snapshot(socket, 6, range(12, 10), true)
		expect(await page).toBe(true)
		// The answer to the request sent before the reset arrives after it: its rows would leave a gap.
		socket.receive({
			_tag: "Begin",
			reset: false,
			request: stale.requestId,
			windows: [{ table: "messages", oldest: cursorOf(message(6)), hasMore: true }],
		})
		socket.receive({ _tag: "Rows", table: "messages", upserts: range(7, 6), deletes: [] })
		socket.receive({ _tag: "Commit", seq: 6 })
		expect(messages.has(message(7).id)).toBe(false)
		expect(messages.utils.historyOf("c1")).toEqual({ loaded: 3, hasMore: true })
		await live.cleanup()
	})

	it("an ordered, limited query past the snapshot loads older pages through loadSubset", async () => {
		const { sockets, messages } = setup()
		const live = createLiveQueryCollection((q) =>
			q
				.from({ m: messages })
				.where(({ m }) => eq(m.channelId, "c1"))
				.orderBy(({ m }) => m.createdAt, "desc")
				.limit(5),
		)
		const ready = live.preload()
		const socket = await socketFor(sockets)
		snapshot(socket, 5, range(10, 8), true)
		await vi.waitFor(() => expect(loadOlderFrames(socket).length).toBeGreaterThan(0))
		answerPage(socket, 5, range(7, 3), true)
		await ready
		await vi.waitFor(() =>
			expect(live.toArray.map((row) => row.id)).toEqual(range(10, 6).map((row) => row.id)),
		)
		await live.cleanup()
	})
})
