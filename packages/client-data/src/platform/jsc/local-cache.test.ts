/** The native cache over a `__native.sqlite` played by Node's own SQLite: a connection per open, as Swift's. */
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { UserId } from "@hazel/schema"
import { createCollection } from "@tanstack/db"
import { describe, expect, test, vi } from "vitest"
import type { NativeBridge, NativeSqlValue } from "./bridge"
import { makeNativeLocalCache, makeSqliteHost } from "./local-cache"

const userA = UserId.make("00000000-0000-4000-8000-00000000000a")
const userB = UserId.make("00000000-0000-4000-8000-00000000000b")

/** What Swift does: a serial queue per file, rows as JSON, BLOBs as base64. */
const fakeSqlite = () => {
	const dir = mkdtempSync(join(tmpdir(), "hazel-sqlite-"))
	const files = { keys: () => readdirSync(dir).filter((name) => name.endsWith(".sqlite")) }
	const handles = new Map<number, DatabaseSync>()
	let next = 1
	const later = (f: () => void) => setTimeout(f, 0)
	const sqlite: NonNullable<NativeBridge["sqlite"]> = {
		open: (name, done) =>
			later(() => {
				const db = new DatabaseSync(join(dir, name))
				db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000")
				const handle = next++
				handles.set(handle, db)
				done(handle, null)
			}),
		execute: (handle, sql, params, done) =>
			later(() => {
				const db = handles.get(handle)
				if (db === undefined) return done(null, "closed")
				try {
					const args = params.map((p: NativeSqlValue) => (typeof p === "boolean" ? (p ? 1 : 0) : p))
					const rows = db.prepare(sql).all(...(args as Array<string | number | null | Uint8Array>))
					const json = JSON.stringify(rows, (_key, value: unknown) =>
						value instanceof Uint8Array ? Buffer.from(value).toString("base64") : value,
					)
					done(json, null)
				} catch (error) {
					done(null, String(error))
				}
			}),
		close: (handle, done) =>
			later(() => {
				handles.get(handle)?.close()
				handles.delete(handle)
				done()
			}),
		remove: (name, done) =>
			later(() => {
				for (const suffix of ["", "-wal", "-shm", "-journal"]) {
					const path = join(dir, `${name}${suffix}`)
					if (existsSync(path)) rmSync(path)
				}
				done(null)
			}),
	}
	return { sqlite, files }
}

describe("native LocalCacheHost", () => {
	test("runs SQL with parameters and returns rows", async () => {
		const { sqlite } = fakeSqlite()
		const db = await makeSqliteHost(sqlite).open("t.sqlite")
		await db.execute("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, b BLOB, flag INTEGER)")
		await db.execute("INSERT INTO t VALUES (?, ?, ?, ?)", ["a", 1, Uint8Array.of(1, 2), true])
		await db.execute("INSERT INTO t VALUES (?, ?, ?, ?)", ["b", undefined, null, false])
		expect(await db.execute("SELECT * FROM t ORDER BY id")).toEqual([
			{ id: "a", n: 1, b: "AQI=", flag: 1 },
			{ id: "b", n: null, b: null, flag: 0 },
		])
		await expect(db.execute("SELECT nope FROM t")).rejects.toThrow(/no such column/)
		await expect(db.execute("SELECT ?", [{}])).rejects.toThrow(TypeError)
	})
})

describe("native LocalCache", () => {
	test("keeps a channel's state per user, and forget deletes both files", async () => {
		const { sqlite, files } = fakeSqlite()
		const cache = makeNativeLocalCache(makeSqliteHost(sqlite))
		const snapshot = { seq: 7, tables: { messages: [{ id: "m1" }] }, windows: [] }
		// Before a user is bound nothing is stored, and reads wait.
		await cache.snapshots!.write("channel:c1", snapshot as never)
		cache.bind(userA)
		await cache.snapshots!.write("channel:c1", snapshot as never)
		expect(await cache.snapshots!.read("channel:c1")).toEqual(snapshot)
		await vi.waitFor(() =>
			expect([...files.keys()].sort()).toEqual([
				`hazel-cache-${userA}.sqlite`,
				`hazel-chans-${userA}.sqlite`,
			]),
		)
		expect(await cache.forget()).toBe(true)
		expect([...files.keys()]).toEqual([])
	})

	test("another user in the same runtime closes the cache instead of mixing rows", async () => {
		const { sqlite } = fakeSqlite()
		const cache = makeNativeLocalCache(makeSqliteHost(sqlite))
		const error = vi.spyOn(console, "error").mockImplementation(() => {})
		cache.bind(userA)
		cache.bind(userB)
		expect(error).toHaveBeenCalled()
		error.mockRestore()
		expect(await cache.forget(userB)).toBe(true)
	})

	test("a persisted collection writes through to SQLite and reads back in a new runtime", async () => {
		const { sqlite } = fakeSqlite()
		type Row = { readonly id: string; readonly name: string }
		const open = () => {
			const cache = makeNativeLocalCache(makeSqliteHost(sqlite))
			cache.bind(userA)
			const options = cache.persist!(1)({ id: "rows", getKey: (row: Row) => row.id })
			// SAFETY: `persist` returns the persisted collection's options for this row type.
			return {
				cache,
				rows: createCollection(options as Parameters<typeof createCollection<Row, string>>[0]),
			}
		}
		const first = open()
		await first.rows.preload()
		await first.rows.insert({ id: "r1", name: "general" }).when("settled")
		// One runtime at a time, as on a device (this fake's SQLite blocks the only thread).
		await first.rows.cleanup()
		await new Promise((resolve) => setTimeout(resolve, 50))
		const second = open()
		await second.rows.preload()
		await vi.waitFor(() => expect(second.rows.get("r1")).toMatchObject({ id: "r1", name: "general" }))
	})
})
