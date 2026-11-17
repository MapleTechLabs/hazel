import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { type DiscordChannelInfo, makeDiscordThreadParents } from "./thread-parents"

const PARENT = "111111111111111111"
const THREAD = "222222222222222222"
const CHANNEL = "333333333333333333"

/** A resolver over `channels`, counting Discord lookups; a missing channel fails the lookup. */
const harness = (channels: Record<string, DiscordChannelInfo>) => {
	const lookups: Array<string> = []
	const threads = makeDiscordThreadParents((channelId) => {
		lookups.push(channelId)
		const channel = channels[channelId]
		return channel === undefined ? Effect.fail("not found") : Effect.succeed(channel)
	})
	return { threads, lookups }
}

describe("Discord thread parents", () => {
	it.effect("knows a guild's threads and channels without asking Discord", () =>
		Effect.gen(function* () {
			const { threads, lookups } = harness({})
			threads.rememberAll([{ id: CHANNEL, type: 0 }])
			threads.rememberAll([
				{ id: THREAD, type: 11, parent_id: PARENT, name: " Ship plan ", owner_id: "9" },
			])
			expect(yield* threads.threadOf(THREAD)).toEqual(
				Option.some({ parentId: PARENT, name: "Ship plan", ownerId: "9" }),
			)
			expect(yield* threads.threadOf(CHANNEL)).toEqual(Option.none())
			expect(lookups).toEqual([])
		}),
	)

	it.effect("asks Discord once for a channel it has not seen, then remembers", () =>
		Effect.gen(function* () {
			const { threads, lookups } = harness({
				[THREAD]: { id: THREAD, type: 12, parent_id: PARENT },
				[CHANNEL]: { id: CHANNEL, type: 0, parent_id: "444444444444444444" },
			})
			const thread = Option.some({ parentId: PARENT, name: null, ownerId: null })
			expect(yield* threads.threadOf(THREAD)).toEqual(thread)
			expect(yield* threads.threadOf(THREAD)).toEqual(thread)
			// A category parent is not a thread's.
			expect(yield* threads.threadOf(CHANNEL)).toEqual(Option.none())
			expect(yield* threads.threadOf(CHANNEL)).toEqual(Option.none())
			expect(lookups).toEqual([THREAD, CHANNEL])
		}),
	)

	it.effect("does not remember a failed lookup", () =>
		Effect.gen(function* () {
			const { threads, lookups } = harness({})
			expect(yield* threads.threadOf(THREAD)).toEqual(Option.none())
			expect(yield* threads.threadOf(THREAD)).toEqual(Option.none())
			expect(lookups).toEqual([THREAD, THREAD])
		}),
	)
})
