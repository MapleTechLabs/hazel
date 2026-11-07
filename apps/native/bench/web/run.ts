/**
 * Measures Hazel's web app in Chromium on the native bench's scenario: boot to #general (offline
 * fixture), type "Hello from Rune" key by key, send it. `bun apps/native/bench/web/run.ts --runs 5`
 * Flags: `--runs N`, `--no-build` (reuse dist/), `--headed`, `--shell` (headless shell, not new headless).
 */
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { chromium, type CDPSession, type Page } from "playwright"

const benchDir = import.meta.dirname
const distDir = join(benchDir, "dist")
const outDir = join(benchDir, "out")
const webDir = resolve(benchDir, "../../../web-foldkit")
/** A #general message the fixture shows near the bottom of the channel. */
const CONTENT_TEXT = "Shipping it. Thanks everyone"
const TEXT = "Hello from Rune"
const QUIET_MS = 2500
const SETTLE_CAP_MS = 30_000

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const runsIndex = args.indexOf("--runs")
const runs = runsIndex === -1 ? 5 : Number(args[runsIndex + 1])
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs takes a positive integer")

/** What the init script keeps in the page; read back with `page.evaluate`. */
interface BenchState {
	paints: Record<string, number>
	longTasks: Array<{ start: number; duration: number }>
	events: Array<{ name: string; interactionId: number; duration: number; start: number }>
	lastMutation: number
	keys: Array<{ key: string; ms: number; frameMs: number }>
	mode: "idle" | "typing" | "send"
	send: { downAt: number; ms: number | null }
}
declare global {
	interface Window {
		__bench?: BenchState
		/** -1 once the content text appears, then the time of the frame after it. */
		__contentReady?: number
	}
}

/** Runs at document start, before any app code: paint, long task, event timing and DOM observers. */
const installProbes = (text: string) => {
	const state: BenchState = {
		paints: {},
		longTasks: [],
		events: [],
		lastMutation: 0,
		keys: [],
		mode: "idle",
		send: { downAt: 0, ms: null },
	}
	window.__bench = state
	const observe = (
		type: string,
		onEntry: (entry: PerformanceEntry) => void,
		extra: { durationThreshold?: number } = {},
	) => {
		const observer = new PerformanceObserver((list) => list.getEntries().forEach(onEntry))
		observer.observe({ type, buffered: true, ...extra })
	}
	observe("paint", (entry) => {
		state.paints[entry.name] = entry.startTime
	})
	observe("longtask", (entry) => state.longTasks.push({ start: entry.startTime, duration: entry.duration }))
	observe(
		"event",
		(entry) => {
			const interactionId = "interactionId" in entry ? Number(entry.interactionId) : 0
			if (interactionId > 0 && ["keydown", "keypress", "keyup", "input"].includes(entry.name)) {
				state.events.push({
					name: entry.name,
					interactionId,
					duration: entry.duration,
					start: entry.startTime,
				})
			}
		},
		{ durationThreshold: 16 },
	)

	const afterPaint = (run: () => void) => requestAnimationFrame(() => requestAnimationFrame(run))
	// A key's latency: its capturing keydown to the second frame after the composer DOM changed.
	let pendingKey: { key: string; at: number; scheduled: boolean } | null = null
	const sentXPath = `//text()[contains(., ${JSON.stringify(text)})][not(ancestor::*[@contenteditable="true"])]`
	const messageListHasText = () =>
		document.evaluate(sentXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
			.singleNodeValue !== null
	let sendScheduled = false

	document.addEventListener(
		"keydown",
		(event) => {
			const at = performance.now()
			if (state.mode === "typing") pendingKey = { key: event.key, at, scheduled: false }
			if (state.mode === "send" && event.key === "Enter") {
				state.send.downAt = at
				sendScheduled = false
			}
		},
		{ capture: true },
	)

	new MutationObserver((records) => {
		state.lastMutation = performance.now()
		if (state.mode === "typing" && pendingKey !== null && !pendingKey.scheduled) {
			const inComposer = records.some((record) => {
				const node = record.target instanceof Element ? record.target : record.target.parentElement
				return node?.closest(".ProseMirror") != null
			})
			if (inComposer) {
				const key = pendingKey
				key.scheduled = true
				// frameMs: the first rAF, the start of the frame that paints the change (a lower bound).
				requestAnimationFrame(() => {
					const frameMs = performance.now() - key.at
					requestAnimationFrame(() => {
						state.keys.push({ key: key.key, ms: performance.now() - key.at, frameMs })
						if (pendingKey === key) pendingKey = null
					})
				})
			}
		}
		if (state.mode === "send" && state.send.downAt > 0 && !sendScheduled && messageListHasText()) {
			sendScheduled = true
			afterPaint(() => {
				state.send.ms = performance.now() - state.send.downAt
			})
		}
	}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
}

type Percentiles = { p50: number; p95: number; max: number; n: number }
const percentile = (sorted: ReadonlyArray<number>, p: number) =>
	sorted.length === 0
		? Number.NaN
		: sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
const percentiles = (values: ReadonlyArray<number>): Percentiles => {
	const sorted = [...values].sort((a, b) => a - b)
	return {
		p50: percentile(sorted, 50),
		p95: percentile(sorted, 95),
		max: sorted.at(-1) ?? Number.NaN,
		n: sorted.length,
	}
}
const median = (values: ReadonlyArray<number>) =>
	percentile(
		[...values].sort((a, b) => a - b),
		50,
	)
const round = (value: number) => Math.round(value * 10) / 10

/** RSS (MB) of the browser process and every descendant (renderer, GPU, utility). */
const processTreeRssMb = (rootPid: number) => {
	const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
		.trim()
		.split("\n")
		.map((line) => line.trim().split(/\s+/).map(Number))
	const tree = new Set([rootPid])
	let grew = true
	while (grew) {
		grew = false
		for (const [pid, ppid] of rows) {
			if (tree.has(ppid) && !tree.has(pid)) {
				tree.add(pid)
				grew = true
			}
		}
	}
	const kb = rows.filter(([pid]) => tree.has(pid)).reduce((sum, [, , rss]) => sum + rss, 0)
	return { rssMb: round(kb / 1024), processes: tree.size }
}

const cdpMetrics = async (cdp: CDPSession) => {
	const { metrics } = await cdp.send("Performance.getMetrics")
	const get = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? Number.NaN
	return {
		jsHeapUsedMb: round(get("JSHeapUsedSize") / 1048576),
		jsHeapTotalMb: round(get("JSHeapTotalSize") / 1048576),
		scriptDurationMs: round(get("ScriptDuration") * 1000),
		taskDurationMs: round(get("TaskDuration") * 1000),
	}
}

const readState = async (page: Page) => {
	const state = await page.evaluate(() => window.__bench)
	if (state === undefined) throw new Error("bench probes were not installed")
	return state
}

/** Resolves at the last DOM mutation once QUIET_MS pass without another one. */
const waitForSettle = async (page: Page, since: number) => {
	const deadline = Date.now() + SETTLE_CAP_MS
	for (;;) {
		const { now, last } = await page.evaluate(() => ({
			now: performance.now(),
			last: window.__bench?.lastMutation ?? 0,
		}))
		const lastMutation = Math.max(last, since)
		if (now - lastMutation >= QUIET_MS) return { settledMs: lastMutation, capped: false }
		if (Date.now() > deadline) return { settledMs: lastMutation, capped: true }
		await sleep(100)
	}
}

const memory = async (browserPid: number | undefined, cdp: CDPSession) => ({
	...(browserPid === undefined ? { rssMb: Number.NaN, processes: 0 } : processTreeRssMb(browserPid)),
	...(await cdpMetrics(cdp)),
})

const runOnce = async (index: number, url: string) => {
	const console_: Array<string> = []
	const t0 = Date.now()
	const browserServer = await chromium.launchServer({
		headless: !flag("--headed"),
		// New headless (the full browser) unless --shell asks for the lighter headless shell.
		channel: flag("--shell") ? undefined : "chromium",
	})
	// launchServer exposes the browser's pid, which the RSS sum walks down from.
	const browserPid = browserServer.process().pid
	const browser = await chromium.connect(browserServer.wsEndpoint())
	try {
		const context = await browser.newContext({
			viewport: { width: 1280, height: 800 },
			deviceScaleFactor: 2,
		})
		const page = await context.newPage()
		page.on("console", (message) => console_.push(`[${message.type()}] ${message.text()}`))
		page.on("pageerror", (error) => console_.push(`[pageerror] ${error.message}`))
		await page.addInitScript(installProbes, TEXT)
		// Content ready: the frame after a known #general message first appears in the DOM.
		await page.addInitScript((needle: string) => {
			const check = () => {
				if (window.__contentReady !== undefined) return
				if (!(document.body?.textContent ?? "").includes(needle)) return
				window.__contentReady = -1
				requestAnimationFrame(() => {
					window.__contentReady = performance.now()
				})
			}
			new MutationObserver(check).observe(document, {
				subtree: true,
				childList: true,
				characterData: true,
			})
		}, CONTENT_TEXT)
		const cdp = await context.newCDPSession(page)
		await cdp.send("Performance.enable")

		await page.goto(url)
		const timeOrigin = await page.evaluate(() => performance.timeOrigin)
		const settle = await waitForSettle(page, 0)
		const contentReady = await page.evaluate(() => Number(window.__contentReady ?? Number.NaN))
		const composer = page.locator(".ProseMirror").first()
		const messages = await page.evaluate(
			() => document.querySelectorAll('[data-slate-editor][contenteditable="false"]').length,
		)
		if ((await composer.count()) === 0) {
			throw new Error(
				`run ${index}: no composer after settle. Console:\n${console_.slice(-40).join("\n")}`,
			)
		}
		const boot = await readState(page)
		const longTasks = boot.longTasks.filter((task) => task.start <= settle.settledMs)
		const settledShot = join(outDir, `web-run${index}-settled.png`)
		await page.screenshot({ path: settledShot, fullPage: true })
		const memorySettled = await memory(browserPid, cdp)

		// Typing: one key at a time, each measured to the frame after the composer changed.
		await composer.click()
		await page.evaluate(() => {
			const state = window.__bench
			if (state !== undefined) {
				state.mode = "typing"
				state.events = []
				state.keys = []
			}
		})
		for (const [i, char] of [...TEXT].entries()) {
			await page.keyboard.press(char === " " ? "Space" : char)
			await page
				.waitForFunction((count) => (window.__bench?.keys.length ?? 0) >= count, i + 1, {
					timeout: 5000,
				})
				.catch(() => console_.push(`[bench] key ${i} (${char}) produced no composer change`))
		}
		await sleep(300)
		const typed = await readState(page)
		const composerText = (await composer.innerText()).trim()
		const byInteraction = new Map<number, number>()
		for (const entry of typed.events) {
			byInteraction.set(
				entry.interactionId,
				Math.max(byInteraction.get(entry.interactionId) ?? 0, entry.duration),
			)
		}

		// Send: Enter to the frame the message list shows the text.
		await page.evaluate(() => {
			const state = window.__bench
			if (state !== undefined) state.mode = "send"
		})
		await page.keyboard.press("Enter")
		await page.waitForFunction(() => window.__bench?.send.ms !== null, undefined, { timeout: 10_000 })
		const sent = await readState(page)
		const composerCleared = await page
			// An empty composer still holds its placeholder text, so cleared means the sent text is gone.
			.waitForFunction(
				(text) => !(document.querySelector(".ProseMirror")?.textContent ?? "").includes(text),
				TEXT,
				{
					timeout: 3000,
				},
			)
			.then(() => true)
			.catch(() => false)
		await waitForSettle(page, sent.send.downAt)
		const sentShot = join(outDir, `web-run${index}-sent.png`)
		await page.screenshot({ path: sentShot, fullPage: true })
		const memorySent = await memory(browserPid, cdp)

		const result = {
			chromium: browser.version(),
			run: index,
			firstPaintMs: round(boot.paints["first-paint"] ?? Number.NaN),
			firstContentfulPaintMs: round(boot.paints["first-contentful-paint"] ?? Number.NaN),
			contentReadyMs: round(contentReady),
			launchToContentReadyMs: round(timeOrigin + contentReady - t0),
			settledMs: round(settle.settledMs),
			settleCapped: settle.capped,
			launchToSettledMs: round(timeOrigin + settle.settledMs - t0),
			launchToNavigationMs: round(timeOrigin - t0),
			messageElementsAtSettle: messages,
			bootLongTasks: {
				count: longTasks.length,
				totalMs: round(longTasks.reduce((sum, task) => sum + task.duration, 0)),
			},
			typing: {
				composerText,
				inPageDoubleRaf: percentiles(typed.keys.map((key) => key.ms)),
				inPageFirstRaf: percentiles(typed.keys.map((key) => key.frameMs)),
				eventTiming: { ...percentiles([...byInteraction.values()]), keysPressed: TEXT.length },
			},
			send: { keydownToVisibleMs: round(sent.send.ms ?? Number.NaN), composerCleared },
			memorySettled,
			memorySent,
			screenshots: { settled: settledShot, sent: sentShot },
		}
		if (composerText !== TEXT) console.warn(`run ${index}: composer held ${JSON.stringify(composerText)}`)
		const problems = console_.filter((line) => /^\[(error|pageerror)\]|\[bench\]/.test(line))
		if (problems.length > 0)
			console.warn(`run ${index} console problems:\n  ${problems.slice(0, 15).join("\n  ")}`)
		return result
	} finally {
		await browser.close()
		await browserServer.close()
	}
}

if (!flag("--no-build")) {
	const built = spawnSync(
		join(webDir, "node_modules/.bin/vite"),
		["build", "--config", join(benchDir, "vite.config.ts")],
		{
			stdio: ["ignore", "ignore", "inherit"],
		},
	)
	if (built.status !== 0) throw new Error("vite build failed")
}
mkdirSync(outDir, { recursive: true })

// Static server for dist/: any unknown path is the SPA's index.html.
const mimeTypes = new Map([
	[".html", "text/html"],
	[".js", "text/javascript"],
	[".css", "text/css"],
	[".wasm", "application/wasm"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".woff2", "font/woff2"],
	[".woff", "font/woff"],
	[".json", "application/json"],
	[".mp3", "audio/mpeg"],
])
const server = createServer((request, response) => {
	const pathname = new URL(request.url ?? "/", "http://bench").pathname
	// Decode first so an escaped name finds its file, then check containment on the decoded path.
	const path = Buffer.from(
		pathname.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
			String.fromCharCode(Number.parseInt(hex, 16)),
		),
		"latin1",
	).toString("utf8")
	const candidate = join(distDir, path)
	const file =
		candidate.startsWith(`${distDir}${sep}`) && existsSync(candidate) && statSync(candidate).isFile()
			? candidate
			: join(distDir, "index.html")
	response.writeHead(200, { "content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream" })
	response.end(readFileSync(file))
})
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
if (address === null || typeof address === "string") throw new Error("static server has no port")
const url = `http://127.0.0.1:${address.port}/`

const results: Array<Awaited<ReturnType<typeof runOnce>>> = []
try {
	for (let i = 1; i <= runs; i++) {
		const result = await runOnce(i, url)
		results.push(result)
		console.log(`run ${i}: settled ${result.settledMs} ms, send ${result.send.keydownToVisibleMs} ms`)
	}
} finally {
	server.close()
}

const med = (pick: (result: (typeof results)[number]) => number) => round(median(results.map(pick)))
const summary = {
	runs,
	firstContentfulPaintMs: med((r) => r.firstContentfulPaintMs),
	contentReadyMs: med((r) => r.contentReadyMs),
	launchToContentReadyMs: med((r) => r.launchToContentReadyMs),
	settledMs: med((r) => r.settledMs),
	launchToSettledMs: med((r) => r.launchToSettledMs),
	bootLongTaskCount: med((r) => r.bootLongTasks.count),
	bootLongTaskMs: med((r) => r.bootLongTasks.totalMs),
	keyInPageP50Ms: med((r) => r.typing.inPageDoubleRaf.p50),
	keyInPageP95Ms: med((r) => r.typing.inPageDoubleRaf.p95),
	keyInPageMaxMs: med((r) => r.typing.inPageDoubleRaf.max),
	keyFirstRafP50Ms: med((r) => r.typing.inPageFirstRaf.p50),
	keyFirstRafP95Ms: med((r) => r.typing.inPageFirstRaf.p95),
	keyEventTimingP50Ms: med((r) => r.typing.eventTiming.p50),
	keyEventTimingP95Ms: med((r) => r.typing.eventTiming.p95),
	keyEventTimingMaxMs: med((r) => r.typing.eventTiming.max),
	keyEventTimingReported: med((r) => r.typing.eventTiming.n),
	sendToVisibleMs: med((r) => r.send.keydownToVisibleMs),
	rssSettledMb: med((r) => r.memorySettled.rssMb),
	rssSentMb: med((r) => r.memorySent.rssMb),
	jsHeapUsedSettledMb: med((r) => r.memorySettled.jsHeapUsedMb),
	jsHeapUsedSentMb: med((r) => r.memorySent.jsHeapUsedMb),
	scriptDurationAtSettleMs: med((r) => r.memorySettled.scriptDurationMs),
	taskDurationAtSettleMs: med((r) => r.memorySettled.taskDurationMs),
}
// The version of the browser the runs measured, not of a separate probe launch.
const browserVersion = results[0]?.chromium ?? "unknown"
writeFileSync(
	join(outDir, "results.json"),
	`${JSON.stringify({ chromium: browserVersion, viewport: "1280x800@2x", summary, runs: results }, null, "\t")}\n`,
)

const rows: Array<[string, string]> = [
	["first contentful paint", `${summary.firstContentfulPaintMs} ms`],
	["settled (nav start)", `${summary.settledMs} ms`],
	["launch to settled", `${summary.launchToSettledMs} ms`],
	["boot long tasks", `${summary.bootLongTaskCount} (${summary.bootLongTaskMs} ms)`],
	[
		"key, in-page 2x rAF p50/p95/max",
		`${summary.keyInPageP50Ms} / ${summary.keyInPageP95Ms} / ${summary.keyInPageMaxMs} ms`,
	],
	["key, in-page 1st rAF p50/p95", `${summary.keyFirstRafP50Ms} / ${summary.keyFirstRafP95Ms} ms`],
	[
		"key, Event Timing p50/p95/max",
		// Event Timing only reports interactions of 16 ms or more, so none reported means all were faster.
		summary.keyEventTimingReported === 0
			? `none of ${TEXT.length} keys reached 16 ms`
			: `${summary.keyEventTimingP50Ms} / ${summary.keyEventTimingP95Ms} / ${summary.keyEventTimingMaxMs} ms (${summary.keyEventTimingReported}/${TEXT.length} over 16 ms)`,
	],
	["send to visible", `${summary.sendToVisibleMs} ms`],
	["RSS settled / sent", `${summary.rssSettledMb} / ${summary.rssSentMb} MB`],
	["JS heap used settled / sent", `${summary.jsHeapUsedSettledMb} / ${summary.jsHeapUsedSentMb} MB`],
	[
		"script / task time at settle",
		`${summary.scriptDurationAtSettleMs} / ${summary.taskDurationAtSettleMs} ms`,
	],
]
console.log(`\nHazel web, Chromium ${browserVersion}, 1280x800@2x, median of ${runs} runs`)
for (const [label, value] of rows) console.log(`  ${label.padEnd(32)} ${value}`)
console.log(`\nresults: ${join(outDir, "results.json")}`)
