import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { holdLikelyNext, MAX_PREFETCHED, prefetchKey } from "./prefetch"

describe("prefetchKey", () => {
	it("puts notified channels first, drops repeats, and caps the set", () => {
		assert.strictEqual(prefetchKey(["c", "a"], ["b", "a"]), "a,c,b")
		const many = Array.from({ length: 20 }, (_, i) => `ch${String(i).padStart(2, "0")}`)
		assert.strictEqual(prefetchKey([], many).split(",").length, MAX_PREFETCHED)
		assert.strictEqual(prefetchKey([], []), "")
	})

	it("is the same key whatever order the rows arrive in", () => {
		assert.strictEqual(prefetchKey(["b", "a"], ["d", "c"]), prefetchKey(["a", "b"], ["c", "d"]))
	})
})

describe("holdLikelyNext", () => {
	it.live("retains the settled set, and swaps it when a channel is read", () =>
		Effect.gen(function* () {
			const notified = yield* SubscriptionRef.make<ReadonlyArray<string>>(["mention"])
			const unread = yield* SubscriptionRef.make<ReadonlyArray<string>>(["busy", "quiet"])
			// Leases counted per channel, as the sync hub counts them.
			const leases = new Map<string, number>()
			const held = () => [...leases].flatMap(([id, n]) => (n > 0 ? [id] : [])).sort()
			const log: Array<string> = []
			const retain = (ids: ReadonlyArray<string>): Stream.Stream<never> =>
				Stream.callback<never>(() =>
					Effect.acquireRelease(
						Effect.sync(() => {
							log.push(`retain ${ids.join(",")}`)
							for (const id of ids) leases.set(id, (leases.get(id) ?? 0) + 1)
						}),
						() =>
							Effect.sync(() => {
								log.push(`release ${ids.join(",")}`)
								for (const id of ids) leases.set(id, (leases.get(id) ?? 0) - 1)
							}),
					).pipe(Effect.flatMap(() => Effect.never)),
				)
			const fiber = yield* holdLikelyNext(
				SubscriptionRef.changes(notified),
				SubscriptionRef.changes(unread),
				retain,
				"30 millis",
			).pipe(Stream.runDrain, Effect.forkChild)

			// Nothing is held until the rows have settled.
			yield* Effect.sleep("5 millis")
			assert.deepStrictEqual(log, [])
			yield* Effect.sleep("200 millis")
			assert.deepStrictEqual(held(), ["busy", "mention", "quiet"])

			// `quiet` was read: the set is swapped for the smaller one.
			yield* SubscriptionRef.set(unread, ["busy"])
			yield* Effect.sleep("200 millis")
			assert.deepStrictEqual(held(), ["busy", "mention"])
			assert.sameMembers(log, [
				"retain mention,busy,quiet",
				"release mention,busy,quiet",
				"retain mention,busy",
			])

			// The same set again changes nothing.
			yield* SubscriptionRef.set(unread, ["busy"])
			yield* Effect.sleep("200 millis")
			assert.strictEqual(log.length, 3)

			yield* Fiber.interrupt(fiber)
			assert.deepStrictEqual(held(), [])
		}),
	)
})
