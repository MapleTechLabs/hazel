import { SyncSeq } from "@hazel/domain/sync"
import { createLiveQueryCollection, eq } from "@tanstack/db"
import { Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { channelPartition, createEffectCollection } from "./collection"
import type { SyncRun } from "./connection"
import { SyncHub } from "./hub"
import {
	SNAPSHOT_WRITE_DELAY_MS,
	SourceRecorder,
	type SourceSnapshot,
	type SourceSnapshotStore,
} from "./snapshot"
import { type FakeSocket, fakeSockets } from "./testing/fake-websocket"
import type { SourceKey } from "./types"

const Message = Schema.Struct({
	id: Schema.String,
	channelId: Schema.String,
	content: Schema.String,
	createdAt: Schema.String,
})
type Message = typeof Message.Type

/** Message `n` of channel c1, one second apart. */
const message = (n: number, content = `m${n}`): Message => ({
	id: `m${String(n).padStart(3, "0")}`,
	channelId: "c1",
	content,
	createdAt: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
})
const cursorOf = (row: Message) => ({ createdAt: row.createdAt, id: row.id })
/** Messages `from` down to `to`, newest first. */
const range = (from: number, to: number) => {
	const rows: Array<Message> = []
	for (let n = from; n >= to; n--) rows.push(message(n))
	return rows
}
const windowOf = (rows: ReadonlyArray<Message>, hasMore: boolean) => ({
	table: "messages",
	oldest: rows.length === 0 ? null : cursorOf(rows.at(-1)!),
	hasMore,
})

const SOURCE: SourceKey = "channel:c1"

const run = (
	seq: number,
	tables: Record<string, { upserts?: ReadonlyArray<unknown>; deletes?: ReadonlyArray<string> }>,
	options: { reset?: boolean; page?: boolean; windows?: ReadonlyArray<ReturnType<typeof windowOf>> } = {},
): SyncRun => ({
	source: SOURCE,
	reset: options.reset ?? false,
	seq: SyncSeq.make(seq),
	tables: new Map(
		Object.entries(tables).map(([table, rows]) => [
			table,
			{ upserts: rows.upserts ?? [], deletes: rows.deletes ?? [] },
		]),
	),
	windows: new Map((options.windows ?? []).map((window) => [window.table, window])),
	page: options.page ?? false,
})

const contentsOf = (snapshot: SourceSnapshot | undefined, table = "messages") =>
	(snapshot?.tables[table] ?? []).map((row) => (row as Message).content)

describe("SourceRecorder", () => {
	const recorder = () => new SourceRecorder((table) => table !== "typing_indicators")

	it("holds nothing before the source's first snapshot", () => {
		const recording = recorder()
		expect(recording.apply(run(3, { messages: { upserts: [message(1)] } }))).toBe(false)
		expect(recording.snapshot()).toBeUndefined()
	})

	it("holds the snapshot with every change since", () => {
		const recording = recorder()
		const rows = range(3, 1)
		recording.apply(
			run(5, { messages: { upserts: rows } }, { reset: true, windows: [windowOf(rows, true)] }),
		)
		recording.apply(
			run(6, { messages: { upserts: [message(4), message(2, "edited")], deletes: [message(1).id] } }),
		)
		const snapshot = recording.snapshot()
		expect(snapshot?.seq).toBe(6)
		expect(contentsOf(snapshot)).toEqual(["m3", "edited", "m4"])
		expect(snapshot?.windows).toEqual([windowOf(rows, true)])
	})

	it("starts over at a reset", () => {
		const recording = recorder()
		recording.apply(run(5, { messages: { upserts: range(3, 1) } }, { reset: true }))
		recording.apply(run(9, { messages: { upserts: [message(7)] } }, { reset: true }))
		expect(contentsOf(recording.snapshot())).toEqual(["m7"])
	})

	it("leaves out history paged in later, and a change to a row older than the window", () => {
		const recording = recorder()
		const rows = range(10, 8)
		recording.apply(
			run(5, { messages: { upserts: rows } }, { reset: true, windows: [windowOf(rows, true)] }),
		)
		expect(recording.apply(run(5, { messages: { upserts: range(7, 6) } }, { page: true }))).toBe(false)
		// An edit of message 6, which only the page brought: it would sit below the window alone.
		recording.apply(run(6, { messages: { upserts: [message(6, "edited"), message(11)] } }))
		expect(contentsOf(recording.snapshot())).toEqual(["m10", "m9", "m8", "m11"])
	})

	it("keeps the rows a snapshot carries from below its window (older pins)", () => {
		const recording = recorder()
		const rows = range(10, 8)
		recording.apply(
			run(
				5,
				{ messages: { upserts: [...rows, message(2, "pinned")] } },
				{ reset: true, windows: [windowOf(rows, true)] },
			),
		)
		recording.apply(run(6, { messages: { upserts: [message(2, "pinned, edited")] } }))
		expect(contentsOf(recording.snapshot())).toEqual(["m10", "m9", "m8", "pinned, edited"])
	})

	it("reports no change for a run of tables it does not keep, or of rows it does not hold", () => {
		const recording = recorder()
		recording.apply(run(5, { messages: { upserts: [message(1)] } }, { reset: true }))
		expect(recording.apply(run(6, { typing_indicators: { upserts: [{ id: "t1" }] } }))).toBe(false)
		expect(recording.apply(run(7, { messages: { deletes: ["unknown"] } }))).toBe(false)
		expect(recording.apply(run(8, { messages: { deletes: [message(1).id] } }))).toBe(true)
		// The seq still follows the stream.
		expect(recording.snapshot()?.seq).toBe(8)
	})

	it("keeps only the tables it is told to, and none whose rows have no id", () => {
		const recording = recorder()
		recording.apply(
			run(
				5,
				{
					messages: { upserts: [message(1)] },
					typing_indicators: { upserts: [{ id: "t1" }] },
					keyless: { upserts: [{ channelId: "c1", userId: "u1" }] },
				},
				{ reset: true },
			),
		)
		expect(Object.keys(recording.snapshot()?.tables ?? {})).toEqual(["messages"])
	})
})

/** A store in memory, with what was asked of it. */
const memoryStore = (initial: Record<string, SourceSnapshot> = {}) => {
	const kept = new Map<string, SourceSnapshot>(Object.entries(initial))
	const store: SourceSnapshotStore = {
		keeps: (source) => source.startsWith("channel:"),
		keepsTable: (table) => table !== "typing_indicators",
		read: async (source) => kept.get(source),
		write: async (source, snapshot) => void kept.set(source, snapshot),
		remove: async (source) => void kept.delete(source),
	}
	return { store, kept }
}

const hubs: Array<SyncHub> = []
let collectionCount = 0
afterEach(() => {
	for (const hub of hubs.splice(0)) hub.close()
	vi.useRealTimers()
})

const setup = (store: SourceSnapshotStore, releaseGraceMs = 0) => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 5, maxDelayMs: 20, jitter: false },
		releaseGraceMs,
		snapshots: store,
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
	const live = createLiveQueryCollection((q) =>
		q.from({ m: messages }).where(({ m }) => eq(m.channelId, "c1")),
	)
	const socket = async (path = "/sync/channel/c1") => {
		await vi.waitFor(() => expect(sockets.count(path)).toBeGreaterThanOrEqual(1))
		return sockets.latest(path)!
	}
	return { hub, messages, live, socket }
}

/** A windowed snapshot of `rows` (newest first) from the source itself. */
const deliver = (socket: FakeSocket, seq: number, rows: ReadonlyArray<Message>, hasMore = false) => {
	if (socket.readyState === 0) socket.open()
	socket.receive({ _tag: "Begin", reset: true, windows: [windowOf(rows, hasMore)] })
	socket.receive({ _tag: "Rows", table: "messages", upserts: rows, deletes: [] })
	socket.receive({ _tag: "Commit", seq })
	socket.receive({ _tag: "Ready", paging: true })
}

const contents = (live: { toArray: ReadonlyArray<Message> }) => live.toArray.map((row) => row.content).sort()

const keptState = (rows: ReadonlyArray<Message>, hasMore = false): SourceSnapshot => ({
	seq: SyncSeq.make(5),
	tables: { messages: rows },
	windows: [windowOf(rows, hasMore)],
})

describe("kept source states", () => {
	it("writes a source's state a moment after it changes, and what it holds when it is let go", async () => {
		vi.useFakeTimers()
		const { store, kept } = memoryStore()
		const { live, socket } = setup(store)
		const ready = live.preload()
		const stream = await vi.waitFor(() => socket())
		deliver(stream, 5, range(3, 1))
		await ready
		expect(kept.size).toBe(0)
		await vi.advanceTimersByTimeAsync(SNAPSHOT_WRITE_DELAY_MS)
		expect(contentsOf(kept.get(SOURCE))).toEqual(["m3", "m2", "m1"])

		// A change, and the query going away before its write was due.
		stream.commit(6, { messages: { upserts: [message(4)] } })
		await live.cleanup()
		await vi.advanceTimersByTimeAsync(0)
		expect(kept.get(SOURCE)?.seq).toBe(6)
		expect(contentsOf(kept.get(SOURCE))).toEqual(["m3", "m2", "m1", "m4"])
	})

	it("shows the kept state before the source answers, then the source's own snapshot replaces it", async () => {
		const { store } = memoryStore({ [SOURCE]: keptState(range(3, 1), true) })
		const { live, messages, socket } = setup(store)
		// Loaded with no socket open: the rows are last load's.
		await live.preload()
		expect(contents(live)).toEqual(["m1", "m2", "m3"])
		expect(messages.utils.historyOf("c1")).toEqual({ loaded: 3, hasMore: true })
		const stream = await socket()
		expect(stream.readyState).toBe(0)

		// Since then: message 1 was deleted, 2 edited, 4 sent.
		deliver(stream, 9, [message(4), message(3), message(2, "edited")])
		expect(contents(live)).toEqual(["edited", "m3", "m4"])
		// The source asked for a snapshot: a kept state is shown, never resumed from.
		expect(stream.sent.find((frame) => frame._tag === "Hello")).toMatchObject({ since: null })
	})

	it("still makes a caller that needs the source's own snapshot wait for it", async () => {
		const { store } = memoryStore({ [SOURCE]: keptState(range(3, 1)) })
		const { hub, live, socket } = setup(store)
		await live.preload()
		const retention = hub.retain([SOURCE])
		// Shown from the kept state: settled, but the source has not delivered.
		expect(retention.isSettled()).toBe(true)
		let delivered = false
		void retention.delivered.then(() => {
			delivered = true
		})
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(delivered).toBe(false)
		deliver(await socket(), 9, [message(4)])
		await vi.waitFor(() => expect(delivered).toBe(true))
		retention.release()
	})

	it("does not show a kept state over what the source already delivered", async () => {
		const { store } = memoryStore()
		let release: (snapshot: SourceSnapshot | undefined) => void = () => {}
		const slow: SourceSnapshotStore = {
			...store,
			read: () => new Promise((resolve) => void (release = resolve)),
		}
		const { live, socket } = setup(slow)
		const ready = live.preload()
		deliver(await socket(), 9, [message(4)])
		await ready
		release(keptState(range(3, 1)))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(contents(live)).toEqual(["m4"])
	})

	it("drops the rows and the kept state of a source that refuses the user", async () => {
		const { store, kept } = memoryStore({ [SOURCE]: keptState(range(3, 1)) })
		const { live, socket } = setup(store)
		await live.preload()
		expect(contents(live)).toEqual(["m1", "m2", "m3"])
		;(await socket()).serverClose(4003)
		await vi.waitFor(() => expect(contents(live)).toEqual([]))
		await vi.waitFor(() => expect(kept.has(SOURCE)).toBe(false))
	})

	it("keeps nothing of a source the store does not name", async () => {
		vi.useFakeTimers()
		const { store, kept } = memoryStore()
		const read = vi.spyOn(store, "read")
		const { hub } = setup(store)
		const lease = hub.acquireKey("org:a")
		const stream = await vi.waitFor(async () => {
			await vi.advanceTimersByTimeAsync(1)
			return lease.connection
		})
		expect(stream.source).toBe("org:a")
		await vi.advanceTimersByTimeAsync(SNAPSHOT_WRITE_DELAY_MS)
		expect(read).not.toHaveBeenCalled()
		expect(kept.size).toBe(0)
		lease.release()
	})

	it("only costs the head start when the store fails", async () => {
		const { store } = memoryStore()
		const failing: SourceSnapshotStore = {
			...store,
			read: () => Promise.reject(new Error("no storage")),
			write: () => Promise.reject(new Error("no storage")),
		}
		const { live, socket } = setup(failing)
		const ready = live.preload()
		deliver(await socket(), 9, [message(4)])
		await ready
		expect(contents(live)).toEqual(["m4"])
	})
})
