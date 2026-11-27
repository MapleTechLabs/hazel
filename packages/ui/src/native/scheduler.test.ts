// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Renderer } from "@effect/ui"
import { Effect, Scheduler } from "effect"
import { describe, expect, it } from "vitest"
import { ChannelList } from "../demo/ChannelList.ts"
import { makeNativeHost } from "./host.ts"
import { makeNativeScheduler } from "./scheduler.ts"
import type { Batch } from "./wire.ts"

describe("makeNativeScheduler", () => {
	it("runs yields on microtasks, never on the host", async () => {
		const yields: Array<() => void> = []
		const scheduler = makeNativeScheduler({ yieldToHost: (resume) => yields.push(resume) })
		const program = Effect.gen(function* () {
			for (let i = 0; i < 50; i++) yield* Effect.yieldNow
			return "done"
		})
		const result = await Effect.runPromise(
			program.pipe(Effect.provideService(Scheduler.Scheduler, scheduler)),
		)
		expect(result).toBe("done")
		expect(yields).toHaveLength(0)
		expect(scheduler.stats().tasks).toBeGreaterThanOrEqual(50)
	})

	it("gives the host a turn once a burst runs past its budget", async () => {
		let clock = 0
		const yields: Array<() => void> = []
		const scheduler = makeNativeScheduler({
			budgetMs: 8,
			now: () => clock,
			yieldToHost: (resume) => yields.push(resume),
		})
		const dispatcher = scheduler.makeDispatcher()
		const ran: Array<number> = []
		for (let i = 0; i < 5; i++)
			dispatcher.scheduleTask(() => {
				ran.push(i)
				clock += 5
			}, 0)
		await Promise.resolve()
		expect(ran).toEqual([0, 1])
		expect(yields).toHaveLength(1)
		yields.shift()!()
		expect(ran).toEqual([0, 1, 2, 3])
		yields.shift()!()
		expect(ran).toEqual([0, 1, 2, 3, 4])
		expect(scheduler.stats().hostYields).toBe(2)
	})

	it("runs lower priorities first", async () => {
		const scheduler = makeNativeScheduler()
		const dispatcher = scheduler.makeDispatcher()
		const ran: Array<string> = []
		dispatcher.scheduleTask(() => ran.push("background"), 1)
		dispatcher.scheduleTask(() => ran.push("blocking"), -1)
		dispatcher.scheduleTask(() => ran.push("visible"), 0)
		await Promise.resolve()
		expect(ran).toEqual(["blocking", "visible", "background"])
	})

	it("mounts the channel list without a host timer", async () => {
		const realSetTimeout = globalThis.setTimeout
		let hostTimers = 0
		const batches: Array<Batch> = []
		const scheduler = makeNativeScheduler({
			yieldToHost: (resume) => {
				hostTimers++
				realSetTimeout(resume, 0)
			},
		})
		const native = makeNativeHost((batch) => batches.push(batch))
		await Effect.runPromise(
			Effect.gen(function* () {
				yield* Renderer.mount(ChannelList, { sections: [], tickMs: 2 }, native.container)
				yield* Effect.promise(() => new Promise((resolve) => realSetTimeout(resolve, 30)))
			}).pipe(
				Effect.provide(native.layer),
				Effect.scoped,
				Effect.provideService(Scheduler.Scheduler, scheduler),
			),
		)
		expect(batches.length).toBeGreaterThan(0)
		expect(hostTimers).toBe(0)
		expect(scheduler.stats().tasks).toBeGreaterThan(0)
	})
})
