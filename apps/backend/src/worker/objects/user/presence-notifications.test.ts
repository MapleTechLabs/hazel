/**
 * Notifications and push against presence, simulated end to end (`./presence-sim.ts`): a teammate
 * mentions Ada in #general through the real channel and org objects, and the test checks what Ada
 * gets (a notification, silent or not, a push to her phone, now or later) for each of Discord's
 * rules.
 */
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { makePresenceSim, minutes, seconds } from "./presence-sim"
import { PUSH_IDLE_DELAY_MS } from "./push"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** Ada (with a phone registered) and Grace in #general. */
const world = Effect.gen(function* () {
	const sim = yield* makePresenceSim
	const ada = yield* sim.user("Ada")
	const grace = yield* sim.user("Grace")
	const general = yield* sim.channel("general", [ada, grace])
	yield* ada.registerPhone()
	const mention = (text: string) => general.post(grace, text, { mention: ada })
	return { sim, ada, grace, general, mention }
})

describe("notifications and push by presence", { timeout: 60_000 }, () => {
	it("offline: notified, and pushed at once", () =>
		run(
			Effect.gen(function* () {
				const { ada, general, mention } = yield* world
				yield* mention("lunch?")
				expect(yield* ada.notifications()).toEqual([{ silent: false }])
				expect(ada.pushes()).toEqual([expect.stringContaining("lunch?")])
				expect(general.unread(ada)).toBe(1)
			}),
		))

	it("active at a computer: the push waits, and goes out if still unread", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, mention } = yield* world
				yield* ada.device("desktop").open()
				yield* mention("lunch?")
				expect(yield* ada.notifications()).toEqual([{ silent: false }])
				expect(ada.pushes()).toEqual([])
				yield* sim.advance(PUSH_IDLE_DELAY_MS + seconds(1))
				expect(ada.pushes()).toHaveLength(1)
			}),
		))

	it("active at a computer and reads it there: never pushed", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, general, mention } = yield* world
				yield* ada.device("desktop").open()
				yield* mention("lunch?")
				yield* sim.advance(seconds(20))
				yield* general.read(ada)
				yield* sim.advance(minutes(5))
				expect(ada.pushes()).toEqual([])
			}),
		))

	it("AFK at the computer: pushed at once", () =>
		run(
			Effect.gen(function* () {
				const { ada, mention } = yield* world
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.report({ idle: true, afk: true })
				yield* mention("lunch?")
				expect(ada.pushes()).toHaveLength(1)
			}),
		))

	it("an older client gone AFK (its away): pushed at once; back online: the push waits", () =>
		run(
			Effect.gen(function* () {
				const { ada, mention } = yield* world
				yield* ada.device("web").open({ legacy: true })
				yield* ada.legacyUpdate({ status: "away" })
				yield* mention("first")
				expect(ada.pushes()).toEqual([expect.stringContaining("first")])
				yield* ada.legacyUpdate({ status: "online" })
				yield* mention("second")
				expect(ada.pushes()).toHaveLength(1)
			}),
		))

	it("using the phone app: the push waits like on a computer", () =>
		run(
			Effect.gen(function* () {
				const { ada, mention } = yield* world
				yield* ada.device("mobile").open()
				yield* mention("lunch?")
				expect(ada.pushes()).toEqual([])
			}),
		))

	it("reading the channel: no notification, no badge, no push", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, general, mention } = yield* world
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.report({ focus: general.id })
				yield* mention("lunch?")
				yield* sim.advance(minutes(5))
				expect(yield* ada.notifications()).toEqual([])
				expect(general.unread(ada)).toBe(0)
				expect(ada.pushes()).toEqual([])
			}),
		))

	it("the channel open but AFK at the desk: notified", () =>
		run(
			Effect.gen(function* () {
				const { ada, general, mention } = yield* world
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* laptop.report({ focus: general.id, idle: true, afk: true })
				yield* mention("lunch?")
				expect(yield* ada.notifications()).toEqual([{ silent: false }])
				expect(ada.pushes()).toHaveLength(1)
			}),
		))

	it("invisible behaves as online: reading skips it, active defers the push", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, general, mention } = yield* world
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* ada.pick("invisible")
				yield* laptop.report({ focus: general.id })
				yield* mention("first")
				expect(yield* ada.notifications()).toEqual([])
				expect(general.unread(ada)).toBe(0)

				yield* laptop.report({ focus: null })
				yield* mention("second")
				expect(yield* ada.notifications()).toEqual([{ silent: false }])
				expect(ada.pushes()).toEqual([])
				yield* sim.advance(PUSH_IDLE_DELAY_MS + seconds(1))
				expect(ada.pushes()).toEqual([expect.stringContaining("second")])
			}),
		))

	it("dnd: the badge counts, but silently, and nothing is pushed", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, general, mention } = yield* world
				yield* ada.pick("dnd")
				yield* mention("offline")
				const laptop = ada.device("desktop")
				yield* laptop.open()
				yield* mention("online")
				yield* sim.advance(minutes(5))
				expect(yield* ada.notifications()).toEqual([{ silent: true }, { silent: true }])
				expect(general.unread(ada)).toBe(2)
				expect(ada.pushes()).toEqual([])
			}),
		))

	it("dnd picked while a push waits holds it back", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, mention } = yield* world
				yield* ada.device("desktop").open()
				yield* mention("lunch?")
				yield* sim.advance(seconds(30))
				yield* ada.pick("dnd")
				yield* sim.advance(minutes(5))
				expect(ada.pushes()).toEqual([])
			}),
		))

	it("dnd for 15 minutes: pushes come back after", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, mention } = yield* world
				yield* ada.pick("dnd", minutes(15))
				yield* mention("during")
				yield* sim.advance(minutes(16))
				yield* mention("after")
				expect(ada.pushes()).toEqual([expect.stringContaining("after")])
				expect(yield* ada.notifications()).toEqual([{ silent: true }, { silent: false }])
			}),
		))

	it("paused notifications: silent and never pushed, whatever the status", () =>
		run(
			Effect.gen(function* () {
				const { sim, ada, mention } = yield* world
				yield* ada.legacyUpdate({ suppressNotifications: true })
				yield* sim.advance(seconds(1))
				yield* mention("lunch?")
				expect(yield* ada.notifications()).toEqual([{ silent: true }])
				expect(ada.pushes()).toEqual([])
			}),
		))
})
