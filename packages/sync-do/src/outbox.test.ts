import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { TestClock } from "effect/testing"
import { earliest, scheduleAlarm } from "./alarm.ts"
import { OutboxDeliveryError } from "./errors.ts"
import {
	backoffDelayMs,
	DEFAULT_BACKOFF,
	drainOutbox,
	enqueue,
	installOutbox,
	makeOutbox,
	nextInboxPruneAt,
	nextOutboxAlarm,
	type OutboxRow,
	pruneInbox,
	withInbox,
} from "./outbox.ts"
import { makeSyncedObject } from "./synced-object.ts"
import { makeToyControls, makeToySource, TOY_DDL } from "./test/toy-source.ts"
import { makeFakeSocket, makeFakeState, makeFakeStorage, sqliteClientLayer } from "./testing.ts"

const setup = () => {
	const storage = makeFakeStorage()
	installOutbox(storage.sql)
	installOutbox(storage.sql)
	return { storage, layer: sqliteClientLayer(storage) }
}

const outboxRows = (storage: ReturnType<typeof makeFakeStorage>) =>
	storage.db
		.prepare(`SELECT id, target, attempts, next_at, status, last_error FROM _outbox ORDER BY rowid`)
		.all()

class Boom {
	readonly _tag = "Boom"
}

/** A delivery function that fails for targets in `failing` and records what it delivered. */
const recorder = () => {
	const delivered: Array<string> = []
	const failing = new Map<string, OutboxDeliveryError>()
	const deliver = (row: OutboxRow) =>
		Effect.suspend(() => {
			const error = failing.get(row.target)
			if (error !== undefined) return Effect.fail(error)
			delivered.push(row.id)
			return Effect.void
		})
	return { delivered, failing, deliver }
}

describe("outbox", () => {
	it.effect("enqueue joins the caller's transaction", () => {
		const t = setup()
		return Effect.gen(function* () {
			const sql = yield* SqlClient
			const failed = yield* sql
				.withTransaction(
					Effect.gen(function* () {
						yield* enqueue({ id: "rolled-back", target: "org:1", kind: "k", payload: { a: 1 } })
						return yield* Effect.fail(new Boom())
					}),
				)
				.pipe(Effect.flip)
			expect(failed).toBeInstanceOf(Boom)
			expect(outboxRows(t.storage)).toEqual([])

			yield* sql.withTransaction(enqueue({ id: "kept", target: "org:1", kind: "k", payload: { a: 1 } }))
			expect(outboxRows(t.storage)).toMatchObject([{ id: "kept", attempts: 0, status: "pending" }])
			// Enqueuing an id twice keeps the first row.
			yield* enqueue({ id: "kept", target: "org:2", kind: "k", payload: null })
			expect(outboxRows(t.storage)).toMatchObject([{ id: "kept", target: "org:1" }])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("delivers in order per target and backs off a failing target alone", () => {
		const t = setup()
		return Effect.gen(function* () {
			const r = recorder()
			yield* enqueue({ id: "a1", target: "A", kind: "k", payload: { n: 1 } })
			yield* enqueue({ id: "b1", target: "B", kind: "k", payload: { n: 2 } })
			yield* enqueue({ id: "a2", target: "A", kind: "k", payload: { n: 3 } })
			r.failing.set("A", new OutboxDeliveryError({ message: "A is down" }))

			const first = yield* drainOutbox(r.deliver)
			expect(r.delivered).toEqual(["b1"])
			expect(first).toMatchObject({ delivered: 1, retried: 1, dead: 0 })
			const [a1, a2] = outboxRows(t.storage) as Array<{
				next_at: number
				attempts: number
				last_error: string
			}>
			expect(a1).toMatchObject({ attempts: 1, last_error: "A is down" })
			// a2 waits behind a1 without an attempt of its own.
			expect(a2).toMatchObject({ attempts: 0 })
			expect(a1!.next_at).toBeGreaterThanOrEqual(3_750)
			expect(a1!.next_at).toBeLessThanOrEqual(6_250)
			// The alarm follows the head, not the (overdue) row behind it.
			expect(first.nextAt).toBe(a1!.next_at)
			expect(yield* nextOutboxAlarm).toBe(a1!.next_at)

			// Not due yet: nothing is attempted, a2 still waits.
			yield* drainOutbox(r.deliver)
			expect(outboxRows(t.storage)).toMatchObject([
				{ id: "a1", attempts: 1 },
				{ id: "a2", attempts: 0 },
			])

			r.failing.delete("A")
			yield* TestClock.adjust(7_000)
			const last = yield* drainOutbox(r.deliver)
			// The target's queue continues in order within one drain.
			expect(r.delivered).toEqual(["b1", "a1", "a2"])
			expect(last.nextAt).toBeUndefined()
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a target in backoff with a long queue does not starve the others", () => {
		const t = setup()
		return Effect.gen(function* () {
			const r = recorder()
			for (let i = 0; i < 150; i++)
				yield* enqueue({ id: `a${i}`, target: "A", kind: "k", payload: null })
			yield* enqueue({ id: "b1", target: "B", kind: "k", payload: null })
			r.failing.set("A", new OutboxDeliveryError({ message: "A is down" }))
			yield* drainOutbox(r.deliver)
			r.failing.clear()
			// A's head is backing off; B (behind A's 150 rows by rowid) still goes out.
			r.failing.set("A", new OutboxDeliveryError({ message: "still down" }))
			yield* enqueue({ id: "c1", target: "C", kind: "k", payload: null })
			const result = yield* drainOutbox(r.deliver)
			expect(r.delivered).toEqual(["b1", "c1"])
			expect(result.retried).toBe(0)
			const head = (outboxRows(t.storage)[0] as { next_at: number }).next_at
			expect(result.nextAt).toBe(head)
			expect(head).toBeGreaterThan(0)
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a notBefore head holds its target and sets the next alarm", () => {
		const t = setup()
		return Effect.gen(function* () {
			const r = recorder()
			yield* enqueue({ id: "later", target: "A", kind: "k", payload: null, notBefore: 60_000 })
			yield* enqueue({ id: "after", target: "A", kind: "k", payload: null })
			const result = yield* drainOutbox(r.deliver)
			expect(r.delivered).toEqual([])
			expect(result.nextAt).toBe(60_000)
			yield* TestClock.adjust(60_000)
			yield* drainOutbox(r.deliver)
			expect(r.delivered).toEqual(["later", "after"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("retryable failures retry forever with capped backoff, never dead", () => {
		const t = setup()
		return Effect.gen(function* () {
			const r = recorder()
			yield* enqueue({ id: "a1", target: "A", kind: "k", payload: null })
			r.failing.set("A", new OutboxDeliveryError({ message: "down" }))
			for (let i = 0; i < 30; i++) {
				const result = yield* drainOutbox(r.deliver)
				expect(result.dead).toBe(0)
				yield* TestClock.adjust(DEFAULT_BACKOFF.capMs * 1.25)
			}
			const [row] = outboxRows(t.storage) as Array<{
				status: string
				attempts: number
				next_at: number
			}>
			expect(row).toMatchObject({ status: "pending", attempts: 30 })
			r.failing.delete("A")
			yield* drainOutbox(r.deliver)
			expect(r.delivered).toEqual(["a1"])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a hung delivery times out as a retryable failure", () => {
		const t = setup()
		return Effect.gen(function* () {
			yield* enqueue({ id: "h", target: "H", kind: "k", payload: null })
			const fiber = yield* Effect.forkChild(
				drainOutbox(() => Effect.never, { deliveryTimeoutMs: 1_000 }),
			)
			yield* TestClock.adjust(1_000)
			const result = yield* Fiber.join(fiber)
			expect(result).toMatchObject({ delivered: 0, retried: 1, dead: 0 })
			expect(outboxRows(t.storage)).toMatchObject([
				{ id: "h", status: "pending", attempts: 1, last_error: "Delivery timed out after 1000ms" },
			])
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("a non-retryable error or a defect counts as an attempt", () => {
		const t = setup()
		return Effect.gen(function* () {
			yield* enqueue({ id: "x", target: "X", kind: "k", payload: null })
			yield* enqueue({ id: "y", target: "Y", kind: "k", payload: null })
			yield* enqueue({ id: "x2", target: "X", kind: "k2", payload: null })
			yield* drainOutbox((row) =>
				row.target === "X"
					? Effect.fail(new OutboxDeliveryError({ message: "rejected", retryable: false }))
					: Effect.die(new Error("kaput")),
			)
			// A dead row no longer blocks its target: x2 (also rejected) is attempted in the same drain.
			expect(outboxRows(t.storage)).toMatchObject([
				{ id: "x", status: "dead", attempts: 1, last_error: "rejected" },
				{ id: "y", status: "pending", attempts: 1 },
				{ id: "x2", status: "dead", attempts: 1 },
			])
			expect((outboxRows(t.storage)[1] as { last_error: string }).last_error).toContain("kaput")
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("deliverNow sends urgent kinds past a held drain and backs off a failure once", () => {
		const t = setup()
		return Effect.gen(function* () {
			const gate = yield* Deferred.make<void>()
			const reached = yield* Deferred.make<void>()
			const r = recorder()
			const deliver = (row: OutboxRow) =>
				row.target === "slow"
					? Effect.andThen(Deferred.succeed(reached, undefined), Deferred.await(gate))
					: r.deliver(row)
			const outbox = makeOutbox(deliver)
			yield* enqueue({ id: "s1", target: "slow", kind: "k", payload: null })
			const drain = yield* Effect.forkChild(outbox.drain)
			yield* Deferred.await(reached)

			// Behind a non-urgent head of their own target, and while the drain holds the permit.
			yield* enqueue({ id: "c0", target: "C", kind: "k", payload: null })
			yield* enqueue({ id: "c1", target: "C", kind: "urgent", payload: null })
			yield* enqueue({ id: "d1", target: "D", kind: "urgent", payload: null })
			r.failing.set("D", new OutboxDeliveryError({ message: "D is down" }))
			yield* outbox.drainIfIdle
			expect(r.delivered).toEqual([])
			const result = yield* outbox.deliverNow(["urgent"])
			expect(result).toMatchObject({ delivered: 1, retried: 1 })
			expect(r.delivered).toEqual(["c1"])
			// The failed row waits for the drain's backoff, not the next write's deliverNow.
			expect(outboxRows(t.storage)).toMatchObject([
				{ id: "s1", attempts: 0 },
				{ id: "c0", attempts: 0 },
				{ id: "d1", attempts: 1, last_error: "D is down" },
			])
			r.failing.delete("D")
			yield* outbox.deliverNow(["urgent"])
			expect(r.delivered).toEqual(["c1"])

			yield* Deferred.succeed(gate, undefined)
			yield* Fiber.join(drain)
		}).pipe(Effect.provide(t.layer))
	})

	it("backoff grows exponentially with jitter, capped", () => {
		expect(backoffDelayMs(1, 0.5)).toBe(5_000)
		expect(backoffDelayMs(2, 0.5)).toBe(10_000)
		expect(backoffDelayMs(3, 0)).toBe(15_000)
		expect(backoffDelayMs(3, 0.999)).toBeLessThanOrEqual(25_000)
		expect(backoffDelayMs(20, 0.999)).toBe(DEFAULT_BACKOFF.capMs)
		expect(backoffDelayMs(20, 0)).toBe(DEFAULT_BACKOFF.capMs * 0.75)
	})
})

describe("inbox", () => {
	it.effect("runs an effect once per key, and not at all if it fails", () => {
		const t = setup()
		return Effect.gen(function* () {
			let runs = 0
			const work = Effect.sync(() => ++runs)
			expect(yield* withInbox("k1", work)).toEqual(Option.some(1))
			expect(yield* withInbox("k1", work)).toEqual(Option.none())
			expect(runs).toBe(1)

			// The effect's writes and the key commit together: a failure records neither.
			const sql = yield* SqlClient
			yield* sql`CREATE TABLE IF NOT EXISTS effects (id TEXT)`
			const failing = Effect.gen(function* () {
				yield* sql`INSERT INTO effects (id) VALUES ('half')`
				return yield* Effect.fail(new Boom())
			})
			yield* Effect.flip(withInbox("k2", failing))
			expect(t.storage.db.prepare(`SELECT * FROM effects`).all()).toEqual([])
			expect(yield* withInbox("k2", work)).toEqual(Option.some(2))

			// Inside a caller's transaction that rolls back, the key is forgotten too.
			yield* Effect.flip(
				sql.withTransaction(Effect.andThen(withInbox("k3", work), Effect.fail(new Boom()))),
			)
			expect(yield* withInbox("k3", work)).toEqual(Option.some(4))
		}).pipe(Effect.provide(t.layer))
	})

	it.effect("prunes keys past retention", () => {
		const t = setup()
		return Effect.gen(function* () {
			yield* withInbox("old", Effect.void)
			expect(yield* nextInboxPruneAt(1_000)).toBe(1_000)
			yield* TestClock.adjust(1_000)
			yield* withInbox("new", Effect.void)
			yield* pruneInbox(1_000)
			expect(t.storage.db.prepare(`SELECT key FROM _inbox`).all()).toEqual([{ key: "new" }])
		}).pipe(Effect.provide(t.layer))
	})
})

describe("alarm", () => {
	it.effect("arms the earliest deadline, keeping an earlier pending alarm", () =>
		Effect.gen(function* () {
			const storage = makeFakeStorage()
			expect(earliest([undefined, 30, null, 10])).toBe(10)
			expect(yield* scheduleAlarm(storage, [undefined])).toBeUndefined()
			expect(storage.alarm()).toBeNull()

			yield* TestClock.adjust(10_000)
			expect(yield* scheduleAlarm(storage, [50_000, 20_000])).toBe(20_000)
			expect(yield* scheduleAlarm(storage, [30_000])).toBe(20_000)
			expect(yield* scheduleAlarm(storage, [15_000])).toBe(15_000)
			// Overdue deadlines fire soon, not in a hot loop.
			expect(yield* scheduleAlarm(storage, [0])).toBe(11_000)
		}),
	)
})

describe("synced object", () => {
	it.effect("afterCommit flushes, delivers, and arms the alarm", () => {
		const storage = makeFakeStorage()
		storage.db.exec(TOY_DDL)
		const state = makeFakeState()
		const r = recorder()
		const object = makeSyncedObject({
			storage,
			state,
			source: makeToySource(makeToyControls()),
			deliver: r.deliver,
		})
		return Effect.gen(function* () {
			const socket = makeFakeSocket()
			yield* object.sync.adoptSocket(socket, { userId: "bob" })
			yield* object.sync.onMessage(socket, JSON.stringify({ _tag: "Hello", since: null }))
			socket.clear()

			const sql = yield* SqlClient
			yield* sql.withTransaction(
				Effect.gen(function* () {
					yield* sql`INSERT INTO projects (id, name) VALUES ('p1', 'One')`
					yield* enqueue({
						id: "evt-1",
						target: "org:1",
						kind: "project.created",
						payload: { id: "p1" },
					})
				}),
			)
			expect(yield* object.afterCommit).toBe(1)
			expect(socket.frames().map((frame) => frame._tag)).toEqual(["Begin", "Rows", "Commit"])
			expect(r.delivered).toEqual(["evt-1"])
			// Nothing to retry, and one change is inside the retention floor: no alarm.
			expect(storage.alarm()).toBeNull()

			r.failing.set("org:1", new OutboxDeliveryError({ message: "down" }))
			yield* enqueue({ id: "evt-2", target: "org:1", kind: "k", payload: null })
			yield* object.afterCommit
			expect(storage.alarm()).toBeLessThanOrEqual(6_250)

			r.failing.delete("org:1")
			yield* TestClock.adjust(10_000)
			yield* object.alarm
			expect(r.delivered).toEqual(["evt-1", "evt-2"])
		}).pipe(Effect.provide(sqliteClientLayer(storage)))
	})

	it.effect("afterCommit is total: a rejected setAlarm or a failing flush still returns the seq", () => {
		const storage = makeFakeStorage()
		storage.db.exec(TOY_DDL)
		const controls = makeToyControls()
		const object = makeSyncedObject({
			storage: {
				sql: storage.sql,
				getAlarm: storage.getAlarm,
				setAlarm: () => Promise.reject(new Error("storage reset")),
			},
			state: makeFakeState(),
			source: makeToySource(controls),
			deliver: () => Effect.void,
		})
		return Effect.gen(function* () {
			yield* enqueue({ id: "e", target: "T", kind: "k", payload: null, notBefore: 60_000 })
			storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p1', 'One')`)
			expect(yield* object.afterCommit).toBe(1)
		}).pipe(Effect.provide(sqliteClientLayer(storage)))
	})

	it.effect("afterCommit survives a flush defect; the alarm flushes what was left", () => {
		const storage = makeFakeStorage()
		storage.db.exec(TOY_DDL)
		let broken = true
		const state = makeFakeState()
		const realGet = state.getWebSockets
		// A defect inside the flush (outside `guarded`): reading the sockets throws.
		state.getWebSockets = (tag) => {
			if (broken) throw new Error("boom")
			return realGet(tag)
		}
		const object = makeSyncedObject({
			storage,
			state,
			source: makeToySource(makeToyControls()),
			deliver: () => Effect.void,
		})
		return Effect.gen(function* () {
			storage.db.exec(`INSERT INTO projects (id, name) VALUES ('p1', 'One')`)
			expect(yield* object.afterCommit).toBe(1)
			expect(object.sync.flushedSeq()).toBe(0)
			// The unflushed commit arms an alarm (deadlines() is broken too, so arm it directly).
			broken = false
			yield* object.schedule
			expect(storage.alarm()).toBe(1_000)
			yield* object.alarm
			expect(object.sync.flushedSeq()).toBe(1)
		}).pipe(Effect.provide(sqliteClientLayer(storage)))
	})
})
