/**
 * The Bun host on real files. Runs under Bun (`bun:sqlite`), which `local-cache-bun.test.ts`
 * starts from the vitest suite; Bun reads the `vitest` import as its own test API.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import {
	createBrowserWASQLitePersistence,
	persistedCollectionOptions,
} from "@tanstack/browser-db-sqlite-persistence"
import { createCollection } from "@tanstack/db"
import { afterEach, describe, expect, it } from "vitest"
import { makeBunLocalCache } from "./local-cache-bun"

const NAME = "hazel-cache-usr_1.sqlite"
const directories: Array<string> = []

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const tempDirectory = () => {
	const directory = mkdtempSync(join(tmpdir(), "hazel-local-cache-"))
	directories.push(directory)
	return directory
}

describe("the Bun local cache host", () => {
	it("answers rows keyed by column, with SQLite's own value types", async () => {
		const db = await makeBunLocalCache(tempDirectory()).open(NAME)
		await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, size, payload BLOB, seen)")
		// A statement with no rows answers an empty list.
		expect(
			await db.execute("INSERT INTO items (id, name, size, payload, seen) VALUES (?, ?, ?, ?, ?)", [
				1,
				"one",
				9007199254740993n,
				new Uint8Array([1, 2, 3]),
				true,
			]),
		).toEqual([])
		await db.execute("INSERT INTO items (id, name, size, payload, seen) VALUES (?, ?, ?, ?, ?)", [
			2,
			undefined,
			1.5,
			[4, 5],
			new Date(0),
		])
		expect(await db.execute("SELECT * FROM items ORDER BY id")).toEqual([
			{ id: 1, name: "one", size: 9007199254740993n, payload: new Uint8Array([1, 2, 3]), seen: 1 },
			{
				id: 2,
				name: null,
				size: 1.5,
				payload: new Uint8Array([4, 5]),
				seen: "1970-01-01T00:00:00.000Z",
			},
		])
		expect(await db.execute("SELECT count(*) AS total FROM items WHERE id > ?", [0])).toEqual([
			{ total: 2 },
		])
		await db.close?.()
	})

	it("runs a script's statements in order, and a trigger as one", async () => {
		const db = await makeBunLocalCache(tempDirectory()).open(NAME)
		await db.execute(`
			CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); -- with a ; in a comment
			CREATE TABLE log (line TEXT);
			CREATE TRIGGER notes_log AFTER INSERT ON notes
			BEGIN
				INSERT INTO log (line) VALUES ('added; ' || NEW.body);
			END;
			INSERT INTO notes (body) VALUES ('a;b');
		`)
		expect(await db.execute("SELECT line FROM log")).toEqual([{ line: "added; a;b" }])
		// Rows of every statement come back, as the OPFS worker gathers them.
		expect(await db.execute("SELECT 1 AS a; SELECT 2 AS b")).toEqual([{ a: 1 }, { b: 2 }])
		await expect(db.execute("SELECT ? AS a; SELECT ? AS b", [1])).rejects.toThrow("single SQL statement")
		await expect(db.execute("SELECT * FROM missing")).rejects.toThrow("no such table")
		await db.close?.()
	})

	it("rolls back a transaction and a savepoint sent as plain statements", async () => {
		const db = await makeBunLocalCache(tempDirectory()).open(NAME)
		await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)")
		await db.execute("BEGIN IMMEDIATE")
		await db.execute("INSERT INTO items (id) VALUES (?)", [1])
		await db.execute("ROLLBACK")
		expect(await db.execute("SELECT id FROM items")).toEqual([])

		await db.execute("BEGIN IMMEDIATE")
		await db.execute("INSERT INTO items (id) VALUES (?)", [2])
		await db.execute("SAVEPOINT tsdb_sp_1")
		await db.execute("INSERT INTO items (id) VALUES (?)", [3])
		await db.execute("ROLLBACK TO SAVEPOINT tsdb_sp_1")
		await db.execute("RELEASE SAVEPOINT tsdb_sp_1")
		await db.execute("COMMIT")
		expect(await db.execute("SELECT id FROM items")).toEqual([{ id: 2 }])
		await db.close?.()
	})

	it("keeps a database between opens, and removes it with its side files", async () => {
		const directory = tempDirectory()
		const host = makeBunLocalCache(directory)
		const first = await host.open(NAME)
		await first.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)")
		await first.execute("INSERT INTO items (id) VALUES (1)")
		// Still open, so the write-ahead log is on disk beside the file.
		expect(readdirSync(directory).sort()).toEqual([NAME, `${NAME}-shm`, `${NAME}-wal`])

		// A second open of the name takes the file over: the first connection is closed.
		const second = await host.open(NAME)
		expect(await second.execute("SELECT id FROM items")).toEqual([{ id: 1 }])
		await expect(first.execute("SELECT 1")).rejects.toThrow()

		await host.remove(NAME)
		expect(readdirSync(directory)).toEqual([])
		const third = await host.open(NAME)
		expect(await third.execute("SELECT name FROM sqlite_schema")).toEqual([])
		await third.close?.()
	})

	it("starts over from a file that is no database", async () => {
		const directory = tempDirectory()
		writeFileSync(join(directory, NAME), "not a database, and longer than a header ".repeat(40))
		const db = await makeBunLocalCache(directory).open(NAME)
		expect(await db.execute("SELECT name FROM sqlite_schema")).toEqual([])
		await db.close?.()
	})

	it("opens only names that stay in its folder", async () => {
		const directory = tempDirectory()
		const host = makeBunLocalCache(directory)
		for (const name of [
			"../escape.sqlite",
			"a/b.sqlite",
			"local-storage.json",
			".sqlite",
			"",
			"x.sqlite-wal",
		]) {
			await expect(host.open(name)).rejects.toThrow("no local cache database name")
			await expect(host.remove(name)).rejects.toThrow("no local cache database name")
		}
		expect(readdirSync(directory)).toEqual([])
	})

	it("keeps nothing without a folder", async () => {
		const host = makeBunLocalCache(undefined)
		const first = await host.open(NAME)
		await first.execute("CREATE TABLE items (id INTEGER PRIMARY KEY)")
		const second = await host.open(NAME)
		expect(await second.execute("SELECT name FROM sqlite_schema")).toEqual([])
		await host.remove(NAME)
	})

	it("is whole after the process is killed mid-write", async () => {
		const directory = tempDirectory()
		// The writer commits 200 rows, says so, then keeps writing in a transaction it never ends.
		const writer = join(directory, "writer.ts")
		writeFileSync(
			writer,
			`import { makeBunLocalCache } from ${JSON.stringify(fileURLToPath(new URL("./local-cache-bun.ts", import.meta.url)))}
			const db = await makeBunLocalCache(${JSON.stringify(directory)}).open(${JSON.stringify(NAME)})
			await db.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, body TEXT)")
			await db.execute("BEGIN IMMEDIATE")
			for (let id = 0; id < 200; id++) await db.execute("INSERT INTO items VALUES (?, ?)", [id, "x".repeat(500)])
			await db.execute("COMMIT")
			await db.execute("BEGIN IMMEDIATE")
			for (let id = 200; ; id++) {
				await db.execute("INSERT INTO items VALUES (?, ?)", [id, "y".repeat(500)])
				if (id === 2000) console.log("writing")
			}`,
		)
		const child = spawn("bun", [writer], { stdio: ["ignore", "pipe", "inherit"] })
		await new Promise<void>((resolve, reject) => {
			child.stdout.on("data", () => child.kill("SIGKILL"))
			child.on("exit", (_code, signal) =>
				signal === "SIGKILL" ? resolve() : reject(new Error("the writer ended on its own")),
			)
		})
		expect(existsSync(join(directory, `${NAME}-wal`))).toBe(true)

		const db = await makeBunLocalCache(directory).open(NAME)
		expect(await db.execute("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }])
		expect(await db.execute("SELECT count(*) AS total, max(id) AS last FROM items")).toEqual([
			{ total: 200, last: 199 },
		])
		await db.close?.()
	})
})

describe("TanStack DB's SQLite persistence over the host", () => {
	type Todo = { id: string; title: string; done: boolean }

	/** One launch: the database opened by name, and a persisted collection on it. */
	const launch = async (directory: string) => {
		const database = await makeBunLocalCache(directory).open(NAME)
		const collection = createCollection(
			persistedCollectionOptions<Todo, string>({
				id: "todos",
				getKey: (todo) => todo.id,
				persistence: createBrowserWASQLitePersistence({ database }),
				schemaVersion: 1,
			}),
		)
		await collection.preload()
		const quit = async () => {
			await collection.cleanup()
			await database.close?.()
		}
		return { collection, quit }
	}

	it("restores the rows a previous launch wrote", async () => {
		const directory = tempDirectory()
		const first = await launch(directory)
		expect(first.collection.toArray).toEqual([])
		const todos = Array.from({ length: 300 }, (_, index) => ({
			id: `todo-${index}`,
			title: `Todo ${index}`,
			done: index % 2 === 0,
		}))
		await first.collection.insert(todos).when("settled")
		await first.collection
			.update("todo-1", (todo) => {
				todo.title = "Edited"
			})
			.when("settled")
		await first.collection.delete("todo-2").when("settled")
		await first.quit()

		const second = await launch(directory)
		// A row comes back with TanStack's own `$` fields beside the app's.
		const restored = new Map(second.collection.toArray.map((todo) => [todo.id, todo]))
		expect(restored.size).toBe(299)
		expect(restored.get("todo-0")).toMatchObject({ id: "todo-0", title: "Todo 0", done: true })
		expect(restored.get("todo-1")).toMatchObject({ id: "todo-1", title: "Edited", done: false })
		expect(restored.has("todo-2")).toBe(false)
		await second.quit()
	})
})
