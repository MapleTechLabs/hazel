import { resolve } from "node:path"
import { heapStats } from "bun:jsc"
import { plugin } from "bun"

/**
 * S2 benchmark: (a) the TanStack DB bridge (`page/chat/data.ts` streams over the legacy query
 * builders) vs (b) a normalized store in the Model (`data/normalized-store.ts`), on the heavy
 * dataset's 10k-message channel. Measures update latency for a new message and a reaction toggle,
 * the initial build, heap, and the dev-mode deep-freeze cost. Run from apps/web-foldkit:
 *
 *   bun run scripts/bench-s2-data.ts [--limits 30,300,3000,10000] [--samples 15]
 */

// `~/db/collections` would open Electric shapes; the benchmark swaps in local collections.
const BENCH_COLLECTIONS = resolve(import.meta.dir, "bench-s2/collections.ts")
plugin({
	name: "bench-local-collections",
	setup(build) {
		build.onLoad({ filter: /apps\/web\/src\/db\/collections\.ts$/ }, () => ({
			contents: `export * from ${JSON.stringify(BENCH_COLLECTIONS)}`,
			loader: "ts",
		}))
	},
})

const args = new Map(
	Bun.argv
		.slice(2)
		.flatMap((arg, index, all) => (arg.startsWith("--") ? [[arg.slice(2), all[index + 1] ?? ""]] : [])),
)
const limits = (args.get("limits") ?? "30,300,3000,10000").split(",").map(Number)
const samples = Number(args.get("samples") ?? "15")

const only = args.get("only")
const heapMb = () => {
	Bun.gc(true)
	return heapStats().heapSize / 1e6
}

// `--heap a|b`: heap held by one open channel, in a fresh process per option.
const heapOption = args.get("heap")
if (heapOption) {
	await import("../../../packages/ui-parity/src/fixtures/datasets/heavy.ts")
	const baseline = heapMb()
	const { setupForHeap } = await import(
		heapOption === "a" ? "./bench-s2/option-a.ts" : "./bench-s2/option-b.ts"
	)
	const retained = await setupForHeap(30)
	console.log(JSON.stringify({ option: heapOption, heapMb: Math.round((heapMb() - baseline) * 10) / 10 }))
	void retained
	process.exit(0)
}

const results: Array<Record<string, unknown>> = []
if (only !== "b") {
	const { runA } = await import("./bench-s2/option-a.ts")
	for (const limit of limits)
		results.push({ option: "a: TanStack DB bridge", limit, ...(await runA(limit, samples)) })
}
if (only !== "a") {
	const { runB } = await import("./bench-s2/option-b.ts")
	for (const limit of limits)
		results.push({ option: "b: normalized store", limit, ...(await runB(limit, samples)) })
}
console.table(results)
console.log(JSON.stringify(results))
process.exit(0)
