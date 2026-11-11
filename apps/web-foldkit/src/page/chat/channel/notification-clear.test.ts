import { describe, expect, test } from "vitest"
import {
	type Effect,
	type Event,
	init,
	type Model,
	RETRY_MAX_MS,
	retryDelayMs,
	transition,
	transitionAll,
} from "./notification-clear"

/** The clear state machine: example transitions, then a simulated world it must always settle in. */

const ready: Event = { _tag: "ChangedReady", isReady: true }
const unread = (count: number): Event => ({ _tag: "ChangedUnread", unread: count })
const focus = (isFocused: boolean): Event => ({ _tag: "ChangedFocus", isFocused })
const succeeded: Event = { _tag: "Succeeded" }
const failed: Event = { _tag: "Failed", isChannelGone: false }
const gone: Event = { _tag: "Failed", isChannelGone: true }
const elapsed: Event = { _tag: "ElapsedRetry" }
const markedRead: Event = { _tag: "MarkedRead" }
const SEND: Effect = { _tag: "Send" }

const run = (events: ReadonlyArray<Event>, from: Model = init({ isFocused: true })) =>
	transitionAll(from, events)

/** Entered, cleared once, and back to watching the badge. */
const settled = (isFocused = true) => run([ready, succeeded], init({ isFocused })).model

describe("entering the channel", () => {
	test("clears once the page is ready, and only once", () => {
		expect(run([]).effects).toEqual([])
		expect(run([ready]).effects).toEqual([SEND])
		expect(run([ready, ready, unread(0), focus(true)]).effects).toEqual([SEND])
	})

	test("clears even when opened in a background window", () => {
		expect(run([ready], init({ isFocused: false })).effects).toEqual([SEND])
	})

	test("a badge before the page is ready waits for it, then sends one clear", () => {
		const result = run([unread(3), focus(true), ready])
		expect(result.effects).toEqual([SEND])
		expect(result.model.phase._tag).toBe("Sending")
	})
})

describe("a badge on the open channel", () => {
	test("is cleared again while the window is focused", () => {
		expect(run([unread(1)], settled()).effects).toEqual([SEND])
	})

	test("a zero count sends nothing", () => {
		expect(run([unread(0), unread(0)], settled()).effects).toEqual([])
	})

	test("stays while the window is in the background and clears when focus returns", () => {
		const background = run([focus(false), unread(2), unread(3)], settled())
		expect(background.effects).toEqual([])
		expect(run([focus(true)], background.model).effects).toEqual([SEND])
	})

	test("losing focus while a badge clears does not cancel that clear", () => {
		const sending = run([unread(1)], settled()).model
		const result = run([focus(false), succeeded], sending)
		expect(result.effects).toEqual([])
		expect(result.model.phase._tag).toBe("Settled")
	})

	test("never runs two clears at once", () => {
		const result = run([ready, unread(1), unread(2), focus(false), focus(true), markedRead])
		expect(result.effects).toEqual([SEND])
	})

	test("counted while a clear is in flight is cleared once that clear lands", () => {
		const result = run([ready, unread(1), succeeded])
		expect(result.effects).toEqual([SEND, SEND])
	})

	test("a clear that lands with the badge already at zero settles", () => {
		const result = run([ready, unread(1), unread(0), succeeded])
		expect(result.effects).toEqual([SEND])
		expect(result.model.phase._tag).toBe("Settled")
	})

	test("signing out stops further clears until ready again", () => {
		const result = run([{ _tag: "ChangedReady", isReady: false }, unread(4)], settled())
		expect(result.effects).toEqual([])
		expect(run([ready], result.model).effects).toEqual([SEND])
	})
})

describe("failures", () => {
	test("are retried after a growing backoff, capped", () => {
		const first = run([ready, failed])
		expect(first.effects).toEqual([SEND, { _tag: "WaitRetry", delayMs: retryDelayMs(1) }])
		const second = run([elapsed, failed], first.model)
		expect(second.effects).toEqual([SEND, { _tag: "WaitRetry", delayMs: retryDelayMs(2) }])
		expect(retryDelayMs(2)).toBe(2 * retryDelayMs(1))
		expect(retryDelayMs(100)).toBe(RETRY_MAX_MS)
	})

	test("a retry clears even with no badge (the failed clear was the visit's first)", () => {
		expect(run([ready, failed, elapsed]).effects.at(-1)).toEqual(SEND)
	})

	test("a success resets the backoff", () => {
		const result = run([ready, failed, elapsed, failed, elapsed, succeeded, unread(1), failed])
		expect(result.effects.at(-1)).toEqual({ _tag: "WaitRetry", delayMs: retryDelayMs(1) })
	})

	test("nothing goes out while waiting out a backoff", () => {
		expect(run([unread(5), focus(false), focus(true)], run([ready, failed]).model).effects).toEqual([])
	})

	test("a channel that is gone is not retried", () => {
		const result = run([ready, gone])
		expect(result.effects).toEqual([SEND])
		expect(result.model.phase._tag).toBe("Settled")
	})

	test("stray results with nothing in flight change nothing", () => {
		const model = settled()
		for (const event of [succeeded, failed, gone, elapsed]) {
			expect(transition(model, event)).toEqual({ model, effect: null })
		}
	})
})

describe("marking the channel read", () => {
	test("clears now, even with no badge", () => {
		expect(run([markedRead], settled()).effects).toEqual([SEND])
	})

	test("skips the backoff of a failed clear", () => {
		const result = run([markedRead], run([ready, failed]).model)
		expect(result.effects).toEqual([SEND])
		// The backoff that was running no longer sends a second clear.
		expect(run([elapsed], result.model).effects).toEqual([])
	})

	test("an entry clear sent by it is not sent again once the page is ready", () => {
		const result = run([markedRead, ready, succeeded])
		expect(result.effects).toEqual([SEND])
		expect(result.model.phase._tag).toBe("Settled")
	})
})

/**
 * A simulated world: the server's count for this member, a sync stream that delivers the server's
 * values to the page in order and late, a clear RPC that can fail, and a window that gains and
 * loses focus. Messages arrive while presence says the user is (or is not yet) reading the
 * channel: the server skips those it can see the user reading, like `notification-rules.ts`.
 *
 * Whatever happens, once the world goes quiet with the window focused and the page ready, the
 * server count, and the badge the page shows, are zero, and no two clears ever overlap.
 */
describe("simulated world", () => {
	/** mulberry32: a small seeded PRNG so a failing seed replays. */
	const prng = (seed: number) => () => {
		seed = (seed + 0x6d2b79f5) | 0
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}

	interface World {
		model: Model
		serverCount: number
		/** Server values not yet synced to the page, oldest first. */
		syncQueue: Array<number>
		/** A clear sent and not answered: `applied` once the server has zeroed the count. */
		rpc: null | { applied: boolean; seqAt: number; willFail: boolean }
		/** The server write index; the RPC answers only after its write has synced (`awaitSeq`). */
		serverSeq: number
		syncedSeq: number
		retryPending: boolean
		isFocused: boolean
		/** Presence on the server: whether it reports this channel as being read. */
		presenceReading: boolean
		maxInFlight: number
	}

	const deliver = (world: World, event: Event) => {
		const result = transition(world.model, event)
		world.model = result.model
		if (result.effect?._tag === "Send") {
			if (world.rpc !== null) world.maxInFlight = 2
			world.rpc = { applied: false, seqAt: 0, willFail: false }
		}
		if (result.effect?._tag === "WaitRetry") world.retryPending = true
	}

	const write = (world: World, count: number) => {
		world.serverCount = count
		world.serverSeq += 1
		world.syncQueue.push(count)
	}

	const step = (world: World, random: () => number, quiet: boolean) => {
		const roll = random()
		const actions: Array<() => void> = []
		if (!quiet) {
			actions.push(() => {
				// A message: counted unless presence says the user is reading this channel.
				if (!world.presenceReading) write(world, world.serverCount + 1)
			})
			actions.push(() => {
				world.isFocused = !world.isFocused
				deliver(world, focus(world.isFocused))
			})
			actions.push(() => deliver(world, markedRead))
		}
		// Presence catches up with the window (the 300ms debounce, then the write).
		actions.push(() => {
			world.presenceReading = world.isFocused
		})
		// The sync stream delivers the oldest unsynced value.
		actions.push(() => {
			const value = world.syncQueue.shift()
			if (value === undefined) return
			world.syncedSeq += 1
			deliver(world, unread(value))
		})
		// The server applies the in-flight clear (or refuses it).
		actions.push(() => {
			const rpc = world.rpc
			if (rpc === null || rpc.applied) return
			rpc.willFail = !quiet && random() < 0.25
			if (!rpc.willFail) write(world, 0)
			rpc.applied = true
			rpc.seqAt = world.serverSeq
		})
		// The clear answers, a success only once its write has synced.
		actions.push(() => {
			const rpc = world.rpc
			if (rpc === null || !rpc.applied) return
			if (rpc.willFail) {
				world.rpc = null
				deliver(world, failed)
			} else if (world.syncedSeq >= rpc.seqAt) {
				world.rpc = null
				deliver(world, succeeded)
			}
		})
		actions.push(() => {
			if (!world.retryPending) return
			world.retryPending = false
			deliver(world, elapsed)
		})
		actions[Math.floor(roll * actions.length)]!()
	}

	const isQuiet = (world: World) =>
		world.syncQueue.length === 0 &&
		world.rpc === null &&
		!world.retryPending &&
		world.presenceReading === world.isFocused

	test.each(Array.from({ length: 400 }, (_, seed) => seed))("seed %i settles with no badge", (seed) => {
		const random = prng(seed + 1)
		const world: World = {
			model: init({ isFocused: true }),
			serverCount: Math.floor(random() * 3),
			syncQueue: [],
			rpc: null,
			serverSeq: 0,
			syncedSeq: 0,
			retryPending: false,
			isFocused: true,
			presenceReading: false,
			maxInFlight: 1,
		}
		world.syncQueue.push(world.serverCount)
		deliver(world, ready)

		for (let i = 0; i < 200; i++) step(world, random, false)
		// The user comes back to the window; then the world drains (no new messages, no failures).
		if (!world.isFocused) {
			world.isFocused = true
			deliver(world, focus(true))
		}
		for (let i = 0; i < 2_000 && !isQuiet(world); i++) step(world, random, true)

		expect(isQuiet(world)).toBe(true)
		expect(world.maxInFlight).toBe(1)
		expect(world.serverCount).toBe(0)
		expect(world.model.unread).toBe(0)
		expect(world.model.phase._tag).toBe("Settled")
	})
})
