import { createCollection, eq, localOnlyCollectionOptions } from "@tanstack/db"
import { Effect, Fiber, Stream } from "effect"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { liveQueryStream, watchStall } from "./live-query"

type Status = "idle" | "loading" | "ready" | "error" | "cleaned-up"

/** A collection whose status the test moves by hand. */
const fakeCollection = (initial: Status) => {
	let listener: ((event: { status: Status; previousStatus: Status }) => void) | undefined
	const collection = {
		status: initial,
		on: (_event: "status:change", callback: typeof listener) => {
			listener = callback
			return () => {
				listener = undefined
			}
		},
		move(status: Status) {
			const previousStatus = collection.status
			collection.status = status
			listener?.({ status, previousStatus })
		},
		get isWatched() {
			return listener !== undefined
		},
	}
	return collection
}

const watch = (collection: ReturnType<typeof fakeCollection>) => {
	const offered: Array<string> = []
	const emit = vi.fn()
	// The fake has only what the watchdog reads.
	const stop = watchStall(
		collection as never,
		() => "stalled",
		10_000,
		emit,
		(message) => offered.push(message),
	)
	return { offered, emit, stop }
}

describe("watchStall", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	test("a query that loads in time is never reported", () => {
		const collection = fakeCollection("loading")
		const { offered } = watch(collection)
		vi.advanceTimersByTime(9_000)
		collection.move("ready")
		vi.advanceTimersByTime(60_000)
		expect(offered).toEqual([])
	})

	test("a query still loading after the limit is reported once", () => {
		const { offered } = watch(fakeCollection("loading"))
		vi.advanceTimersByTime(10_000)
		vi.advanceTimersByTime(60_000)
		expect(offered).toEqual(["stalled"])
	})

	test("a failed source is reported after a short grace, not at once", () => {
		const collection = fakeCollection("loading")
		const { offered } = watch(collection)
		collection.move("error")
		vi.advanceTimersByTime(2_999)
		expect(offered).toEqual([])
		vi.advanceTimersByTime(1)
		expect(offered).toEqual(["stalled"])
	})

	test("a source that recovers within the grace is not reported, and its rows are emitted again", () => {
		const collection = fakeCollection("loading")
		const { offered, emit } = watch(collection)
		collection.move("error")
		vi.advanceTimersByTime(1_000)
		collection.move("ready")
		vi.advanceTimersByTime(60_000)
		expect(offered).toEqual([])
		expect(emit).toHaveBeenCalledOnce()
	})

	test("a loaded query that later fails is reported, and again after it recovers and fails anew", () => {
		const collection = fakeCollection("ready")
		const { offered } = watch(collection)
		collection.move("error")
		vi.advanceTimersByTime(3_000)
		collection.move("ready")
		collection.move("error")
		vi.advanceTimersByTime(3_000)
		expect(offered).toEqual(["stalled", "stalled"])
	})

	test("stopping clears the timer and the status listener", () => {
		const collection = fakeCollection("loading")
		const { offered, stop } = watch(collection)
		stop()
		vi.advanceTimersByTime(60_000)
		expect(offered).toEqual([])
		expect(collection.isWatched).toBe(false)
	})
})

describe("liveQueryStream", () => {
	test("emits the delete of a row that existed before the stream started", async () => {
		const channels = createCollection(
			localOnlyCollectionOptions({
				id: "live-query-delete",
				getKey: (row: { id: string; type: string }) => row.id,
				initialData: [
					{ id: "c1", type: "public" },
					{ id: "c2", type: "public" },
				],
			}),
		)
		await channels.preload()
		const emissions: Array<ReadonlyArray<string>> = []
		const fiber = Effect.runFork(
			liveQueryStream<{ id: string }, ReadonlyArray<string>>(
				(q) =>
					q
						.from({ channel: channels })
						.where(({ channel }) => eq(channel.type, "public"))
						.select(({ channel }) => ({ id: channel.id })),
				(rows) => rows.map((row) => row.id).sort(),
			).pipe(Stream.runForEach((ids) => Effect.sync(() => emissions.push(ids)))),
		)
		await vi.waitFor(() => expect(emissions.at(-1)).toEqual(["c1", "c2"]))
		channels.delete("c2")
		await vi.waitFor(() => expect(emissions.at(-1)).toEqual(["c1"]))
		await Effect.runPromise(Fiber.interrupt(fiber))
	})

	/** A hold the test settles by hand. */
	const manualHold = () => {
		let settled = false
		const listeners = new Set<() => void>()
		return {
			hold: {
				isSettled: () => settled,
				subscribe: (onChange: () => void) => {
					listeners.add(onChange)
					return () => void listeners.delete(onChange)
				},
			},
			settle: () => {
				settled = true
				for (const listener of listeners) listener()
			},
			listeners,
		}
	}

	const emptyOrgs = (id: string) =>
		createCollection(
			localOnlyCollectionOptions({ id, getKey: (row: { id: string }) => row.id, initialData: [] }),
		)

	test("holds an empty result until the hold settles, then sends it", async () => {
		const orgs = emptyOrgs("live-query-hold")
		await orgs.preload()
		const { hold, settle } = manualHold()
		const emissions: Array<string> = []
		const fiber = Effect.runFork(
			liveQueryStream<{ id: string }, string>(
				(q) => q.from({ org: orgs }),
				(rows) => (rows.length === 0 ? "none" : "some"),
				{ holdEmptyUntil: hold },
			).pipe(Stream.runForEach((message) => Effect.sync(() => emissions.push(message)))),
		)
		await new Promise((resolve) => setTimeout(resolve, 20))
		expect(emissions).toEqual([])
		settle()
		await vi.waitFor(() => expect(emissions).toEqual(["none"]))
		await Effect.runPromise(Fiber.interrupt(fiber))
	})

	test("a held empty result that never settles is reported as stalled, and the hold is released", async () => {
		const orgs = emptyOrgs("live-query-hold-stall")
		await orgs.preload()
		const { hold, listeners } = manualHold()
		const emissions: Array<string> = []
		const fiber = Effect.runFork(
			liveQueryStream<{ id: string }, string>(
				(q) => q.from({ org: orgs }),
				(rows) => (rows.length === 0 ? "none" : "some"),
				{ holdEmptyUntil: hold, onStalled: () => "stalled", stallAfterMs: 30 },
			).pipe(Stream.runForEach((message) => Effect.sync(() => emissions.push(message)))),
		)
		await vi.waitFor(() => expect(emissions).toEqual(["stalled"]))
		await Effect.runPromise(Fiber.interrupt(fiber))
		expect(listeners.size).toBe(0)
	})
})
