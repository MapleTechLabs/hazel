// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The spike's script (`EffectUiSpike` target), in a bare JavaScriptCore context on its own thread with
 * no DOM: mounts the `hazel` ChannelList on `@hazel/ui`'s native host, on the JS-side scheduler (G4),
 * and posts each wire batch to Swift (`__native.post`). Swift answers with `__hazel.fire(id, event, payloadJson)`.
 */
import "./jsc-globals"
import { Renderer } from "@effect/ui"
import { Effect, Scheduler } from "effect"
import { ChannelList, ChannelListMessage } from "../../../packages/ui/src/demo/ChannelList.ts"
import { TextFieldDemo } from "../../../packages/ui/src/demo/TextFieldDemo.ts"
import { makeNativeHost } from "../../../packages/ui/src/native/host.ts"
import { makeNativeScheduler } from "../../../packages/ui/src/native/scheduler.ts"
import { type Json, WIRE_VERSION } from "../../../packages/ui/src/native/wire.ts"
import { sections } from "./sections"

declare const __native: {
	post: (json: string) => void
	/** Launch args: `-HazelScreen textField` mounts G5's demo, `-HazelLatencyMs 30` delays each event. */
	screen?: string
	latencyMs?: number
}

const native = makeNativeHost((batch) => __native.post(JSON.stringify(batch)))
const scheduler = makeNativeScheduler()
let send: ((message: typeof ChannelListMessage.Type) => void) | undefined
let tick = 1_000

Effect.gen(function* () {
	if (__native.screen === "textField") yield* Renderer.mount(TextFieldDemo, {}, native.container)
	else {
		const root = yield* Renderer.mount(
			ChannelList,
			{ sections: sections(), tickMs: 2000 },
			native.container,
		)
		send = root.send
	}
	return yield* Effect.never
}).pipe(
	Effect.provide(native.layer),
	Effect.scoped,
	Effect.provideService(Scheduler.Scheduler, scheduler),
	Effect.runFork,
)

const busy = (ms: number) => {
	const until = performance.now() + ms
	while (performance.now() < until) {}
}

// Debug latency (G5): every event waits before it reaches its handler, so echoes come back late.
const latencyMs = __native.latencyMs ?? 0
const fire = (id: number, event: string, payload: string) =>
	// SAFETY: the shell sends `payload` as JSON.stringify of a plain object (`TreeHost`).
	native.fire(id, event, JSON.parse(payload) as Json)

Object.assign(globalThis, {
	__hazel: {
		version: WIRE_VERSION,
		fire: (id: number, event: string, payload: string) =>
			latencyMs > 0
				? void setTimeout(() => fire(id, event, payload), latencyMs)
				: fire(id, event, payload),
		// G4 measurements: driven by `G4Bench.swift`, not part of the wire.
		debug: {
			message: () => send?.(ChannelListMessage.ReceivedMessage({ tick: tick++ })),
			burst: (count: number) => {
				for (let i = 0; i < count; i++) send?.(ChannelListMessage.ReceivedMessage({ tick: tick++ }))
			},
			stall: busy,
			/** A tight loop's time in ms: tells JIT from no JIT. */
			spin: (iterations: number) => {
				const started = performance.now()
				let acc = 0
				for (let i = 0; i < iterations; i++) acc = (acc + i * 31) % 1_000_003
				return `${(performance.now() - started).toFixed(1)}ms (${acc})`
			},
			stats: () => JSON.stringify(scheduler.stats()),
			/** `count` fiber yields on this runtime's scheduler or Effect's default; logs the wall time. */
			yields: (count: number, which: "native" | "mixed") => {
				const on = which === "native" ? makeNativeScheduler() : new Scheduler.MixedScheduler()
				const started = performance.now()
				Effect.gen(function* () {
					for (let i = 0; i < count; i++) yield* Effect.yieldNow
				}).pipe(
					Effect.provideService(Scheduler.Scheduler, on),
					Effect.tap(() =>
						Effect.sync(() =>
							console.log(
								`[g4] ${count} yields on ${which}: ${(performance.now() - started).toFixed(1)}ms`,
							),
						),
					),
					Effect.runFork,
				)
			},
		},
	},
})
