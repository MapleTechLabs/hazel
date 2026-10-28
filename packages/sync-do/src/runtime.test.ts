import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit } from "effect"
import { TestClock } from "effect/testing"
import { SqlClient } from "effect/sql/SqlClient"
import { pruneChanges } from "./changes.ts"
import { makeSyncRuntime, type SyncRuntimeOptions } from "./runtime.ts"
import { makeToyControls, makeToySource, TOY_DDL, type ToyPrincipal } from "./test/toy-source.ts"
import {
	type FakeSocket,
	makeFakeSocket,
	makeFakeState,
	makeFakeStorage,
	sqliteClientLayer,
} from "./testing.ts"

const setup = (options?: SyncRuntimeOptions) => {
	const storage = makeFakeStorage()
	storage.db.exec(TOY_DDL)
	const state = makeFakeState()
	const controls = makeToyControls()
	const source = makeToySource(controls)
	const runtime = makeSyncRuntime({ sql: storage.sql, state, source, options })
	const exec = (statement: string) =>
		Effect.flatMap(SqlClient, (sql) => sql.unsafe(statement)).pipe(Effect.asVoid)
	const connect = (principal: ToyPrincipal) =>
		Effect.gen(function* () {
			const socket = makeFakeSocket()
			const result = yield* runtime.adoptSocket(socket, principal)
			return { socket, result }
		})
	const hello = (socket: FakeSocket, since: number | null) =>
		runtime.onMessage(socket, JSON.stringify({ _tag: "Hello", since }))
	return { storage, state, controls, runtime, exec, connect, hello, layer: sqliteClientLayer(storage) }
}

const tags = (socket: FakeSocket) => socket.frames().map((frame) => frame._tag)

const rowsOf = (socket: FakeSocket, table: string) =>
	socket.frames().filter((frame) => frame._tag === "Rows" && frame.table === table) as unknown as Array<{
		readonly upserts: Array<{ readonly id: string }>
		readonly deletes: Array<string>
	}>

const upsertIds = (socket: FakeSocket, table: string) =>
	rowsOf(socket, table).flatMap((frame) => frame.upserts.map((row) => row.id))

const deleteKeys = (socket: FakeSocket, table: string) =>
	rowsOf(socket, table).flatMap((frame) => frame.deletes)

const SEED = `
	INSERT INTO projects (id, name, private) VALUES ('pub', 'Public', 0), ('sec', 'Secret', 1);
	INSERT INTO access (project_id, user_id) VALUES ('sec', 'alice');
	INSERT INTO tasks (id, project_id, title) VALUES ('t1', 'pub', 'open'), ('t2', 'sec', 'hidden');
`

describe("sync runtime", () => {
	it.effect("Hello without since gets a full, visibility-filtered snapshot", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const { socket: alice, result } = yield* t.connect({ userId: "alice" })
			expect(result).toBe("accepted")
			expect(alice.tags).toEqual(["alice"])
			const { socket: bob } = yield* t.connect({ userId: "bob" })
			yield* t.hello(alice, null)
			yield* t.hello(bob, null)

			expect(alice.frames()[0]).toEqual({ _tag: "Begin", reset: true })
			expect(alice.frames().slice(-2)).toEqual([{ _tag: "Commit", seq: 5 }, { _tag: "Ready" }])
			expect(upsertIds(alice, "projects")).toEqual(["pub", "sec"])
			expect(upsertIds(alice, "tasks")).toEqual(["t1", "t2"])
			expect(upsertIds(bob, "projects")).toEqual(["pub"])
			expect(upsertIds(bob, "tasks")).toEqual(["t1"])
			// Rows are the source's JSON encoding.
			expect(rowsOf(alice, "projects")[0]!.upserts[0]).toEqual({
				id: "pub",
				name: "Public",
				private: false,
			})
			expect(alice.deserializeAttachment()).toMatchObject({
				v: 1,
				pid: "alice",
				cursor: 5,
				ready: true,
			})
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("catches up from since, or resets when since is outside retention", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			yield* t.exec(`UPDATE tasks SET title = 'done' WHERE id = 't1'`)
			yield* t.exec(`DELETE FROM projects WHERE id = 'pub'`)

			const { socket: caughtUp } = yield* t.connect({ userId: "bob" })
			yield* t.hello(caughtUp, 5)
			expect(tags(caughtUp)).toEqual(["Begin", "Rows", "Rows", "Commit", "Ready"])
			expect(caughtUp.frames()[0]).toEqual({ _tag: "Begin", reset: false })
			// t1 changed, then left visibility with its project: a delete.
			expect(rowsOf(caughtUp, "tasks")).toEqual([
				{ _tag: "Rows", table: "tasks", upserts: [], deletes: ["t1"] },
			])
			expect(deleteKeys(caughtUp, "projects")).toEqual(["pub"])
			expect(caughtUp.frames().at(-2)).toEqual({ _tag: "Commit", seq: 7 })

			const { socket: current } = yield* t.connect({ userId: "bob" })
			yield* t.hello(current, 7)
			expect(current.frames()).toEqual([
				{ _tag: "Begin", reset: false },
				{ _tag: "Commit", seq: 7 },
				{ _tag: "Ready" },
			])

			pruneChanges(t.storage.sql, { now: Date.now() + 1, keepLatest: 1, maxAgeMs: 0 })
			const { socket: stale } = yield* t.connect({ userId: "bob" })
			yield* t.hello(stale, 5)
			expect(stale.frames()[0]).toEqual({ _tag: "Begin", reset: true })

			const { socket: ahead } = yield* t.connect({ userId: "bob" })
			yield* t.hello(ahead, 99)
			expect(ahead.frames()[0]).toEqual({ _tag: "Begin", reset: true })
			expect(ahead.frames().at(-2)).toEqual({ _tag: "Commit", seq: 7 })
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("flush sends each principal its visible delta and a Commit to every ready socket", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const { socket: alice } = yield* t.connect({ userId: "alice" })
			const { socket: bob } = yield* t.connect({ userId: "bob" })
			const { socket: idle } = yield* t.connect({ userId: "carol" })
			yield* t.hello(alice, null)
			yield* t.hello(bob, null)
			yield* t.runtime.flush
			alice.clear()
			bob.clear()

			// A secret task: alice sees it, bob only gets a delete for a key he never held.
			yield* t.exec(`INSERT INTO tasks (id, project_id, title) VALUES ('t3', 'sec', 'more')`)
			expect(yield* t.runtime.flush).toBe(6)
			expect(alice.frames()).toEqual([
				{ _tag: "Begin", reset: false },
				{
					_tag: "Rows",
					table: "tasks",
					upserts: [{ id: "t3", project_id: "sec", title: "more" }],
					deletes: [],
				},
				{ _tag: "Commit", seq: 6 },
			])
			expect(bob.frames()).toEqual([
				{ _tag: "Begin", reset: false },
				{ _tag: "Rows", table: "tasks", upserts: [], deletes: ["t3"] },
				{ _tag: "Commit", seq: 6 },
			])
			// A socket that has not said Hello gets nothing (its Hello snapshots at head).
			expect(idle.sent).toEqual([])

			// The public project turns private: it leaves bob's view as a delete.
			alice.clear()
			bob.clear()
			yield* t.exec(`UPDATE projects SET private = 1 WHERE id = 'pub'`)
			yield* t.runtime.flush
			expect(deleteKeys(bob, "projects")).toEqual(["pub"])
			expect(upsertIds(alice, "projects")).toEqual([])
			expect(deleteKeys(alice, "projects")).toEqual(["pub"])

			// A flush with nothing new sends nothing.
			alice.clear()
			expect(yield* t.runtime.flush).toBe(7)
			expect(alice.sent).toEqual([])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a dependency change resnapshots only the affected principals", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const { socket: alice } = yield* t.connect({ userId: "alice" })
			const { socket: bob1 } = yield* t.connect({ userId: "bob" })
			const { socket: bob2 } = yield* t.connect({ userId: "bob" })
			for (const socket of [alice, bob1, bob2]) yield* t.hello(socket, null)
			// Seed changes (alice's access among them) flush before the test's own.
			yield* t.runtime.flush
			for (const socket of [alice, bob1, bob2]) socket.clear()
			t.controls.loads.length = 0

			yield* t.exec(`INSERT INTO access (project_id, user_id) VALUES ('sec', 'bob')`)
			yield* t.runtime.flush
			for (const bob of [bob1, bob2]) {
				expect(bob.frames()[0]).toEqual({ _tag: "Begin", reset: true })
				expect(upsertIds(bob, "projects")).toEqual(["pub", "sec"])
				expect(upsertIds(bob, "tasks")).toEqual(["t1", "t2"])
				expect(bob.frames().at(-1)).toEqual({ _tag: "Commit", seq: 6 })
			}
			expect(alice.frames()).toEqual([
				{ _tag: "Begin", reset: false },
				{ _tag: "Commit", seq: 6 },
			])
			// One load per table per principal, not per socket; access itself is not streamed.
			expect(t.controls.loads).toEqual(["projects:bob:all", "tasks:bob:all"])

			// A resnapshot reauthorizes: a refused principal is closed instead.
			t.controls.banned.add("bob")
			yield* t.exec(`DELETE FROM access WHERE user_id = 'bob'`)
			yield* t.runtime.flush
			expect(bob1.closed).toEqual({ code: 4003, reason: "forbidden" })
			expect(bob2.closed).toEqual({ code: 4003, reason: "forbidden" })
			expect(alice.closed).toBeUndefined()
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a catch-up across a dependency change for the principal resnapshots", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			yield* t.exec(`INSERT INTO access (project_id, user_id) VALUES ('sec', 'bob')`)
			const { socket: bob } = yield* t.connect({ userId: "bob" })
			yield* t.hello(bob, 5)
			expect(bob.frames()[0]).toEqual({ _tag: "Begin", reset: true })
			const { socket: alice } = yield* t.connect({ userId: "alice" })
			yield* t.hello(alice, 5)
			expect(alice.frames()[0]).toEqual({ _tag: "Begin", reset: false })
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("chunks Rows frames by count and size", () => {
		const t = setup({ maxRowsPerFrame: 2, maxFrameBytes: 200 })
		return Effect.gen(function* () {
			for (let i = 0; i < 5; i++)
				t.storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p${i}', 'n')`)
			t.storage.db.exec(`INSERT INTO projects (id, name) VALUES ('big', '${"x".repeat(300)}')`)
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			const frames = rowsOf(socket, "projects")
			expect(frames.map((frame) => frame.upserts.length)).toEqual([1, 2, 2, 1])
			expect(frames[0]!.upserts[0]!.id).toBe("big")
			expect(upsertIds(socket, "projects").sort()).toEqual(["big", "p0", "p1", "p2", "p3", "p4"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("splits frames on UTF-8 bytes, not string length", () => {
		const t = setup({ maxFrameBytes: 200 })
		return Effect.gen(function* () {
			// ~90 chars but ~150 bytes each: two fit by length, not by bytes.
			for (const id of ["a", "b"])
				t.storage.db.exec(`INSERT INTO projects (id, name) VALUES ('${id}', '${"é".repeat(60)}')`)
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			expect(rowsOf(socket, "projects").map((frame) => frame.upserts.length)).toEqual([1, 1])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a send failing mid-batch on an open socket closes it with 1011", () => {
		const t = setup()
		return Effect.gen(function* () {
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			const cursor = (socket.deserializeAttachment() as { cursor: number }).cursor
			const realSend = socket.send
			let sends = 0
			socket.send = (data) => {
				// The Begin goes out, then the runtime fails to send (the socket stays open).
				if (++sends > 1) throw new Error("send buffer full")
				realSend(data)
			}
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n')`)
			yield* t.runtime.flush
			expect(socket.closed).toEqual({ code: 1011, reason: "send_failed" })
			expect((socket.deserializeAttachment() as { cursor: number }).cursor).toBe(cursor)
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("an interrupted load interrupts instead of closing the principal's sockets", () => {
		const storage = makeFakeStorage()
		storage.db.exec(TOY_DDL)
		const base = makeToySource(makeToyControls())
		const source = {
			...base,
			tables: base.tables.map((table) => ({ ...table, load: () => Effect.interrupt })),
		}
		const runtime = makeSyncRuntime({ sql: storage.sql, state: makeFakeState(), source })
		return Effect.gen(function* () {
			const socket = makeFakeSocket()
			yield* runtime.adoptSocket(socket, { userId: "bob" })
			const exit = yield* Effect.exit(
				runtime.onMessage(socket, JSON.stringify({ _tag: "Hello", since: null })),
			)
			expect(Exit.hasInterrupts(exit)).toBe(true)
			expect(socket.closed).toBeUndefined()
		}).pipe(Effect.provide(sqliteClientLayer(storage)))
	})

	it.effect("passes at most loadBatchSize keys per load", () => {
		const t = setup({ loadBatchSize: 2 })
		return Effect.gen(function* () {
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			t.controls.loads.length = 0
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n'), ('b', 'n'), ('c', 'n')`)
			yield* t.runtime.flush
			expect(t.controls.loads).toEqual(["projects:bob:a,b", "projects:bob:c"])
			expect(upsertIds(socket, "projects")).toEqual(["a", "b", "c"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("coalesces concurrent flushes", () => {
		const t = setup()
		return Effect.gen(function* () {
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			socket.clear()
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n')`)
			const seqs = yield* Effect.all([t.runtime.flush, t.runtime.flush, t.runtime.flush], {
				concurrency: "unbounded",
			})
			expect(seqs).toEqual([1, 1, 1])
			expect(tags(socket)).toEqual(["Begin", "Rows", "Commit"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("the flush cursor survives a new runtime (eviction)", () => {
		const t = setup()
		return Effect.gen(function* () {
			const { socket } = yield* t.connect({ userId: "bob" })
			yield* t.hello(socket, null)
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n')`)
			yield* t.runtime.flush
			socket.clear()
			const revived = makeSyncRuntime({
				sql: t.storage.sql,
				state: t.state,
				source: makeToySource(t.controls),
			})
			expect(revived.flushedSeq()).toBe(1)
			expect(yield* revived.flush).toBe(1)
			expect(socket.sent).toEqual([])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("closes expired principals with Reauth", () => {
		const t = setup()
		return Effect.gen(function* () {
			const { socket: shortLived } = yield* t.connect({ userId: "bob", expiresAt: 1_000 })
			const { socket: longLived } = yield* t.connect({ userId: "alice", expiresAt: 60_000 })
			yield* t.hello(shortLived, null)
			yield* t.hello(longLived, null)
			expect(t.runtime.deadlines()[1]).toBe(1_000)

			yield* TestClock.adjust(2_000)
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n')`)
			yield* t.runtime.flush
			expect(shortLived.closed).toEqual({ code: 4001, reason: "token_expired" })
			expect(longLived.frames().at(-1)).toEqual({ _tag: "Commit", seq: 1 })

			yield* TestClock.adjust(60_000)
			expect(yield* t.runtime.closeExpired).toBe(1)
			expect(longLived.closed?.code).toBe(4001)

			const { result } = yield* t.connect({ userId: "carol", expiresAt: 1 })
			expect(result).toBe("expired")
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("refuses and revalidates principals", () => {
		const t = setup()
		return Effect.gen(function* () {
			t.controls.banned.add("mallory")
			t.controls.missing.add("ghost")
			const mallory = yield* t.connect({ userId: "mallory" })
			expect(mallory.result).toBe("forbidden")
			expect(mallory.socket.closed?.code).toBe(4003)
			const ghost = yield* t.connect({ userId: "ghost" })
			expect(ghost.result).toBe("not_found")
			expect(ghost.socket.closed?.code).toBe(4004)

			const { socket: alice } = yield* t.connect({ userId: "alice" })
			const { socket: bob } = yield* t.connect({ userId: "bob" })
			t.controls.banned.add("bob")
			expect(yield* t.runtime.revalidate).toBe(1)
			expect(bob.closed?.code).toBe(4003)
			expect(alice.closed).toBeUndefined()
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("answers Ping, rejects bad frames, and closes on a failing load", () => {
		const t = setup()
		return Effect.gen(function* () {
			const { socket: bob } = yield* t.connect({ userId: "bob" })
			const { socket: alice } = yield* t.connect({ userId: "alice" })
			yield* t.runtime.onMessage(bob, JSON.stringify({ _tag: "Ping" }))
			yield* t.runtime.onMessage(bob, "not json")
			yield* t.runtime.onMessage(bob, JSON.stringify({ _tag: "Hello", since: "x" }))
			expect(bob.frames()).toEqual([
				{ _tag: "Pong" },
				{ _tag: "Error", code: "bad_frame", message: "Failed to decode sync frame" },
				{ _tag: "Error", code: "bad_frame", message: "Failed to decode sync frame" },
			])

			yield* t.hello(bob, null)
			yield* t.hello(alice, null)
			t.controls.failing.add("bob")
			yield* t.exec(`INSERT INTO projects (id, name) VALUES ('a', 'n')`)
			expect(yield* t.runtime.flush).toBe(1)
			expect(bob.closed).toEqual({ code: 1011, reason: "internal" })
			expect(alice.frames().at(-1)).toEqual({ _tag: "Commit", seq: 1 })
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a socket without an attachment is closed", () => {
		const t = setup()
		return Effect.gen(function* () {
			const socket = makeFakeSocket()
			yield* t.runtime.onMessage(socket, JSON.stringify({ _tag: "Ping" }))
			expect(socket.closed?.code).toBe(1011)
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("rejects principals too large for an attachment", () => {
		const t = setup()
		return Effect.gen(function* () {
			const error = yield* Effect.flip(
				t.runtime.adoptSocket(makeFakeSocket(), { userId: "x".repeat(3_000) }),
			)
			expect(error._tag).toBe("SyncAttachmentTooLargeError")
			expect(t.state.sockets).toEqual([])
		}).pipe(Effect.provide(t.layer))
	})
})
