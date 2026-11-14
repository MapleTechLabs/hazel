import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { SyncSeq } from "@hazel/domain/sync"
import type { SourceKey, SourceSnapshot } from "@hazel/effect-db-collection"
import { UserId } from "@hazel/schema"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	makeChannelSnapshots,
	MAX_KEPT_CHANNELS,
	openHostBackend,
	type SnapshotBackend,
} from "./channel-snapshots"
import type { LocalCacheHost } from "./local-cache-host"

const userA = UserId.make("00000000-0000-4000-8000-000000000001")
const userB = UserId.make("00000000-0000-4000-8000-000000000002")

const snapshotOf = (content: string, seq = 5): SourceSnapshot => ({
	seq: SyncSeq.make(seq),
	tables: { messages: [{ id: "m1", content }] },
	windows: [
		{ table: "messages", oldest: { createdAt: "2026-01-01T00:00:00.000Z", id: "m1" }, hasMore: true },
	],
})

/** A user's states in memory; `destroyed` once deleted. */
const memoryBackend = () => {
	const kept = new Map<SourceKey, SourceSnapshot>()
	const state = { destroyed: false }
	const backend: SnapshotBackend = {
		get: async (source) => kept.get(source),
		put: async (source, snapshot) => void kept.set(source, snapshot),
		remove: async (source) => void kept.delete(source),
		destroy: async () => {
			state.destroyed = true
			kept.clear()
		},
	}
	return { backend, kept, state }
}

describe("channel snapshots", () => {
	const setup = () => {
		const backends = new Map<UserId, ReturnType<typeof memoryBackend>>()
		const destroyFor = vi.fn(async (_userId: UserId) => {})
		const open = vi.fn(async (userId: UserId) => {
			const created = memoryBackend()
			backends.set(userId, created)
			return created.backend
		})
		return { snapshots: makeChannelSnapshots(open, destroyFor), backends, open, destroyFor }
	}

	it("keeps channels only, and not who is typing", () => {
		const { store } = setup().snapshots
		expect(["channel:c1", "org:o1", "user:u1"].map((source) => store.keeps(source as SourceKey))).toEqual(
			[true, false, false],
		)
		expect(["messages", "typing_indicators"].map(store.keepsTable)).toEqual([true, false])
	})

	it("answers a channel opened before the user is known once their store opens", async () => {
		const { snapshots, backends } = setup()
		const read = snapshots.store.read("channel:c1")
		// Nothing is stored for a user who is not known.
		await snapshots.store.write("channel:c1", snapshotOf("too early"))
		snapshots.bind(userA)
		await expect(read).resolves.toBeUndefined()

		await snapshots.store.write("channel:c1", snapshotOf("hello"))
		expect(backends.get(userA)?.kept.get("channel:c1")).toEqual(snapshotOf("hello"))
		await expect(snapshots.store.read("channel:c1")).resolves.toEqual(snapshotOf("hello"))
		await snapshots.store.remove("channel:c1")
		await expect(snapshots.store.read("channel:c1")).resolves.toBeUndefined()
	})

	it("stays with the first user it was opened for", async () => {
		const { snapshots, open } = setup()
		snapshots.bind(userA)
		snapshots.bind(userB)
		await snapshots.store.read("channel:c1")
		expect(open.mock.calls).toEqual([[userA]])
	})

	it("deletes the open store when the session ends, and reads and writes nothing after", async () => {
		const { snapshots, backends } = setup()
		snapshots.bind(userA)
		await snapshots.store.write("channel:c1", snapshotOf("hello"))
		await snapshots.forget()
		expect(backends.get(userA)?.state.destroyed).toBe(true)
		await snapshots.store.write("channel:c1", snapshotOf("after"))
		expect(backends.get(userA)?.kept.size).toBe(0)
		await expect(snapshots.store.read("channel:c1")).resolves.toBeUndefined()
	})

	it("deletes the remembered user's states when no store is open, and still opens one later", async () => {
		const { snapshots, backends, destroyFor } = setup()
		await snapshots.forget(userA)
		expect(destroyFor.mock.calls).toEqual([[userA]])
		snapshots.bind(userB)
		await snapshots.store.write("channel:c1", snapshotOf("hello"))
		expect(backends.get(userB)?.kept.size).toBe(1)
	})

	it("works without its store when it cannot open", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {})
		const snapshots = makeChannelSnapshots(
			() => Promise.reject(new Error("no storage")),
			async () => {},
		)
		snapshots.bind(userA)
		await expect(snapshots.store.read("channel:c1")).resolves.toBeUndefined()
		await expect(snapshots.store.write("channel:c1", snapshotOf("hello"))).resolves.toBeUndefined()
	})
})

/** A host over `node:sqlite`, one in-memory database per file name. */
const nodeHost = () => {
	const files = new Map<string, DatabaseSync>()
	const host: LocalCacheHost = {
		open: async (name) => {
			const db = files.get(name) ?? new DatabaseSync(":memory:")
			files.set(name, db)
			return {
				execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
					const statement = db.prepare(sql)
					// SAFETY: the backend binds only text and integers.
					const args = params as Array<SQLInputValue>
					// SAFETY: a statement's rows are objects keyed by the columns the caller names.
					if (statement.columns().length > 0) return statement.all(...args) as Array<TRow>
					statement.run(...args)
					return []
				},
			}
		},
		remove: async (name) => void files.delete(name),
	}
	return { host, files }
}

describe("the host's SQLite backend", () => {
	let now = 0
	beforeEach(() => {
		now = 1_000
		vi.spyOn(Date, "now").mockImplementation(() => now++)
	})

	it("stores, replaces and removes a channel's state in a file of its user", async () => {
		const { host, files } = nodeHost()
		const backend = await openHostBackend(host, userA)
		expect([...files.keys()]).toEqual([`hazel-chans-${userA}.sqlite`])
		// wa-sqlite opens no longer name, should a host be one.
		expect([...files.keys()][0]?.length).toBeLessThanOrEqual(56)

		await expect(backend.get("channel:c1")).resolves.toBeUndefined()
		await backend.put("channel:c1", snapshotOf("hello"))
		await backend.put("channel:c1", snapshotOf("hello again", 6))
		await expect(backend.get("channel:c1")).resolves.toEqual(snapshotOf("hello again", 6))
		await backend.remove("channel:c1")
		await expect(backend.get("channel:c1")).resolves.toBeUndefined()

		await backend.destroy()
		expect(files.size).toBe(0)
	})

	it("keeps the most recently stored channels only", async () => {
		const backend = await openHostBackend(nodeHost().host, userA)
		const sources = Array.from({ length: MAX_KEPT_CHANNELS + 2 }, (_, n): SourceKey => `channel:c${n}`)
		for (const source of sources) await backend.put(source, snapshotOf(source))
		// The first channel is stored again: the two stored longest ago after it go.
		await backend.put(sources[0]!, snapshotOf("again"))
		const kept = await Promise.all(sources.map((source) => backend.get(source)))
		expect(kept.map((snapshot) => snapshot !== undefined)).toEqual(
			sources.map((_, n) => n === 0 || n >= 3),
		)
	})

	it("reads a record it cannot decode as none", async () => {
		const { host, files } = nodeHost()
		const backend = await openHostBackend(host, userA)
		files
			.get(`hazel-chans-${userA}.sqlite`)
			?.prepare(
				"INSERT INTO snapshots (source, saved_at, snapshot) VALUES ('channel:c1', 1, '{\"seq\":\"x\"}')",
			)
			.run()
		await expect(backend.get("channel:c1")).resolves.toBeUndefined()
	})
})
