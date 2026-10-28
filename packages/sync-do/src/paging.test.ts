import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { makeSyncRuntime } from "./runtime.ts"
import { makePagedSource, PAGED_DDL, type PagedPrincipal } from "./test/paged-source.ts"
import {
	type FakeSocket,
	makeFakeSocket,
	makeFakeState,
	makeFakeStorage,
	sqliteClientLayer,
} from "./testing.ts"

type Frame = { readonly _tag: string } & Record<string, any>

const setup = (snapshotLimit = 3, maxLimit = 100) => {
	const storage = makeFakeStorage()
	storage.db.exec(PAGED_DDL)
	const state = makeFakeState()
	const pages: Array<string> = []
	const source = makePagedSource({ snapshotLimit, maxLimit, pages })
	const runtime = makeSyncRuntime({ sql: storage.sql, state, source })
	const exec = (statement: string) =>
		Effect.flatMap(SqlClient, (sql) => sql.unsafe(statement)).pipe(Effect.asVoid)
	const connect = (principal: PagedPrincipal = { userId: "alice" }) =>
		Effect.map(Effect.sync(makeFakeSocket), (socket) => socket).pipe(
			Effect.tap((socket) => runtime.adoptSocket(socket, principal)),
		)
	const send = (socket: FakeSocket, frame: unknown) => runtime.onMessage(socket, JSON.stringify(frame))
	return { storage, runtime, exec, connect, send, pages, layer: sqliteClientLayer(storage) }
}

const frames = (socket: FakeSocket) => socket.frames() as Array<Frame>

const upsertIds = (socket: FakeSocket, table: string) =>
	frames(socket)
		.filter((frame) => frame._tag === "Rows" && frame.table === table)
		.flatMap((frame) => (frame.upserts as Array<{ id: string }>).map((row) => row.id))

/** Notes n1…n7, n3/n4/n5 sharing one `created_at` (ties break on `id`); a like on n1 and n6. */
const SEED = `
	INSERT INTO notes (id, created_at, body) VALUES
		('n1', '2026-01-01T00:00:01.000Z', 'one'),
		('n2', '2026-01-01T00:00:02.000Z', 'two'),
		('n3', '2026-01-01T00:00:03.000Z', 'three'),
		('n4', '2026-01-01T00:00:03.000Z', 'four'),
		('n5', '2026-01-01T00:00:03.000Z', 'five'),
		('n6', '2026-01-01T00:00:06.000Z', 'six'),
		('n7', '2026-01-01T00:00:07.000Z', 'seven');
	INSERT INTO likes (id, note_id) VALUES ('l1', 'n1'), ('l6', 'n6');
`

describe("sync runtime paging", () => {
	it.effect("a snapshot sends the newest window, its dependents only, and the window", () => {
		const t = setup(3)
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const socket = yield* t.connect()
			yield* t.send(socket, { _tag: "Hello", since: null })
			expect(frames(socket)[0]).toEqual({
				_tag: "Begin",
				reset: true,
				windows: [
					{
						table: "notes",
						oldest: { createdAt: "2026-01-01T00:00:03.000Z", id: "n5" },
						hasMore: true,
					},
				],
			})
			expect(upsertIds(socket, "notes")).toEqual(["n7", "n6", "n5"])
			expect(upsertIds(socket, "likes")).toEqual(["l6"])
			expect(
				frames(socket)
					.slice(-2)
					.map((frame) => frame._tag),
			).toEqual(["Commit", "Ready"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("pages walk the history once, ties on createdAt included", () => {
		const t = setup(3, 2)
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const socket = yield* t.connect()
			yield* t.send(socket, { _tag: "Hello", since: null })
			const seq = frames(socket).find((frame) => frame._tag === "Commit")!.seq
			let window = frames(socket)[0]!.windows[0]
			const seen = upsertIds(socket, "notes")
			let requestId = 0
			while (window.hasMore) {
				socket.clear()
				// Asks for more than `maxLimit`: clamped to 2.
				yield* t.send(socket, {
					_tag: "LoadOlder",
					requestId: ++requestId,
					table: "notes",
					before: window.oldest,
					limit: 50,
				})
				const begin = frames(socket)[0]!
				expect(begin).toMatchObject({ _tag: "Begin", reset: false, request: requestId })
				expect(frames(socket).at(-1)).toEqual({ _tag: "Commit", seq })
				window = begin.windows[0]
				seen.push(...upsertIds(socket, "notes"))
				if (upsertIds(socket, "notes").includes("n1"))
					expect(upsertIds(socket, "likes")).toEqual(["l1"])
			}
			expect(seen).toEqual(["n7", "n6", "n5", "n4", "n3", "n2", "n1"])
			expect(window).toEqual({
				table: "notes",
				oldest: { createdAt: "2026-01-01T00:00:01.000Z", id: "n1" },
				hasMore: false,
			})
			expect(t.pages.slice(1)).toEqual([
				"2026-01-01T00:00:03.000Z/n5:2",
				"2026-01-01T00:00:03.000Z/n3:2",
			])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("deltas reach rows outside the snapshot window", () => {
		const t = setup(3)
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const socket = yield* t.connect()
			yield* t.send(socket, { _tag: "Hello", since: null })
			yield* t.runtime.flush
			socket.clear()

			yield* t.exec(`UPDATE notes SET body = 'edited' WHERE id = 'n1'`)
			yield* t.exec(`INSERT INTO likes (id, note_id) VALUES ('l2', 'n2')`)
			yield* t.exec(`DELETE FROM notes WHERE id = 'n2'`)
			yield* t.runtime.flush
			expect(frames(socket)[0]).toEqual({ _tag: "Begin", reset: false })
			expect(upsertIds(socket, "notes")).toEqual(["n1"])
			expect(upsertIds(socket, "likes")).toEqual(["l2"])
			expect(
				frames(socket).flatMap((frame) =>
					frame._tag === "Rows" && frame.table === "notes" ? frame.deletes : [],
				),
			).toEqual(["n2"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a catch-up keeps the window; a resnapshot resends the newest window", () => {
		const t = setup(3)
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const first = yield* t.connect()
			yield* t.send(first, { _tag: "Hello", since: null })
			const seq = frames(first).find((frame) => frame._tag === "Commit")!.seq

			yield* t.exec(`UPDATE notes SET body = 'edited' WHERE id = 'n1'`)
			const resumed = yield* t.connect()
			yield* t.send(resumed, { _tag: "Hello", since: seq })
			// No `windows`: the client keeps the pages it holds.
			expect(frames(resumed)[0]).toEqual({ _tag: "Begin", reset: false })
			expect(upsertIds(resumed, "notes")).toEqual(["n1"])
			yield* t.runtime.flush
			resumed.clear()

			yield* t.exec(`INSERT INTO members (user_id) VALUES ('bob')`)
			yield* t.runtime.flush
			expect(frames(resumed)[0]).toMatchObject({
				_tag: "Begin",
				reset: true,
				windows: [{ table: "notes", hasMore: true }],
			})
			expect(upsertIds(resumed, "notes")).toEqual(["n7", "n6", "n5"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("LoadOlder before Hello is refused; an unpaged table answers an empty last page", () => {
		const t = setup(3)
		return Effect.gen(function* () {
			t.storage.db.exec(SEED)
			const socket = yield* t.connect()
			const before = { createdAt: "2026-01-01T00:00:03.000Z", id: "n5" }
			yield* t.send(socket, { _tag: "LoadOlder", requestId: 1, table: "notes", before, limit: 2 })
			expect(frames(socket)).toEqual([
				{ _tag: "Error", code: "bad_frame", message: "LoadOlder before Hello" },
			])

			yield* t.send(socket, { _tag: "Hello", since: null })
			socket.clear()
			yield* t.send(socket, { _tag: "LoadOlder", requestId: 2, table: "likes", before, limit: 2 })
			expect(frames(socket).map((frame) => frame._tag)).toEqual(["Begin", "Commit"])
			expect(frames(socket)[0]).toEqual({
				_tag: "Begin",
				reset: false,
				request: 2,
				windows: [{ table: "likes", oldest: before, hasMore: false }],
			})
		}).pipe(Effect.provide(t.layer))
	})
})
