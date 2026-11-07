/**
 * Native vs web on the same scenario and the same offline fixture: boot to #general, type
 * "Hello from Rune" into the composer, press Enter. Native runs the Rune host's `--capture` mode,
 * web runs `bench/web/run.ts` in Chromium. Writes medians to `bench/out/report.md`.
 *
 *   bun bench/run.ts [--runs 5] [--skip-web]
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const here = new URL(".", import.meta.url).pathname
const appDir = join(here, "..")
const outDir = join(here, "out")
mkdirSync(outDir, { recursive: true })

const argValue = (name: string) => {
	const at = process.argv.indexOf(name)
	return at === -1 ? undefined : process.argv[at + 1]
}
const runs = Number(argValue("--runs") ?? 5)
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs takes a positive integer")
const skipWeb = process.argv.includes("--skip-web")
const webResultsPath = join(here, "web/out/results.json")
if (skipWeb && !existsSync(webResultsPath))
	throw new Error("--skip-web reuses web/out/results.json, which does not exist yet: run once without it")
const host = join(appDir, "host/target/release/hazel-native")
if (!existsSync(host)) throw new Error("Build the host first: bun run host:build")
// The packaged app ships a bundled runtime, so measure that build.
if (spawnSync("bun", ["run", "build"], { cwd: appDir, stdio: "ignore" }).status !== 0)
	throw new Error("bun run build failed")

type Summary = { n: number; p50: number; p95: number; max: number }
type NativeRun = {
	firstTreeMs: number
	textReadyMs: number
	settledMs: number
	trees: number
	frameWithTreeMs: Summary
	idleFrameMs: Summary
	interactions: Array<{ perKey?: Summary; roundTripMs?: number | null }>
	rssKb: Array<{ pid: number; rssKb: number }>
	hostPid: number
	heapUsedMb: number
}

const median = (values: ReadonlyArray<number>) => {
	const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b)
	return sorted.length === 0 ? Number.NaN : (sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN)
}

const nativeRun = (index: number): NativeRun => {
	const script = join(outDir, "native-script.json")
	const snap = (name: string) => (index === 0 ? [{ snap: join(outDir, `native-${name}.png`) }] : [])
	const steps = [
		{ waitText: "Shipping it. Thanks everyone" },
		{ settle: 2500 },
		...snap("settled"),
		{ focusEditable: null },
		{ type: "Hello from Rune" },
		// The round trip ends when the sent message is on screen, not at the first tree after Enter.
		{ key: { name: "Enter", until: "Hello from Rune" } },
		{ settle: 800 },
		...snap("sent"),
	]
	writeFileSync(script, JSON.stringify(steps))
	const benchOut = join(outDir, `native-run${index}.json`)
	const stats = join(outDir, `native-run${index}-stats.jsonl`)
	rmSync(stats, { force: true })
	const result = spawnSync(host, ["--capture", script], {
		cwd: appDir,
		env: {
			...process.env,
			NATIVE_BENCH_OUT: benchOut,
			NATIVE_STATS: stats,
			HAZEL_NATIVE_ENTRY: "dist/entry.js",
		},
		stdio: ["ignore", "ignore", "pipe"],
		timeout: 120_000,
	})
	if (result.status !== 0)
		throw new Error(`native run ${index} failed: ${result.stderr.toString().slice(-2000)}`)
	// SAFETY: the host's `--capture` mode writes this file in the NativeRun shape.
	const run = JSON.parse(readFileSync(benchOut, "utf8")) as Omit<NativeRun, "heapUsedMb">
	// Both processes are measured, or the run's memory figures would be silently partial.
	const hostSample = run.rssKb.some((p) => p.pid === run.hostPid)
	const runtimeSample = run.rssKb.some((p) => p.pid !== run.hostPid)
	if (!hostSample || !runtimeSample)
		throw new Error(`native run ${index} is missing an RSS sample: ${JSON.stringify(run.rssKb)}`)
	const lastStats = readFileSync(stats, "utf8").trim().split("\n").at(-1) ?? "{}"
	// SAFETY: entry.ts writes each NATIVE_STATS line with a numeric `heapUsedMb`.
	const { heapUsedMb } = JSON.parse(lastStats) as { heapUsedMb?: number }
	return { ...run, heapUsedMb: heapUsedMb ?? Number.NaN }
}

const native = Array.from({ length: runs }, (_, i) => {
	const run = nativeRun(i)
	process.stdout.write(`native run ${i + 1}/${runs}: settled ${run.settledMs.toFixed(0)} ms\n`)
	return run
})

const keyRuns = native.map((r) => r.interactions.find((i) => i.perKey)?.perKey)
const sendRuns = native.map((r) => r.interactions.find((i) => "roundTripMs" in i)?.roundTripMs ?? Number.NaN)
const rssMb = (r: NativeRun, isHost: boolean) =>
	(r.rssKb.find((p) => (p.pid === r.hostPid) === isHost)?.rssKb ?? Number.NaN) / 1024
const nativeSummary = {
	firstTreeMs: median(native.map((r) => r.firstTreeMs)),
	textReadyMs: median(native.map((r) => r.textReadyMs)),
	settledMs: median(native.map((r) => r.settledMs)),
	keyP50Ms: median(keyRuns.map((k) => k?.p50 ?? Number.NaN)),
	keyP95Ms: median(keyRuns.map((k) => k?.p95 ?? Number.NaN)),
	keyMaxMs: median(keyRuns.map((k) => k?.max ?? Number.NaN)),
	sendMs: median(sendRuns),
	frameWithTreeP50Ms: median(native.map((r) => r.frameWithTreeMs.p50)),
	frameWithTreeP95Ms: median(native.map((r) => r.frameWithTreeMs.p95)),
	idleFrameP50Ms: median(native.map((r) => r.idleFrameMs.p50)),
	hostRssMb: median(native.map((r) => rssMb(r, true))),
	runtimeRssMb: median(native.map((r) => rssMb(r, false))),
	heapUsedMb: median(native.map((r) => r.heapUsedMb)),
}

if (!skipWeb) {
	const web = spawnSync("bun", [join(here, "web/run.ts"), "--runs", String(runs)], {
		cwd: appDir,
		stdio: "inherit",
	})
	if (web.status !== 0) throw new Error("web benchmark failed")
}
// SAFETY: web/run.ts writes results.json in this shape just above.
const webResults = JSON.parse(readFileSync(webResultsPath, "utf8")) as {
	chromium: string
	summary: Record<string, number>
	runs: ReadonlyArray<unknown>
}
const webRuns = webResults.runs.length
const web = webResults.summary

// Event Timing reports only keys at or over 16 ms, so its count is the number of slow keys.
const slowKeys = web.keyEventTimingReported
const keyEventTiming =
	slowKeys === undefined
		? "Event Timing: n/a"
		: slowKeys === 0
			? "Event Timing: every key under 16 ms"
			: `Event Timing: ${slowKeys} keys at or over 16 ms`
const ms = (value: number | undefined) =>
	value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(1)} ms`
const mb = (value: number | undefined) =>
	value === undefined || !Number.isFinite(value) ? "n/a" : `${value.toFixed(0)} MB`
const table = [
	"| Metric | Native (Rune + Bun) | Web (Chromium) |",
	"| --- | --- | --- |",
	`| Process start to first app frame | ${ms(nativeSummary.firstTreeMs)} | ${ms(web.firstContentfulPaintMs)} (FCP, from navigation) |`,
	`| Process start to #general's messages in a frame | ${ms(nativeSummary.textReadyMs)} (frame built, before GPU present) | ${ms(web.launchToContentReadyMs)} (${ms(web.contentReadyMs)} from navigation) |`,
	`| Process start to settled (incl. editor) | ${ms(nativeSummary.settledMs)} | ${ms(web.launchToSettledMs)} |`,
	`| Key to frame, p50 / p95 | ${ms(nativeSummary.keyP50Ms)} / ${ms(nativeSummary.keyP95Ms)} (frame built) | first rAF ${ms(web.keyFirstRafP50Ms)} / ${ms(web.keyFirstRafP95Ms)}; ${keyEventTiming} |`,
	`| Enter to sent message on screen | ${ms(nativeSummary.sendMs)} | ${ms(web.sendToVisibleMs)} |`,
	`| Frame CPU with a new tree, p50 / p95 | ${ms(nativeSummary.frameWithTreeP50Ms)} / ${ms(nativeSummary.frameWithTreeP95Ms)} | n/a |`,
	`| Memory, all processes | ${mb(nativeSummary.hostRssMb + nativeSummary.runtimeRssMb)} (host ${mb(nativeSummary.hostRssMb)}, runtime ${mb(nativeSummary.runtimeRssMb)}) | ${mb(web.rssSentMb)} |`,
	`| JS heap used | ${mb(nativeSummary.heapUsedMb)} | ${mb(web.jsHeapUsedSentMb)} |`,
].join("\n")

const report = `# Hazel: native (Rune) vs web (Chromium)

Median of ${runs} native and ${webRuns} web runs${skipWeb ? " (web results reused from an earlier run)" : ""}, 1280x800 at 2x, offline fixture (#general, 60 messages), same scenario:
boot, type "Hello from Rune", press Enter. Chromium ${webResults.chromium}, headless.

${table}

Native times end when the frame is built on the CPU (layout and draw list); presentation then
waits for the next vsync. Web "messages on screen" is the first animation frame after they are in
the DOM. The browser can't build a frame before the next requestAnimationFrame, so its key figure
is Event Timing's input-to-next-paint, which reports only keys at or over 16 ms.
`
writeFileSync(join(outDir, "report.md"), report)
writeFileSync(
	join(outDir, "native-summary.json"),
	`${JSON.stringify({ summary: nativeSummary, runs: native }, null, "\t")}\n`,
)
process.stdout.write(`\n${report}`)
