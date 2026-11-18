import { describe, expect, it } from "vitest"
import { type CacheRequest, makeIosLocalCache } from "./local-cache-ios"
import fixture from "./local-cache-wire.fixture.json" with { type: "json" }

/**
 * A host that answers from the wire fixture, whose steps the Rust engine answers the same
 * (`the_wire_fixture_holds` in `host/ios/src/local_cache.rs`): every request must be the
 * fixture's next, and gets its reply.
 */
const fixtureHost = () => {
	const steps = [...fixture]
	const send = async (request: CacheRequest) => {
		const step = steps.shift()
		if (step === undefined) throw new Error("the fixture has no step left")
		const { id: _id, ...expected } = step.request
		// As it crosses the bridge: JSON text out, JSON text back.
		expect(JSON.parse(JSON.stringify(request))).toEqual(expected)
		return JSON.stringify(step.reply)
	}
	return { send, left: () => steps.length }
}

describe("the iOS local cache host", () => {
	it("speaks the wire fixture, and answers as the OPFS worker does", async () => {
		const wire = fixtureHost()
		const host = makeIosLocalCache({ persist: false, send: wire.send })
		const db = await host.open("hazel-cache-usr_1.sqlite")
		const name = 'one "quoted" é\u{1f642}'
		const insert = "INSERT INTO items (id, name, size, payload, seen) VALUES (?, ?, ?, ?, ?)"

		expect(
			await db.execute(
				"CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, size, payload BLOB, seen)",
			),
		).toEqual([])
		expect(
			await db.execute(insert, [1, name, 9007199254740993n, new Uint8Array([1, 2, 3]), true]),
		).toEqual([])
		expect(await db.execute(insert, [2, undefined, 1.5, [4, 5], new Date(0)])).toEqual([])
		expect(await db.execute("SELECT * FROM items ORDER BY id")).toEqual([
			{ id: 1, name, size: 9007199254740993n, payload: new Uint8Array([1, 2, 3]), seen: 1 },
			{
				id: 2,
				name: null,
				size: 1.5,
				payload: new Uint8Array([4, 5]),
				seen: "1970-01-01T00:00:00.000Z",
			},
		])
		expect(
			await db.execute(
				"SELECT 9007199254740991 AS safe, -9007199254740992 AS past, 9e999 AS up, -9e999 AS down, 2.0 AS whole, typeof(?) AS big, typeof(?) AS small",
				[1700000000000, 0.5],
			),
		).toEqual([
			{
				safe: 9007199254740991,
				past: -9007199254740992n,
				up: Number.POSITIVE_INFINITY,
				down: Number.NEGATIVE_INFINITY,
				whole: 2,
				big: "integer",
				small: "real",
			},
		])
		// Rows of every statement, in order, each keyed by its own statement's columns.
		expect(await db.execute("SELECT 1 AS a; SELECT 2 AS b")).toEqual([{ a: 1 }, { b: 2 }])
		await expect(db.execute("SELECT * FROM missing")).rejects.toThrow("no such table: missing")
		await db.close?.()
		await expect(db.execute("SELECT 1")).rejects.toThrow("the database is closed")
		await host.remove("hazel-cache-usr_1.sqlite")
		expect(wire.left()).toBe(0)
	})

	it("keeps its databases on disk only when asked to persist", async () => {
		const sent: Array<CacheRequest> = []
		const send = async (request: CacheRequest) => {
			sent.push(request)
			return JSON.stringify("open" in request ? { db: 7 } : {})
		}
		const host = makeIosLocalCache({ persist: true, send })
		const db = await host.open("a.sqlite")
		await db.close?.()
		await host.remove("a.sqlite")
		expect(sent).toEqual([
			{ open: "a.sqlite", memory: false },
			{ close: 7 },
			{ remove: "a.sqlite", memory: false },
		])
	})

	it("sends no statement whose parameters SQLite cannot take", async () => {
		const sent: Array<CacheRequest> = []
		const send = async (request: CacheRequest) => {
			sent.push(request)
			return JSON.stringify({ db: 1 })
		}
		const db = await makeIosLocalCache({ persist: true, send }).open("a.sqlite")
		await expect(db.execute("SELECT ?", [{ not: "bindable" }])).rejects.toThrow(
			"Unsupported parameter type",
		)
		expect(sent).toHaveLength(1)
	})
})
