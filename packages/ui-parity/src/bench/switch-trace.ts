import { parseArgs } from "node:util"
import { chromium, type Page } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import { buildDir, FIXTURE_BACKEND_PORT, FIXTURE_ELECTRIC_PORT, targets, type TargetName } from "../config.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"

/**
 * Where a channel switch goes: walks the busiest channels in `--path` order (the default opens the
 * busiest, visits the next, and returns) and traces the last switch under a CPU profile and a timeline
 * trace: the busiest functions, each long task with its layouts, and the frames until a row paints.
 *
 *   PARITY_PORT_BASE=5750 bun run src/bench/switch-trace.ts [--target foldkit] [--dataset heavy] [--dir build] [--path 0,1,2,3,f,0,1]
 */

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		target: { type: "string", default: "foldkit" },
		dataset: { type: "string", default: "heavy" },
		/** Serve another build of the target (e.g. an unminified one for readable function names). */
		dir: { type: "string" },
		/** Busiest-channel indexes to visit in order (`f` = #firehose); the last visit is traced. */
		path: { type: "string", default: "0,1,0" },
	},
})
const target = values.target as TargetName
const dataset = datasets.get(values.dataset)!
const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: dataset.name,
})
const server = serveStatic(values.dir ?? buildDir(target), targets[target].port, clerkIdentityFor(dataset))
const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS)
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" })
await context.addInitScript((identity) => {
	;(window as unknown as { __parityClerkIdentity: unknown }).__parityClerkIdentity = identity
}, clerkIdentityFor(dataset))
const page = await context.newPage()

const messages = dataset.tables.messages ?? []
const member = new Set(
	(dataset.tables.channel_members ?? [])
		.filter((row) => row.userId === dataset.currentUser.id)
		.map((row) => String(row.channelId)),
)
const busiest = (dataset.tables.channels ?? [])
	.filter((row) => member.has(String(row.id)) && row.type !== "thread" && row.name !== "firehose")
	.map((row) => ({ id: String(row.id), count: messages.filter((m) => m.channelId === row.id).length }))
	.sort((a, b) => b.count - a.count)
	.map((channel) => channel.id)
const firehose = (dataset.tables.channels ?? []).find((row) => row.name === "firehose")
const path = values.path
	.split(",")
	.map((step) => (step === "f" ? String(firehose?.id) : busiest[Number(step)]!))
const idsOf = (channelId: string) =>
	messages.filter((m) => m.channelId === channelId).map((m) => String(m.id))

const settle = (quietMs = 500) =>
	page.evaluate(
		(quiet) =>
			new Promise<void>((resolve) => {
				let timer = setTimeout(done, quiet)
				const observer = new MutationObserver(() => {
					clearTimeout(timer)
					timer = setTimeout(done, quiet)
				})
				observer.observe(document.body, { childList: true, subtree: true, attributes: true })
				function done() {
					observer.disconnect()
					resolve()
				}
			}),
		quietMs,
	)

/** Clicks the channel link and records each frame until a row of the channel is visible. */
const switchTo = async (p: Page, channelId: string) => {
	const ready = p.evaluate(async (ids) => {
		const wanted = new Set(ids)
		const start = performance.now()
		const frames: Array<{ at: number; rows: number; wanted: boolean }> = []
		for (;;) {
			await new Promise((resolve) => requestAnimationFrame(resolve))
			const rows = Array.from(document.querySelectorAll("[data-id]"))
			const hit = rows.some((row) => {
				const rect = row.getBoundingClientRect()
				return (
					wanted.has(row.getAttribute("data-id") ?? "") && rect.height > 0 && rect.top < innerHeight
				)
			})
			frames.push({ at: Math.round(performance.now() - start), rows: rows.length, wanted: hit })
			if (hit || performance.now() - start > 5000) return frames
		}
	}, idsOf(channelId))
	await p.locator(`a[href$="/chat/${channelId}"]`).first().click()
	return ready
}

await page.goto(`http://localhost:${targets[target].port}/hazel/chat/${path[0]}`)
await page.waitForSelector("[data-id]", { timeout: 30_000 })
await settle()
for (const channelId of path.slice(1, -1)) {
	await switchTo(page, channelId)
	await settle(300)
}

const cdp = await context.newCDPSession(page)
await cdp.send("Profiler.enable")
await cdp.send("Profiler.setSamplingInterval", { interval: 100 })
await browser.startTracing(page, {
	categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline.stack"],
})
await cdp.send("Profiler.start")
const frames = await switchTo(page, path.at(-1)!)
const { profile } = await cdp.send("Profiler.stop")
const trace = JSON.parse((await browser.stopTracing()).toString()) as {
	traceEvents: Array<{
		ph: string
		name: string
		dur?: number
		ts: number
		tid: number
		args?: { beginData?: { stackTrace?: Array<{ functionName: string; lineNumber: number }> } }
	}>
}

const selfMs = new Map<string, number>()
const nodes = new Map(profile.nodes.map((node) => [node.id, node]))
const parents = new Map<number, number>()
for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id)
const totalMs = new Map<string, number>()
const keyOf = (id: number) => {
	const frame = nodes.get(id)!.callFrame
	return `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber + 1}`
}
profile.samples?.forEach((id, index) => {
	const ms = (profile.timeDeltas?.[index] ?? 0) / 1000
	selfMs.set(keyOf(id), (selfMs.get(keyOf(id)) ?? 0) + ms)
	const seen = new Set<string>()
	for (let node: number | undefined = id; node !== undefined; node = parents.get(node)) {
		const key = keyOf(node)
		if (seen.has(key)) continue
		seen.add(key)
		totalMs.set(key, (totalMs.get(key) ?? 0) + ms)
	}
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
// Each long main-thread task with the app functions that dominate it (inclusive sample time).
const sampleTimes: number[] = []
let clock = profile.startTime
for (const delta of profile.timeDeltas ?? []) sampleTimes.push((clock += delta))
const mainTid = trace.traceEvents.find((event) => event.name === "FireAnimationFrame")?.tid
const tasks = trace.traceEvents.filter(
	(event) =>
		event.tid === mainTid &&
		(event.name === "RunTask" || event.name === "ThreadControllerImpl::RunTask") &&
		(event.dur ?? 0) > 1500,
)
if (tasks.length === 0)
	console.log(
		[
			...new Set(
				trace.traceEvents.filter((e) => e.tid === mainTid && (e.dur ?? 0) > 1500).map((e) => e.name),
			),
		].join(),
	)
const firstTs = tasks[0]?.ts ?? 0
for (const task of tasks) {
	const inTask = new Map<string, number>()
	profile.samples?.forEach((id, index) => {
		const at = sampleTimes[index]!
		if (at < task.ts || at > task.ts + task.dur!) return
		const seen = new Set<string>()
		for (let node: number | undefined = id; node !== undefined; node = parents.get(node)) {
			const key = keyOf(node)
			if (seen.has(key) || /^\((root|program)\)/.test(key)) continue
			seen.add(key)
			inTask.set(key, (inTask.get(key) ?? 0) + (profile.timeDeltas?.[index] ?? 0) / 1000)
		}
	})
	const rendering = trace.traceEvents
		.filter(
			(event) =>
				event.tid === mainTid &&
				/^(Layout|UpdateLayoutTree|Paint|PrePaint)$/.test(event.name) &&
				event.ts >= task.ts &&
				event.ts <= task.ts + task.dur!,
		)
		.filter((event) => (event.dur ?? 0) > 1000)
		.map((event) => {
			const stack = event.args?.beginData?.stackTrace
			const forced =
				stack
					?.slice(0, 4)
					.map((frame) => `${frame.functionName}:${frame.lineNumber}`)
					.join("<") ?? "frame"
			return `${event.name} ${((event.dur ?? 0) / 1000).toFixed(1)} (${forced})`
		})
	console.log(
		`task +${((task.ts - firstTs) / 1000).toFixed(1)}ms dur ${(task.dur! / 1000).toFixed(1)}ms [${rendering.join(", ")}]`,
	)
	console.log(top(inTask, 25))
}
console.log(`frames: ${JSON.stringify(frames)}`)
console.log(`self:\n${top(selfMs, 30)}\ntotal:\n${top(totalMs, 45)}\nphases:\n${top(phases, 12)}`)
await browser.close()
server.stop(true)
await backend.stop()
