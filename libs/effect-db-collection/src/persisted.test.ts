import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import {
	type BrowserWASQLiteDatabase,
	createBrowserWASQLitePersistence,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import { Schema } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createEffectCollection, sourceSet } from "./collection"
import { SyncHub } from "./hub"
import { fakeSockets } from "./testing/fake-websocket"
import type { SourceKey } from "./types"

const User = Schema.Struct({ id: Schema.String, name: Schema.String })

const cleanups: Array<() => unknown> = []

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const tempDatabase = () => {
	const dir = mkdtempSync(join(tmpdir(), "hazel-persisted-"))
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
	return join(dir, "cache.sqlite")
}

/** The browser persistence's database handle over `node:sqlite`, in place of wa-sqlite on OPFS. */
const nodeDatabase = (
	path: string,
): BrowserWASQLiteDatabase & { readonly close: () => void; readonly isOpen: () => boolean } => {
	const db = new DatabaseSync(path)
	return {
		execute: async <TRow>(sql: string, params: ReadonlyArray<unknown> = []) => {
			if (params.length === 0 && sql.trim().replace(/;$/, "").includes(";")) {
				db.exec(sql)
				return []
			}
			const statement = db.prepare(sql)
			const args = params as Array<SQLInputValue>
			if (statement.columns().length > 0) return statement.all(...args) as Array<TRow>
			statement.run(...args)
			return []
		},
		close: () => db.close(),
		isOpen: () => db.isOpen,
	}
}

/**
 * One page load: a hub, and a persisted `users` collection over `sources` on the file at `path`;
 * `unpersisted` adds a `channels` collection over the same sources that keeps nothing.
 */
const session = (path: string, sources: ReadonlyArray<SourceKey>, unpersisted = false) => {
	const sockets = fakeSockets()
	const hub = new SyncHub({
		baseUrl: "https://sync.test",
		getToken: async () => "token",
		WebSocket: sockets.WebSocket,
		backoff: { initialDelayMs: 5, maxDelayMs: 20, jitter: false },
		releaseGraceMs: 0,
		log: () => {},
	})
	const database = nodeDatabase(path)
	const collection = createEffectCollection(
		{
			id: "users",
			table: "users",
			schema: User,
			getKey: (row) => row.id,
			hub,
			sources: sourceSet(sources),
		},
		(options) =>
			persistedCollectionOptions({
				...options,
				persistence: createBrowserWASQLitePersistence({ database }),
				schemaVersion: 1,
			}),
	)
	const channels = unpersisted
		? createEffectCollection({
				id: "channels",
				table: "channels",
				schema: User,
				getKey: (row) => row.id,
				hub,
				sources: sourceSet(sources),
			})
		: undefined
	channels?.preload()
	/** A page unload: the collection stops without dropping its rows. */
	const unload = async () => {
		await collection.cleanup()
		database.close()
	}
	cleanups.push(async () => {
		if (database.isOpen()) await unload()
		hub.close()
	})
	const socket = async (source: SourceKey) => {
		const path = `/sync/${source.replace(":", "/")}`
		await vi.waitFor(() => expect(sockets.count(path)).toBeGreaterThanOrEqual(1))
		return sockets.latest(path)!
	}
	return { collection, socket, unload }
}

const names = (collection: { toArray: ReadonlyArray<{ id: string; name: string }> }) =>
	Object.fromEntries(collection.toArray.map((row) => [row.id, row.name]))

describe("persisted collections", () => {
	it("shows last session's rows before any snapshot, then reconciles each source's snapshot", async () => {
		const path = tempDatabase()
		const first = session(path, ["org:a", "org:b"])
		first.collection.preload()
		;(await first.socket("org:a")).snapshot(1, {
			users: [
				{ id: "u1", name: "Ada" },
				{ id: "u2", name: "Bo" },
			],
		})
		;(await first.socket("org:b")).snapshot(1, {
			users: [
				{ id: "u1", name: "Ada" },
				{ id: "u3", name: "Cy" },
			],
		})
		await vi.waitFor(() => expect(names(first.collection)).toEqual({ u1: "Ada", u2: "Bo", u3: "Cy" }))
		await first.unload()

		const second = session(path, ["org:a", "org:b"])
		await second.collection.preload()
		// Ready from storage while no source has answered.
		expect(second.collection.status).toBe("ready")
		expect(names(second.collection)).toEqual({ u1: "Ada", u2: "Bo", u3: "Cy" })

		// org:b no longer has u1 or u3: u1 stays (org:a still holds it), u3 goes.
		;(await second.socket("org:b")).snapshot(5, { users: [{ id: "u4", name: "Di" }] })
		await vi.waitFor(() => expect(names(second.collection)).toEqual({ u1: "Ada", u2: "Bo", u4: "Di" }))
		// org:a renamed u1 and removed u2.
		;(await second.socket("org:a")).snapshot(5, { users: [{ id: "u1", name: "Ada L." }] })
		await vi.waitFor(() => expect(names(second.collection)).toEqual({ u1: "Ada L.", u4: "Di" }))
		// The durable write trails the visible one, and an unload does not wait for it: a load right
		// after a change can restore the row before it (its source's snapshot then repairs it).
		await new Promise((resolve) => setTimeout(resolve, 200))
		await second.unload()

		// The reconciled state is what the next load restores.
		const third = session(path, ["org:a", "org:b"])
		await third.collection.preload()
		expect(names(third.collection)).toEqual({ u1: "Ada L.", u4: "Di" })
	})

	it("drops the stored rows of a source the user no longer has", async () => {
		const path = tempDatabase()
		const first = session(path, ["org:a", "org:b"])
		first.collection.preload()
		;(await first.socket("org:a")).snapshot(1, { users: [{ id: "u1", name: "Ada" }] })
		;(await first.socket("org:b")).snapshot(1, {
			users: [
				{ id: "u1", name: "Ada" },
				{ id: "u2", name: "Bo" },
			],
		})
		await vi.waitFor(() => expect(names(first.collection)).toEqual({ u1: "Ada", u2: "Bo" }))
		await first.unload()

		// Left org:b since.
		const second = session(path, ["org:a"])
		await second.collection.preload()
		await vi.waitFor(() => expect(names(second.collection)).toEqual({ u1: "Ada" }))
	})

	describe("resume", () => {
		/** Waits out the batching of the stored seqs. */
		const seqsStored = () => new Promise((resolve) => setTimeout(resolve, 1200))

		const helloOf = async (load: ReturnType<typeof session>, source: SourceKey) => {
			const socket = await load.socket(source)
			socket.open()
			return { socket, hello: socket.sent.find((frame) => frame._tag === "Hello") }
		}

		it("resumes after the stored seq and applies the catch-up on the stored rows", async () => {
			const path = tempDatabase()
			const first = session(path, ["org:a"])
			first.collection.preload()
			;(await first.socket("org:a")).snapshot(7, {
				users: [
					{ id: "u1", name: "Ada" },
					{ id: "u2", name: "Bo" },
				],
			})
			await vi.waitFor(() => expect(names(first.collection)).toEqual({ u1: "Ada", u2: "Bo" }))
			await seqsStored()
			await first.unload()

			const second = session(path, ["org:a"])
			second.collection.preload()
			const { socket, hello } = await helloOf(second, "org:a")
			expect(hello).toMatchObject({ since: 7 })
			expect(names(second.collection)).toEqual({ u1: "Ada", u2: "Bo" })
			// A catch-up: changes only, no reset.
			socket.commit(9, { users: { upserts: [{ id: "u1", name: "Ada L." }], deletes: ["u2"] } })
			socket.receive({ _tag: "Ready" })
			await vi.waitFor(() => expect(names(second.collection)).toEqual({ u1: "Ada L." }))
			await seqsStored()
			await second.unload()

			const third = session(path, ["org:a"])
			third.collection.preload()
			expect((await helloOf(third, "org:a")).hello).toMatchObject({ since: 9 })
			expect(names(third.collection)).toEqual({ u1: "Ada L." })
		})

		it("asks for a snapshot after a run whose rows did not all reach the collection", async () => {
			const path = tempDatabase()
			const first = session(path, ["org:a"])
			first.collection.preload()
			const socket = await first.socket("org:a")
			socket.snapshot(7, { users: [{ id: "u1", name: "Ada" }] })
			// u2 cannot decode: resuming after seq 8 would never bring it.
			socket.commit(8, { users: { upserts: [{ id: "u2", name: 5 }] } })
			await seqsStored()
			await first.unload()

			const second = session(path, ["org:a"])
			second.collection.preload()
			expect((await helloOf(second, "org:a")).hello).toMatchObject({ since: null })
			expect(names(second.collection)).toEqual({ u1: "Ada" })
		})

		it("asks for a snapshot while a collection that keeps nothing holds the source", async () => {
			const path = tempDatabase()
			const first = session(path, ["org:a"])
			first.collection.preload()
			;(await first.socket("org:a")).snapshot(7, { users: [{ id: "u1", name: "Ada" }] })
			await vi.waitFor(() => expect(names(first.collection)).toEqual({ u1: "Ada" }))
			await seqsStored()
			await first.unload()

			const second = session(path, ["org:a"], true)
			second.collection.preload()
			expect((await helloOf(second, "org:a")).hello).toMatchObject({ since: null })
		})
	})
})
