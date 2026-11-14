/**
 * What the first request of an api isolate waits for besides the script's own start: the route
 * graph (`buildApp`), built over bindings that record every call, so the tables also show what a
 * build asks of D1, KV, R2 and the network. Run with
 * `BENCH=1 bunx vitest run src/worker/http.bench.test.ts --reporter=verbose --silent=false`;
 * `BENCH_D1_MS=<n>` makes each D1 call take that long, which shows the calls a build waits for
 * one after the other.
 *
 * Node on a laptop, so the absolute times are a floor for a Worker's; the shape is what matters.
 */
import { Context, Effect } from "effect"
import { afterEach, describe, it, vi } from "vitest"
import { buildApp } from "./http"
import { makeFakeApiEnv } from "./http-testing"

const RUNS = Number(process.env.BENCH_RUNS ?? 15)

const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

afterEach(() => vi.unstubAllGlobals())

describe.skipIf(!process.env.BENCH)("api route graph", () => {
	it("times a build of the graph a cold isolate's first request waits for", { timeout: 300_000 }, () =>
		Effect.runPromise(
			Effect.gen(function* () {
				const { env, calls } = yield* Effect.promise(() =>
					makeFakeApiEnv({ d1LatencyMs: Number(process.env.BENCH_D1_MS ?? 0) }),
				)
				vi.stubGlobal("fetch", (input: unknown) => {
					calls.push(`fetch ${String(input)}`)
					return new Promise(() => {})
				})
				const build = buildApp(Context.empty(), env, {} as never, {} as never, {} as never)

				const startedAt = performance.now()
				yield* build
				const first = performance.now() - startedAt
				const firstBuildCalls = [...calls]
				const builds: Array<number> = []
				for (let i = 0; i < RUNS; i++) {
					const buildStartedAt = performance.now()
					yield* build
					builds.push(performance.now() - buildStartedAt)
				}
				console.table([
					{
						"first build (cold JIT)": `${first.toFixed(1)} ms`,
						"build, median": `${median(builds).toFixed(1)} ms`,
						"build, max": `${Math.max(...builds).toFixed(1)} ms`,
					},
				])
				console.log("binding and network calls of one build:")
				console.table(firstBuildCalls.map((call) => ({ call })))
			}),
		),
	)
})
