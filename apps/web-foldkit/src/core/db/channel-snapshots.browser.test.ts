/**
 * The channels' kept states in Chromium, on IndexedDB: what the unit tests run against a store in
 * memory, here against the browser's own, through a hub and a message collection.
 */
import { SyncSeq } from "@hazel/domain/sync"
import {
	channelPartition,
	createEffectCollection,
	type SourceKey,
	type SourceSnapshot,
	SyncHub,
} from "@hazel/effect-db-collection"
import { fakeSockets } from "@hazel/effect-db-collection/testing"
import { UserId } from "@hazel/schema"
import { createLiveQueryCollection, eq } from "@tanstack/db"
import { Schema } from "effect"
import { afterEach, describe, expect, test, vi } from "vitest"
import { makeAppChannelSnapshots, MAX_KEPT_CHANNELS, openIdbBackend } from "./channel-snapshots"

const Message = Schema.Struct({
	id: Schema.String,
	channelId: Schema.String,
	content: Schema.String,
	createdAt: Schema.String,
})
type Message = typeof Message.Type

const message = (n: number, content = `m${n}`): Message => ({
	id: `m${String(n).padStart(3, "0")}`,
	channelId: "c1",
	content,
	createdAt: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(),
})

const newUser = () => UserId.make(crypto.randomUUID())
const snapshotOf = (content: string): SourceSnapshot => ({
	seq: SyncSeq.make(5),
	tables: { messages: [message(1, content)] },
	windows: [
		{ table: "messages", oldest: { createdAt: message(1).createdAt, id: message(1).id }, hasMore: false },
	],
})

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const databaseNames = async () => (await indexedDB.databases()).map(({ name }) => name)

describe("the IndexedDB backend", () => {
	test("stores, replaces and removes a channel's state, and deletes its database", async () => {
		const userId = newUser()
		const backend = await openIdbBackend(userId)
		await expect(backend.get("channel:c1")).resolves.toBeUndefined()
		await backend.put("channel:c1", snapshotOf("hello"))
		await backend.put("channel:c1", snapshotOf("hello again"))
		await expect(backend.get("channel:c1")).resolves.toEqual(snapshotOf("hello again"))
		await backend.remove("channel:c1")
		await expect(backend.get("channel:c1")).resolves.toBeUndefined()

		expect(await databaseNames()).toContain(`hazel-channels-${userId}`)
		await backend.destroy()
		expect(await databaseNames()).not.toContain(`hazel-channels-${userId}`)
	})

	test("keeps the most recently stored channels only", async () => {
		const backend = await openIdbBackend(newUser())
		cleanups.push(backend.destroy)
		const sources = Array.from({ length: MAX_KEPT_CHANNELS + 2 }, (_, n): SourceKey => `channel:c${n}`)
		for (const source of sources) {
			await backend.put(source, snapshotOf(source))
			// `savedAt` is a millisecond clock: keep the order of storing.
			await new Promise((resolve) => setTimeout(resolve, 2))
		}
		const kept = await Promise.all(sources.map((source) => backend.get(source)))
		expect(kept.map((snapshot) => snapshot !== undefined)).toEqual(sources.map((_, n) => n >= 2))
	})
})

/** One page load: a hub over the app's snapshot store, bound to `userId`, and channel c1's messages. */
const load = (userId: UserId) => {
	const snapshots = makeAppChannelSnapshots()
	if (snapshots === undefined) throw new Error("no IndexedDB")
	snapshots.bind(userId)
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		releaseGraceMs: 0,
		snapshots: snapshots.store,
		log: () => {},
	})
	const messages = createEffectCollection({
		id: `messages-${crypto.randomUUID()}`,
		table: "messages",
		schema: Message,
		getKey: (row) => row.id,
		hub,
		sources: channelPartition(),
	})
	const live = createLiveQueryCollection((q) =>
		q.from({ m: messages }).where(({ m }) => eq(m.channelId, "c1")),
	)
	const socket = async () => {
		await vi.waitFor(() => expect(sockets.count("/sync/channel/c1")).toBe(1))
		return sockets.latest("/sync/channel/c1")!
	}
	const contents = () => live.toArray.map((row) => row.content).sort()
	return { snapshots, hub, live, socket, contents }
}

describe("a channel's kept state", () => {
	test("shows on the next load before the source answers, and goes when the session ends", async () => {
		const userId = newUser()

		const first = load(userId)
		const ready = first.live.preload()
		;(await first.socket()).snapshot(5, { messages: [message(2), message(1)] })
		await ready
		// Written a moment after the snapshot.
		await vi.waitFor(
			async () => expect(await (await openIdbBackend(userId)).get("channel:c1")).toBeDefined(),
			{ timeout: 5_000 },
		)
		first.hub.close()

		const second = load(userId)
		const startedAt = performance.now()
		await second.live.preload()
		console.log(
			`[channel snapshot] rows from IndexedDB after ${Math.round(performance.now() - startedAt)} ms`,
		)
		expect(second.contents()).toEqual(["m1", "m2"])
		const stream = await second.socket()
		expect(stream.readyState).toBe(0)
		// The source's own snapshot replaces what was kept.
		stream.snapshot(9, { messages: [message(3), message(2, "edited")] })
		expect(second.contents()).toEqual(["edited", "m3"])

		await second.snapshots.forget()
		second.hub.close()
		expect(await databaseNames()).not.toContain(`hazel-channels-${userId}`)
	})
})
