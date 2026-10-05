import { DatabaseSync } from "node:sqlite"
import { describe, expect, it } from "vitest"
import * as Store from "./event-store.ts"
import {
	DEFAULT_BATCH_LIMITS,
	evaluateAck,
	formatOffset,
	parseResumeOffset,
	resolveCursor,
	selectBatch,
	type SessionCursor,
} from "./log.ts"

/** `node:sqlite` behind the synchronous `SqlStorageLike` the object uses (workerd's shape). */
const memorySql = (): Store.SqlStorageLike => {
	const db = new DatabaseSync(":memory:")
	return {
		exec: (query, ...bindings) => {
			const statement = db.prepare(query)
			if (/^\s*select/i.test(query)) {
				const rows = statement.all(...(bindings as Array<string | number | null>))
				return { toArray: () => rows as never }
			}
			statement.run(...(bindings as Array<string | number | null>))
			return { toArray: () => [] }
		},
	}
}

const freshStore = () => {
	const sql = memorySql()
	Store.migrate(sql)
	// Migrating twice is a no-op (every activation migrates).
	Store.migrate(sql)
	return sql
}

const body = (n: number) => JSON.stringify({ n })

describe("event store", () => {
	it("assigns monotonic sequence numbers that survive trimming", () => {
		const sql = freshStore()
		expect(Store.bounds(sql)).toEqual({ head: 0, firstRetained: undefined })
		expect([1, 2, 3].map((n) => Store.append(sql, body(n), 1_000))).toEqual([1, 2, 3])

		Store.trimThrough(sql, 3)
		expect(Store.bounds(sql)).toEqual({ head: 3, firstRetained: undefined })
		expect(Store.append(sql, body(4), 1_000)).toBe(4)
		expect(Store.bounds(sql)).toEqual({ head: 4, firstRetained: 4 })
	})

	it("reads strictly after a cursor, in order, up to a limit", () => {
		const sql = freshStore()
		for (let n = 1; n <= 5; n++) Store.append(sql, body(n), 1_000)
		expect(Store.readAfter(sql, 2, 10).map((e) => e.seq)).toEqual([3, 4, 5])
		expect(Store.readAfter(sql, 0, 2)).toEqual([
			{ seq: 1, body: body(1) },
			{ seq: 2, body: body(2) },
		])
		expect(Store.readAfter(sql, 5, 10)).toEqual([])
	})

	it("drops events past the count and age limits", () => {
		const sql = freshStore()
		for (let n = 1; n <= 5; n++) Store.append(sql, body(n), n * 1_000)
		Store.enforceRetention(sql, 5_000, { maxEvents: 3, maxAgeMs: 60_000 })
		expect(Store.bounds(sql)).toEqual({ head: 5, firstRetained: 3 })

		Store.enforceRetention(sql, 64_000, { maxEvents: 3, maxAgeMs: 60_000 })
		expect(Store.bounds(sql).firstRetained).toBe(5)
		expect(Store.oldestAppendedAt(sql)).toBe(5_000)
	})
})

describe("delivery: offsets, replay and acks", () => {
	/** One delivery step as the object runs it: the next batch after the cursor. */
	const nextBatch = (sql: Store.SqlStorageLike, session: SessionCursor) =>
		selectBatch(Store.readAfter(sql, session.cursor, DEFAULT_BATCH_LIMITS.maxEvents), {
			maxEvents: 2,
			maxBytes: DEFAULT_BATCH_LIMITS.maxBytes,
		})

	it("replays unacknowledged events on reconnect and trims acknowledged ones", () => {
		const sql = freshStore()
		for (let n = 1; n <= 5; n++) Store.append(sql, body(n), 1_000)

		// First connection, replaying everything retained.
		let session: SessionCursor = {
			sessionId: "s1",
			cursor: resolveCursor(parseResumeOffset("-1"), Store.bounds(sql)),
			pending: null,
			pendingDeadline: null,
		}
		const first = nextBatch(sql, session)
		expect(first.map((e) => e.seq)).toEqual([1, 2])
		session = { ...session, pending: 2 }

		const ack = evaluateAck(session, { sessionId: "s1", nextOffset: formatOffset(2) })
		expect(ack._tag).toBe("Accepted")
		if (ack._tag !== "Accepted") return
		Store.trimThrough(sql, ack.cursor)
		session = { ...session, cursor: ack.cursor, pending: null }
		expect(Store.bounds(sql)).toEqual({ head: 5, firstRetained: 3 })

		// Second batch goes out but the bot drops before acknowledging it.
		expect(nextBatch(sql, session).map((e) => e.seq)).toEqual([3, 4])

		// It reconnects from its last acknowledged offset and gets the same batch again.
		const resumed: SessionCursor = {
			sessionId: "s1",
			cursor: resolveCursor(parseResumeOffset(formatOffset(2)), Store.bounds(sql)),
			pending: null,
			pendingDeadline: null,
		}
		expect(nextBatch(sql, resumed).map((e) => e.seq)).toEqual([3, 4])
	})

	it("tails only new events for `now`", () => {
		const sql = freshStore()
		for (let n = 1; n <= 3; n++) Store.append(sql, body(n), 1_000)
		const session: SessionCursor = {
			sessionId: "s1",
			cursor: resolveCursor(parseResumeOffset("now"), Store.bounds(sql)),
			pending: null,
			pendingDeadline: null,
		}
		expect(nextBatch(sql, session)).toEqual([])
		Store.append(sql, body(4), 1_000)
		expect(nextBatch(sql, session).map((e) => e.seq)).toEqual([4])
	})
})
