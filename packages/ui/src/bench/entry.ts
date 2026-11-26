// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The G7 bench in a bare JavaScriptCore context (`HazelUI` tests and the Bench app). Swift calls
 * `__bench.start`, drains `tick()` until it returns -1, and reads the batches with `take()`.
 */
import { tick } from "./jsc-globals.ts"
import { type Bench, defaults, makeBench } from "./harness.ts"
import type { Json } from "../native/wire.ts"
import type { Option } from "./MessageList.ts"

let bench: Bench | undefined

Object.assign(globalThis, {
	__bench: {
		start: (option: Option, initial: number) => {
			bench = makeBench(defaults(option, initial))
			bench.start()
		},
		tick,
		fire: (event: string, payload: string) => bench?.fire(event, JSON.parse(payload) as Json) ?? false,
		/** Batches since the last take, one JSON per line, and their op count first: `"<ops>\n..."`. */
		take: () => {
			const taken = bench?.take()
			return taken === undefined || taken.batches.length === 0 ? "" : `${taken.ops}\n${taken.json}`
		},
		nodeCount: () => bench?.nodeCount() ?? 0,
	},
})
