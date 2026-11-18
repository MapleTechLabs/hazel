/**
 * How long an evicted object takes to wake: a new in-memory instance over storage that is already
 * migrated, which is what the first request after an eviction waits for (a sync upgrade, most
 * often). Run with `BENCH=1 bunx vitest run src/worker/objects/activation.bench.test.ts`.
 *
 * Node on a laptop, so the absolute times are a floor for a Worker's; the shape is what matters.
 */
import { Effect, type Scope } from "effect"
import { describe, it } from "vitest"
import { channelTarget, customersTarget, orgTarget, userTarget, type ObjectTarget } from "./kinds"
import { makeTestObjects } from "./testing"

const RUNS = Number(process.env.BENCH_RUNS ?? 15)

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const median = (values: ReadonlyArray<number>) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

describe.skipIf(!process.env.BENCH)("object activation", () => {
	it("times a wake of each kind", { timeout: 300_000 }, () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const id = () => crypto.randomUUID() as never
				const targets: ReadonlyArray<ObjectTarget> = [
					userTarget(id()),
					orgTarget(id()),
					channelTarget(id()),
					customersTarget(id()),
				]
				const rows: Array<Record<string, string>> = []
				for (const target of targets) {
					const startedAt = performance.now()
					yield* objects.get(target)
					const first = performance.now() - startedAt
					const wakes: Array<number> = []
					for (let i = 0; i < RUNS; i++) {
						const wakeStartedAt = performance.now()
						yield* objects.reactivate(target)
						wakes.push(performance.now() - wakeStartedAt)
					}
					rows.push({
						kind: target.kind,
						"first activation (migrates)": `${first.toFixed(1)} ms`,
						"wake, median": `${median(wakes).toFixed(1)} ms`,
						"wake, max": `${Math.max(...wakes).toFixed(1)} ms`,
					})
				}
				console.table(rows)
			}),
		),
	)
})
