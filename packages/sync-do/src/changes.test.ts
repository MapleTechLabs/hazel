import { describe, expect, it } from "@effect/vitest"
import {
	headSeq,
	installChangeTracking,
	nextChangePruneAt,
	oldestSeq,
	pruneChanges,
	readChanges,
} from "./changes.ts"
import { TOY_DDL } from "./test/toy-source.ts"
import { makeFakeStorage } from "./testing.ts"

const TABLES = [
	{ name: "projects", key: ["id"] },
	{ name: "access", key: ["project_id", "user_id"] },
]

const fresh = () => {
	const storage = makeFakeStorage()
	storage.db.exec(TOY_DDL)
	installChangeTracking(storage.sql, TABLES)
	// Every activation installs; the second run is a no-op.
	installChangeTracking(storage.sql, TABLES)
	return storage
}

const rawLog = (storage: ReturnType<typeof makeFakeStorage>) =>
	storage.db.prepare(`SELECT seq, tbl, pk, op FROM _changes ORDER BY seq`).all()

describe("change tracking", () => {
	it("records inserts, updates and deletes", () => {
		const storage = fresh()
		storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p1', 'One')`)
		storage.db.exec(`UPDATE projects SET name = 'Uno' WHERE id = 'p1'`)
		storage.db.exec(`DELETE FROM projects WHERE id = 'p1'`)
		expect(rawLog(storage)).toEqual([
			{ seq: 1, tbl: "projects", pk: "p1", op: "insert" },
			{ seq: 2, tbl: "projects", pk: "p1", op: "update" },
			{ seq: 3, tbl: "projects", pk: "p1", op: "delete" },
		])
		expect(headSeq(storage.sql)).toBe(3)
	})

	it("records a key change as a delete of the old key and an insert of the new", () => {
		const storage = fresh()
		storage.db.exec(`INSERT INTO access (project_id, user_id) VALUES ('p1', 'u1')`)
		storage.db.exec(`UPDATE access SET user_id = 'u2' WHERE user_id = 'u1'`)
		expect(rawLog(storage)).toEqual([
			{ seq: 1, tbl: "access", pk: "p1:u1", op: "insert" },
			{ seq: 2, tbl: "access", pk: "p1:u1", op: "delete" },
			{ seq: 3, tbl: "access", pk: "p1:u2", op: "insert" },
		])
	})

	it("reinstalls triggers a table rebuild dropped, even with an unchanged signature", () => {
		const storage = fresh()
		storage.db.exec(`CREATE TABLE projects_new AS SELECT * FROM projects`)
		storage.db.exec(`DROP TABLE projects`)
		storage.db.exec(`ALTER TABLE projects_new RENAME TO projects`)
		installChangeTracking(storage.sql, TABLES)
		storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p1', 'One')`)
		expect(rawLog(storage)).toEqual([{ seq: 1, tbl: "projects", pk: "p1", op: "insert" }])
	})

	it("coalesces per key, latest op wins", () => {
		const storage = fresh()
		storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p1', 'One'), ('p2', 'Two')`)
		storage.db.exec(`UPDATE projects SET name = 'Uno' WHERE id = 'p1'`)
		storage.db.exec(`DELETE FROM projects WHERE id = 'p2'`)
		const batch = readChanges(storage.sql, 0, 100)
		expect(batch.through).toBe(4)
		expect(batch.read).toBe(4)
		expect(batch.changes).toEqual([
			{ tbl: "projects", pk: "p1", op: "update" },
			{ tbl: "projects", pk: "p2", op: "delete" },
		])
		expect(readChanges(storage.sql, 2, 1)).toEqual({
			through: 3,
			read: 1,
			changes: [{ tbl: "projects", pk: "p1", op: "update" }],
		})
		expect(readChanges(storage.sql, 4, 100)).toEqual({ through: 4, read: 0, changes: [] })
	})

	it("recreates triggers when the table set changes", () => {
		const storage = fresh()
		storage.db.exec(`INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'p1', 'x')`)
		expect(headSeq(storage.sql)).toBe(0)

		installChangeTracking(storage.sql, [{ name: "tasks", key: ["id"] }])
		storage.db.exec(`INSERT INTO tasks (id, project_id, title) VALUES ('t2', 'p1', 'y')`)
		storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p9', 'untracked now')`)
		expect(rawLog(storage)).toEqual([{ seq: 1, tbl: "tasks", pk: "t2", op: "insert" }])
	})

	it("prunes by age outside the keepLatest floor, never past notAfter", () => {
		const storage = fresh()
		for (let i = 0; i < 10; i++) storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p${i}', 'n')`)
		const now = Date.now()
		const retention = { keepLatest: 4, maxAgeMs: 60_000 }
		// Nothing aged: count alone never prunes.
		expect(pruneChanges(storage.sql, { now, ...retention })).toBe(0)

		// Age: backdate eight changes past maxAge.
		storage.db.exec(`UPDATE _changes SET at = ${now - 120_000} WHERE seq <= 8`)
		expect(nextChangePruneAt(storage.sql, retention)).toBe(now - 60_000)
		expect(pruneChanges(storage.sql, { now, ...retention, notAfter: 3 })).toBe(3)
		// 7 and 8 are aged but inside the newest 4: kept.
		expect(pruneChanges(storage.sql, { now, ...retention })).toBe(6)
		expect(oldestSeq(storage.sql)).toBe(6)
		expect(readChanges(storage.sql, 0, 100).changes.map((c) => c.pk)).toEqual(["p6", "p7", "p8", "p9"])
		// Only floor-protected changes remain: no prune deadline (no alarm that prunes nothing).
		expect(nextChangePruneAt(storage.sql, retention)).toBeUndefined()

		// Everything pruned: head stays, and new changes continue after it.
		expect(pruneChanges(storage.sql, { now: now + 10 ** 9, keepLatest: 0, maxAgeMs: 0 })).toBe(10)
		expect(headSeq(storage.sql)).toBe(10)
		storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p10', 'n')`)
		expect(headSeq(storage.sql)).toBe(11)
	})
})
