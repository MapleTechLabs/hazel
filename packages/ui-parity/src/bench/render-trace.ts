import { parseArgs } from "node:util"
import { chromium } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import { buildDir, FIXTURE_BACKEND_PORT, FIXTURE_ELECTRIC_PORT, targets, type TargetName } from "../config.ts"
import { heavyIds } from "../fixtures/datasets/heavy.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"
import { prepareList } from "./chat-list-probes.ts"

/**
 * Where a scroll frame goes: scrolls the heavy channel up 40 px per frame for 30 frames under a
 * CPU profile and a timeline trace, then prints the busiest functions and rendering phases.
 *
 *   PARITY_PORT_BASE=5750 bun run src/bench/render-trace.ts [--target foldkit|legacy|legacy-head]
 */

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: { target: { type: "string", default: "foldkit" } },
})
const target = values.target as TargetName
const dataset = datasets.get("heavy")!
const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: "heavy",
})
const server = serveStatic(buildDir(target), targets[target].port, clerkIdentityFor(dataset))
const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS)
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`http://localhost:${targets[target].port}/${heavyIds.orgSlug}/chat/${heavyIds.bigChannelId}`)
await prepareList(page)

const cdp = await page.context().newCDPSession(page)
await cdp.send("Profiler.enable")
await cdp.send("Profiler.setSamplingInterval", { interval: 200 })
await browser.startTracing(page, { categories: ["devtools.timeline"] })
await cdp.send("Profiler.start")
await page.evaluate(async () => {
	let scroller = document.querySelector("[data-id]")!.parentElement!
	while (
		!(
			scroller.scrollHeight > scroller.clientHeight + 1 &&
			/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)
		)
	)
		scroller = scroller.parentElement!
	for (let frame = 0; frame < 30; frame++) {
		scroller.scrollTop -= 40
		await new Promise((resolve) => requestAnimationFrame(resolve))
	}
})
const { profile } = await cdp.send("Profiler.stop")
const trace = JSON.parse((await browser.stopTracing()).toString()) as {
	traceEvents: Array<{ ph: string; name: string; dur?: number }>
}

const selfMs = new Map<string, number>()
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
profile.samples?.forEach((id, index) => {
	const frame = nodes.get(id)!.callFrame
	const key = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`
	selfMs.set(key, (selfMs.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000)
})
const phases = new Map<string, number>()
for (const event of trace.traceEvents)
	if (event.ph === "X" && event.dur)
		phases.set(event.name, (phases.get(event.name) ?? 0) + event.dur / 1000)
const top = (entries: Map<string, number>, count: number) =>
	[...entries]
		.sort((a, b) => b[1] - a[1])
		.slice(0, count)
		.map(([key, ms]) => `  ${ms.toFixed(1).padStart(8)} ms  ${key}`)
		.join("\n")
console.log(`functions (self time):\n${top(selfMs, 18)}\nphases:\n${top(phases, 10)}`)
await browser.close()
server.stop(true)
await backend.stop()
