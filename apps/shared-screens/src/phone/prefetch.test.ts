import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Stream, SubscriptionRef } from "effect"
import { ChannelId } from "@hazel/schema"
import { holdLikelyNext, MAX_PREFETCHED, prefetchKey } from "./prefetch"

/** Test channels by name: each a UUID, numbered in name order so they sort as their names do. */
const NAMES = [
	"a",
	"b",
	"busy",
	"c",
	"d",
	"mention",
	"quiet",
	...Array.from({ length: 20 }, (_, i) => `ch${String(i).padStart(2, "0")}`),
].sort()
const idOf = (name: string) =>
	ChannelId.make(`00000000-0000-4000-8000-${String(NAMES.indexOf(name)).padStart(12, "0")}`)
const nameOf = (id: string) => NAMES[Number(id.slice(-12))] ?? id
const ids = (...names: Array<string>) => names.map(idOf)
/** A key's channels by name. */
const named = (key: string) => key.split(",").map(nameOf).join(",")

describe("prefetchKey", () => {
	it("puts notified channels first, drops repeats, and caps the set", () => {
		assert.strictEqual(named(prefetchKey(ids("c", "a"), ids("b", "a"))), "a,c,b")
		const many = ids(...Array.from({ length: 20 }, (_, i) => `ch${String(i).padStart(2, "0")}`))
		assert.strictEqual(prefetchKey([], many).split(",").length, MAX_PREFETCHED)
		assert.strictEqual(prefetchKey([], []), "")
	})

	it("is the same key whatever order the rows arrive in", () => {
		assert.strictEqual(
			prefetchKey(ids("b", "a"), ids("d", "c")),
			prefetchKey(ids("a", "b"), ids("c", "d")),
		)
	})
})

describe("holdLikelyNext", () => {
	it.live("retains the settled set, and swaps it when a channel is read", () =>
		Effect.gen(function* () {
			const notified = yield* SubscriptionRef.make<ReadonlyArray<ChannelId>>(ids("mention"))
			const unread = yield* SubscriptionRef.make<ReadonlyArray<ChannelId>>(ids("busy", "quiet"))
			// Leases counted per channel, as the sync hub counts them.
			const leases = new Map<string, number>()
			const held = () => [...leases].flatMap(([id, n]) => (n > 0 ? [id] : [])).sort()
			const log: Array<string> = []
			const retain = (channelIds: ReadonlyArray<ChannelId>): Stream.Stream<never> =>
				Stream.callback<never>(() =>
					Effect.acquireRelease(
						Effect.sync(() => {
							log.push(`retain ${channelIds.map(nameOf).join(",")}`)
							for (const id of channelIds)
								leases.set(nameOf(id), (leases.get(nameOf(id)) ?? 0) + 1)
						}),
						() =>
							Effect.sync(() => {
								log.push(`release ${channelIds.map(nameOf).join(",")}`)
								for (const id of channelIds)
									leases.set(nameOf(id), (leases.get(nameOf(id)) ?? 0) - 1)
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
			yield* SubscriptionRef.set(unread, ids("busy"))
			yield* Effect.sleep("200 millis")
			assert.deepStrictEqual(held(), ["busy", "mention"])
			assert.sameMembers(log, [
				"retain mention,busy,quiet",
				"release mention,busy,quiet",
				"retain mention,busy",
			])

			// The same set again changes nothing.
			yield* SubscriptionRef.set(unread, ids("busy"))
			yield* Effect.sleep("200 millis")
			assert.strictEqual(log.length, 3)

			yield* Fiber.interrupt(fiber)
			assert.deepStrictEqual(held(), [])
		}),
	)
})
