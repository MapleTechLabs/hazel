import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { gzipSync } from "bun"
import { chromium, type Browser, type Page } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import {
	buildDir,
	FIXTURE_BACKEND_PORT,
	FIXTURE_ELECTRIC_PORT,
	fixtureBackendUrl,
	fixtureElectricUrl,
	outDir,
	targets,
	type TargetName,
} from "../config.ts"
import type { Dataset } from "../fixtures/dataset.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"
import { perfProbesInitScript, type FrameRun, type ReadySpec } from "./perf-probes.ts"
import {
	frameCosts,
	splitPageTrace,
	TRACE_CATEGORIES,
	type TraceEvent,
	type TraceSplit,
} from "./perf-trace.ts"

/**
 * Perf suite: legacy vs foldkit, N runs each, in Chromium with the frame rate uncapped, so a rAF
 * interval is the real cost of a frame (120 fps = 8.33 ms). Writes .parity/perf/<name>/report.{json,md}.
 *
 *   PARITY_PORT_BASE=8300 bun run src/bench/perf.ts [--runs 5] [--only scroll,switch,...] [--name baseline]
 *
 * Groups: load, scroll, switch, interact, sidebar, memory, bundle.
 */

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		targets: { type: "string", default: "legacy,foldkit" },
		runs: { type: "string", default: "5" },
		only: { type: "string", default: "load,scroll,switch,interact,sidebar,memory,bundle" },
		name: { type: "string", default: new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") },
		seconds: { type: "string", default: "2" },
		"no-trace": { type: "boolean", default: false },
		headed: { type: "boolean", default: false },
		verbose: { type: "boolean", default: false },
	},
})
const names = values.targets.split(",").filter((name): name is TargetName => name in targets)
const runs = Number(values.runs)
const groups = new Set(values.only.split(","))
const seconds = Number(values.seconds)

const heavy = datasets.get("heavy")!
const rich = datasets.get("rich")!

const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: "heavy",
})
const servers = names.map((name) => serveStatic(buildDir(name), targets[name].port, clerkIdentityFor(heavy)))
const browser: Browser = await chromium.launch({
	...BROWSER_LAUNCH_OPTIONS,
	headless: !values.headed,
	args: [...BROWSER_LAUNCH_OPTIONS.args, "--disable-frame-rate-limit", "--disable-gpu-vsync"],
})

// ---------- samples ----------

interface LatencySample {
	readonly kind: "latency"
	readonly value: number
	readonly blankFrames?: number
}
interface FrameSample {
	readonly kind: "frames"
	readonly run: FrameRun
	/** Main-thread ms per frame from the trace; empty with --no-trace. */
	readonly costMs: ReadonlyArray<number>
	readonly split?: TraceSplit
}
const latencies = new Map<string, Map<TargetName, LatencySample[]>>()
const frames = new Map<string, Map<TargetName, FrameSample[]>>()
const errors: string[] = []

const bucket = <A>(map: Map<string, Map<TargetName, A[]>>, metric: string, target: TargetName) => {
	const byTarget = map.get(metric) ?? new Map<TargetName, A[]>()
	map.set(metric, byTarget)
	const list = byTarget.get(target) ?? []
	byTarget.set(target, list)
	return list
}
const recordLatency = (metric: string, target: TargetName, value: number, blankFrames?: number) =>
	bucket(latencies, metric, target).push({ kind: "latency", value, blankFrames })
const recordFrames = (
	metric: string,
	target: TargetName,
	sample: { run: FrameRun; costMs: ReadonlyArray<number>; split?: TraceSplit },
) => bucket(frames, metric, target).push({ kind: "frames", ...sample })

/** Runs a step; a failure is logged and recorded instead of aborting the suite. */
const attempt = (label: string, step: () => Promise<void>) =>
	step().then(
		() => undefined,
		(error: unknown) => {
			const message = `${label}: ${String(error).split("\n")[0]?.slice(0, 200)}`
			errors.push(message)
			console.log(`  ! ${message}`)
		},
	)

// ---------- pages ----------

const backendOrigins = [fixtureBackendUrl, new URL(fixtureElectricUrl).origin]

const openPage = async (target: TargetName, dataset: Dataset, path: string) => {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
		serviceWorkers: "block",
		timezoneId: "UTC",
		locale: "en-US",
	})
	const page = await context.newPage()
	page.setDefaultTimeout(15_000)
	page.on("console", (message) => {
		if (values.verbose && message.type() === "error")
			console.log(`  [console] ${message.text().slice(0, 1500)}`)
	})
	page.on("pageerror", (error) => {
		errors.push(`${target} ${path} pageerror: ${error.message.slice(0, 200)}`)
		if (values.verbose) console.log(error.stack)
	})
	await page.addInitScript((identity) => {
		;(window as unknown as { __parityClerkIdentity: unknown }).__parityClerkIdentity = identity
	}, clerkIdentityFor(dataset))
	await page.addInitScript(perfProbesInitScript)
	for (const origin of backendOrigins)
		await page.route(`${origin}/**`, (route) =>
			route.continue({ headers: { ...route.request().headers(), "x-parity-dataset": dataset.name } }),
		)
	await page.goto(`http://localhost:${targets[target].port}${path}`, { waitUntil: "load" })
	return page
}

/** Waits until the DOM has been quiet for `quietMs`. */
const settle = (page: Page, quietMs = 500) =>
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

const openChat = async (target: TargetName, dataset: Dataset, channelId: string) => {
	const page = await openPage(target, dataset, `/hazel/chat/${channelId}`)
	await page.waitForSelector("[data-id]", { timeout: 30_000 })
	await settle(page)
	return page
}

/** Arms the in-page ready probe, performs the input, and returns the input-to-paint time. */
const timeInput = async (page: Page, spec: ReadySpec, input: () => Promise<void>, timeoutMs = 10_000) => {
	const ready = page.evaluate(({ spec, timeoutMs }) => window.__perf.waitReady(spec, timeoutMs), {
		spec,
		timeoutMs,
	})
	await input()
	const result = await ready
	if (result.timedOut && values.verbose) await page.screenshot({ path: "/tmp/perf-scripts/timeout.png" })
	if (result.timedOut) throw new Error(`timed out waiting for ${JSON.stringify(spec).slice(0, 120)}`)
	return result
}

const heapMb = async (page: Page) => {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send("HeapProfiler.collectGarbage")
	const { usedSize } = await cdp.send("Runtime.getHeapUsage")
	await cdp.detach()
	return Math.round(usedSize / 1e5) / 10
}

// ---------- dataset helpers ----------

const messagesOf = (dataset: Dataset, channelId: string) =>
	(dataset.tables.messages ?? []).filter((row) => row.channelId === channelId).map((row) => String(row.id))

/** Channels the signed-in user belongs to with the most messages (threads excluded). */
const busiestChannels = (dataset: Dataset, count: number, exclude: ReadonlyArray<string> = []) => {
	const userId = dataset.currentUser.id
	const member = new Set(
		(dataset.tables.channel_members ?? [])
			.filter((row) => row.userId === userId)
			.map((row) => String(row.channelId)),
	)
	const channels = (dataset.tables.channels ?? []).filter(
		(row) => member.has(String(row.id)) && row.type !== "thread" && !exclude.includes(String(row.id)),
	)
	return channels
		.map((row) => ({ id: String(row.id), count: messagesOf(dataset, String(row.id)).length }))
		.filter((channel) => channel.count >= 4)
		.sort((a, b) => b.count - a.count)
		.slice(0, count)
		.map((channel) => channel.id)
}

const channelLink = (page: Page, channelId: string) => page.locator(`a[href$="/chat/${channelId}"]`).first()

const heavyBig = heavy.tables.channels!.find((row) => row.name === "firehose")!.id as string
const heavyGeneral = heavy.tables.channels!.find((row) => row.name === "general")!.id as string

// ---------- groups ----------

const measureLoad = async (target: TargetName) => {
	for (const [workspace, dataset, channelId] of [
		["heavy", heavy, heavyBig],
		["normal", rich, busiestChannels(rich, 1)[0]!],
	] as const) {
		await attempt(`load ${workspace}`, async () => {
			const page = await openPage(target, dataset, `/hazel/chat/${channelId}`)
			await page.waitForSelector("[data-id]", { timeout: 30_000 })
			const marks = await page.evaluate(() => window.__perf.loadMarks())
			recordLatency(`load ${workspace}: first contentful paint`, target, marks.fcp)
			recordLatency(`load ${workspace}: first message row`, target, marks.firstRow)
			recordLatency(`load ${workspace}: interactive (TTI estimate)`, target, marks.tti)
			const scriptKb = await page.evaluate(
				() =>
					performance
						.getEntriesByType("resource")
						.filter((entry) => entry.name.endsWith(".js"))
						.reduce(
							(sum, entry) =>
								sum +
								(entry instanceof PerformanceResourceTiming ? entry.decodedBodySize : 0),
							0,
						) / 1024,
			)
			recordLatency(`load ${workspace}: JS loaded (KB, decoded)`, target, Math.round(scriptKb))
			await page.context().close()
		})
	}
}

/** Wheels over the scroller from Node (real input) while the page records frames. */
const wheelFrames = async (
	page: Page,
	probeSelector: string,
	rowSelector: string,
	delta: number,
	durationMs: number,
) => {
	const rect = await page.evaluate((selector) => window.__perf.scrollerRect(selector), probeSelector)
	if (!rect)
		throw new Error(
			`no scroller under ${probeSelector}: ${await page.evaluate((selector) => {
				const chain: string[] = []
				for (let e = document.querySelector(selector); e && chain.length < 9; e = e.parentElement)
					chain.push(
						`${e.tagName} ${e.scrollHeight}/${e.clientHeight} ${getComputedStyle(e).overflowY}`,
					)
				return chain.join(" < ")
			}, probeSelector)}`,
		)
	await page.mouse.move(rect.x, rect.y)
	await page.evaluate((options) => window.__perf.startFrames(options), { probeSelector, rowSelector })
	const end = Date.now() + durationMs
	while (Date.now() < end) await page.mouse.wheel(0, delta)
	return page.evaluate(() => window.__perf.stopFrames())
}

/** Runs a frame measurement under a timeline trace (unless --no-trace) for per-frame main-thread cost. */
const traced = async (page: Page, body: () => Promise<FrameRun>) => {
	if (values["no-trace"]) return { run: await body(), costMs: [] }
	await browser.startTracing(page, { categories: TRACE_CATEGORIES })
	const run = await body()
	const buffer = await browser.stopTracing()
	if (values.verbose) writeFileSync("/tmp/perf-scripts/last-trace.json", buffer)
	const trace: { traceEvents: TraceEvent[] } = JSON.parse(buffer.toString())
	return { run, costMs: frameCosts(trace.traceEvents), split: splitPageTrace(trace.traceEvents) }
}

const SPEEDS = [
	["slow wheel (60px)", 60],
	["medium wheel (200px)", 200],
	["fast wheel (600px)", 600],
] as const

const measureScroll = async (target: TargetName) => {
	for (const [label, channelId] of [
		["heavy #firehose (10k)", heavyBig],
		["normal #general (60)", heavyGeneral],
	] as const) {
		await attempt(`scroll ${label}`, async () => {
			const page = await openChat(target, heavy, channelId)
			const run = async (metric: string, body: () => Promise<FrameRun>) =>
				recordFrames(`scroll ${label}: ${metric}`, target, await traced(page, body))
			for (const [speed, delta] of SPEEDS)
				await run(speed, () => wheelFrames(page, "[data-id]", "[data-id]", -delta, seconds * 1000))
			await run("fling to top (history prepend)", () =>
				wheelFrames(page, "[data-id]", "[data-id]", -4000, seconds * 1000),
			)
			await run("jump to bottom", async () => {
				await page.evaluate(() =>
					window.__perf.startFrames({ probeSelector: "[data-id]", rowSelector: "[data-id]" }),
				)
				const started = Date.now()
				await page.evaluate(() => window.__perf.scrollTo("[data-id]", "bottom"))
				await settle(page, 300)
				recordLatency(
					`scroll ${label}: jump to bottom settle (ms)`,
					target,
					Date.now() - started - 300,
				)
				return page.evaluate(() => window.__perf.stopFrames())
			})
			await page.context().close()
		})
	}
}

const measureSwitch = async (target: TargetName) => {
	for (const [workspace, dataset, extra] of [
		["heavy", heavy, [heavyBig]],
		["normal", rich, []],
	] as const) {
		await attempt(`switch ${workspace}`, async () => {
			const channels = busiestChannels(dataset, 4, [heavyBig])
			const page = await openChat(target, dataset, channels[0]!)
			const visit = async (temperature: "cold" | "warm", channelId: string, suffix = "") => {
				const result = await timeInput(page, { ids: messagesOf(dataset, channelId) }, () =>
					channelLink(page, channelId).click(),
				)
				recordLatency(
					`switch ${workspace}${suffix}: ${temperature}`,
					target,
					result.ms,
					result.blankFrames,
				)
				await settle(page, 300)
			}
			for (const channelId of channels.slice(1)) await visit("cold", channelId)
			for (const channelId of extra) await visit("cold", channelId, " to 10k channel")
			for (const channelId of channels) await visit("warm", channelId)
			for (const channelId of extra) await visit("warm", channelId, " to 10k channel")
			await page.context().close()
		})
	}
}

/** An overlay open: `ms`, plus `commitMs` (the frame its patch painted in, see `ReadyResult`). */
const recordOpen = (metric: string, target: TargetName, result: { ms: number; commitMs: number }) => {
	recordLatency(metric, target, result.ms)
	recordLatency(`${metric}, commit frame`, target, result.commitMs)
}

const LAUNCH_WINDOW = "Launch window confirmed"
/** Ada's own message: only own messages offer Delete. */
const CHECKLIST = "Launch checklist: please claim your items"

const measureInteractions = async (target: TargetName) => {
	const launch = busiestChannels(rich, 10).find((id) =>
		rich.tables.channels!.some((row) => row.id === id && row.name === "launch"),
	)
	const launchId = launch ?? String(rich.tables.channels!.find((row) => row.name === "launch")!.id)
	const mediaId = String(rich.tables.channels!.find((row) => row.name === "media")!.id)
	const page = await openChat(target, rich, launchId)
	const escape = async () => {
		await page.keyboard.press("Escape")
		await settle(page, 300)
	}
	await attempt("composer typing", async () => {
		await page.getByRole("combobox").first().click()
		await settle(page, 200)
		for (let index = 1; index <= 20; index++) {
			const result = await timeInput(page, { editorLength: index }, () =>
				page.keyboard.type("abcdefghijklmnopqrst"[index - 1]!),
			)
			recordLatency("composer: key to paint", target, result.ms)
		}
		for (let index = 0; index < 20; index++) await page.keyboard.press("Backspace")
		await page.locator("h1, h2").first().click()
		await settle(page, 300)
	})
	for (const pass of ["first", "repeat"] as const) {
		await attempt(`palette ${pass}`, async () => {
			const result = await timeInput(page, { selector: '[role="dialog"]' }, () =>
				page.getByText("Browse channels").first().click(),
			)
			recordOpen(`command palette open (${pass})`, target, result)
			await escape()
		})
		await attempt(`modal ${pass}`, async () => {
			await page.getByText(CHECKLIST).hover()
			await page.getByRole("toolbar", { name: "Message actions" }).waitFor()
			const result = await timeInput(page, { selector: '[role="dialog"], [role="alertdialog"]' }, () =>
				page.getByRole("button", { name: "Delete message" }).click(),
			)
			recordOpen(`modal open: delete message (${pass})`, target, result)
			await page.getByRole("button", { name: "Cancel" }).click()
			await settle(page, 300)
		})
		await attempt(`emoji ${pass}`, async () => {
			await page.getByText(LAUNCH_WINDOW).hover()
			await page.getByRole("toolbar", { name: "Message actions" }).waitFor()
			const result = await timeInput(
				page,
				{ selector: '[role="dialog"][aria-label="Emoji picker"]' },
				() => page.getByRole("button", { name: "Add reaction" }).click(),
			)
			recordOpen(`emoji picker open (${pass})`, target, result)
			await escape()
		})
	}
	await attempt("thread", async () => {
		const result = await timeInput(page, { text: "CI freeze and release tagging are mine." }, () =>
			page.getByRole("button", { name: /3 replies/ }).click(),
		)
		recordOpen("thread panel open", target, result)
		await escape()
	})
	await attempt("image viewer", async () => {
		await channelLink(page, mediaId).click()
		await page.getByText("Moodboard for the launch page").scrollIntoViewIfNeeded()
		await settle(page, 300)
		const selector = 'img[alt="moodboard-1.png"]'
		const before = await page.locator(selector).count()
		const result = await timeInput(page, { selector, minCount: before + 1 }, () =>
			page.getByRole("img", { name: "moodboard-1.png" }).first().click(),
		)
		recordOpen("image viewer open", target, result)
	})
	await page.context().close()
}

const measureSidebar = async (target: TargetName) => {
	await attempt("sidebar", async () => {
		const page = await openChat(target, heavy, heavyGeneral)
		const probe = `a[href$="/chat/${heavyGeneral}"]`
		for (const [label, delta] of [
			["down", 200],
			["up", -200],
		] as const) {
			const key = `sidebar (500 channels) wheel ${label}`
			const body = () => wheelFrames(page, probe, "a, [role=treeitem], li", delta, seconds * 1000)
			recordFrames(key, target, await traced(page, body))
		}
		await page.context().close()
	})
}

const measureMemory = async (target: TargetName) => {
	await attempt("memory", async () => {
		const page = await openChat(target, heavy, heavyBig)
		recordLatency("memory: JS heap after heavy channel (MB)", target, await heapMb(page))
		const channels = [...busiestChannels(heavy, 4, [heavyBig]), heavyBig]
		for (let index = 0; index < 20; index++) {
			const channelId = channels[index % channels.length]!
			await timeInput(page, { ids: messagesOf(heavy, channelId) }, () =>
				channelLink(page, channelId).click(),
			)
			await settle(page, 200)
		}
		recordLatency("memory: JS heap after 20 switches (MB)", target, await heapMb(page))
		await page.context().close()
	})
}

const measureBundle = (target: TargetName) => {
	const files: string[] = []
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir)) {
			const path = join(dir, entry)
			if (statSync(path).isDirectory()) walk(path)
			else if (path.endsWith(".js") && !/\/(sw|workbox-[^/]+)\.js$/.test(path)) files.push(path)
		}
	}
	walk(buildDir(target))
	const raw = files.reduce((sum, path) => sum + statSync(path).size, 0)
	const gzip = files.reduce((sum, path) => sum + gzipSync(readFileSync(path)).length, 0)
	recordLatency("bundle: all JS (KB raw)", target, Math.round(raw / 1024))
	recordLatency("bundle: all JS (KB gzip)", target, Math.round(gzip / 1024))
}

// ---------- run ----------

for (const target of names) {
	if (groups.has("bundle")) measureBundle(target)
	for (let run = 1; run <= runs; run++) {
		console.log(`${target} run ${run}/${runs}`)
		if (groups.has("load")) await measureLoad(target)
		if (groups.has("scroll")) await measureScroll(target)
		if (groups.has("switch")) await measureSwitch(target)
		if (groups.has("interact")) await measureInteractions(target)
		if (groups.has("sidebar")) await measureSidebar(target)
		if (groups.has("memory") && run <= 2) await measureMemory(target)
	}
}

// ---------- report ----------

const percentile = (list: ReadonlyArray<number>, p: number) => {
	const sorted = [...list.filter(Number.isFinite)].sort((a, b) => a - b)
	if (!sorted.length) return Number.NaN
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!
}
const round = (value: number) => Math.round(value * 10) / 10
const FRAME_BUDGET = 1000 / 120

const latencyRows = [...latencies].map(([metric, byTarget]) => ({
	metric,
	targets: Object.fromEntries(
		[...byTarget].map(([target, samples]) => {
			const list = samples.map((sample) => sample.value)
			const blank = samples.map((sample) => sample.blankFrames ?? 0)
			return [
				target,
				{
					n: list.length,
					p50: round(percentile(list, 50)),
					p95: round(percentile(list, 95)),
					max: round(Math.max(...list)),
					blankFramesMax: Math.max(...blank),
					samples: list.map(round),
				},
			]
		}),
	),
}))
const sumSplits = (list: ReadonlyArray<TraceSplit>): TraceSplit | undefined =>
	list.length === 0
		? undefined
		: list.reduce((total, split) => ({
				busy: total.busy + split.busy,
				script: total.script + split.script,
				style: total.style + split.style,
				layout: total.layout + split.layout,
				paint: total.paint + split.paint,
				gc: total.gc + split.gc,
				other: total.other + split.other,
			}))
const frameRows = [...frames].map(([metric, byTarget]) => ({
	metric,
	targets: Object.fromEntries(
		[...byTarget].map(([target, samples]) => {
			const intervals = samples.flatMap((sample) => sample.run.frameMs)
			const cost = samples.flatMap((sample) => sample.costMs)
			const split = sumSplits(samples.flatMap((sample) => (sample.split ? [sample.split] : [])))
			const tracedFrames = Math.max(1, cost.length)
			return [
				target,
				{
					runs: samples.length,
					frames: cost.length,
					p50: round(percentile(cost, 50)),
					p95: round(percentile(cost, 95)),
					p99: round(percentile(cost, 99)),
					max: round(Math.max(...cost)),
					overBudgetPct: round(
						(100 * cost.filter((ms) => ms > FRAME_BUDGET).length) / tracedFrames,
					),
					intervalP95: round(percentile(intervals, 95)),
					intervalMax: round(Math.max(...intervals)),
					blankPct: round(
						(100 * samples.reduce((sum, sample) => sum + sample.run.blankFrames, 0)) /
							Math.max(1, intervals.length),
					),
					longTasksPerRun: round(
						samples.reduce((sum, sample) => sum + sample.run.longTasks, 0) / samples.length,
					),
					pxPerRun: Math.round(
						samples.reduce((sum, sample) => sum + sample.run.scrolledPx, 0) / samples.length,
					),
					perFrameSplit: split
						? Object.fromEntries(
								Object.entries(split).map(([key, ms]) => [
									key,
									Math.round((ms / tracedFrames) * 100) / 100,
								]),
							)
						: undefined,
				},
			]
		}),
	),
}))

const budgetFor = (
	metric: string,
): {
	label: string
	met: (foldkit: { p50: number; p95: number; blankFramesMax?: number }, legacy?: { p50: number }) => boolean
} => {
	if (/: warm$/.test(metric))
		return {
			label: "p50 < 50 ms, 0 blank frames",
			met: (f) => f.p50 < 50 && (f.blankFramesMax ?? 0) === 0,
		}
	if (/: cold$/.test(metric)) return { label: "p50 < 100 ms", met: (f) => f.p50 < 100 }
	return { label: "<= legacy p50 (+10%)", met: (f, l) => !l || f.p50 <= l.p50 * 1.1 + 1 }
}

const cell = (stats: { p50: number; p95: number; max: number } | undefined) =>
	stats ? `${stats.p50} / ${stats.p95} / ${stats.max}` : "n/a"
const lines: string[] = [
	`# Perf report: ${values.name}`,
	"",
	`Runs per target: ${runs}. Headless Chromium keeps a 60 Hz rAF even with --disable-frame-rate-limit, so frame cost is measured from a DevTools timeline trace: main-thread task time between consecutive animation frames. 120 fps budget: ${round(FRAME_BUDGET * 100) / 100} ms of work per frame. Wheel input is real (CDP mouseWheel), pointer over the list.`,
	"",
	"## Frames (main-thread ms per frame: p50 / p95 / max; over = % frames over 8.33 ms; wall = rAF interval p95 / max)",
	"",
	"| scenario | legacy | legacy over | legacy wall | foldkit | foldkit over | foldkit wall | foldkit blank % | p95 <= 8.33 |",
	"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	...frameRows.map(({ metric, targets: t }) => {
		const legacy = t.legacy
		const foldkit = t.foldkit
		const wall = (stats: typeof legacy) => (stats ? `${stats.intervalP95} / ${stats.intervalMax}` : "n/a")
		return `| ${metric} | ${cell(legacy)} | ${legacy?.overBudgetPct ?? "n/a"}% | ${wall(legacy)} | ${cell(foldkit)} | ${foldkit?.overBudgetPct ?? "n/a"}% | ${wall(foldkit)} | ${foldkit?.blankPct ?? "n/a"} | ${foldkit ? (foldkit.p95 <= FRAME_BUDGET ? "yes" : "no") : "n/a"} |`
	}),
	"",
	"## Main-thread split per frame (ms: script / style / layout / paint / gc / other, busy)",
	"",
	"| scenario | legacy | foldkit |",
	"| --- | --- | --- |",
	...frameRows.map(({ metric, targets: t }) => {
		const fmt = (split: Record<string, number> | undefined) =>
			split
				? `${split.script} / ${split.style} / ${split.layout} / ${split.paint} / ${split.gc} / ${split.other}, ${split.busy}`
				: "n/a"
		return `| ${metric} | ${fmt(t.legacy?.perFrameSplit)} | ${fmt(t.foldkit?.perFrameSplit)} |`
	}),
	"",
	"## Latency and size (p50 / p95 / max)",
	"",
	"| metric | legacy | foldkit | foldkit blank frames (max) | budget | met |",
	"| --- | --- | --- | --- | --- | --- |",
	...latencyRows.map(({ metric, targets: t }) => {
		const budget = budgetFor(metric)
		const met = t.foldkit ? (budget.met(t.foldkit, t.legacy) ? "yes" : "no") : "n/a"
		return `| ${metric} | ${cell(t.legacy)} | ${cell(t.foldkit)} | ${t.foldkit?.blankFramesMax ?? "n/a"} | ${budget.label} | ${met} |`
	}),
	"",
	...(errors.length ? ["## Errors", "", ...errors.map((error) => `- ${error}`), ""] : []),
]

const reportDir = join(outDir, "perf", values.name)
mkdirSync(reportDir, { recursive: true })
writeFileSync(
	join(reportDir, "report.json"),
	JSON.stringify({ name: values.name, runs, frames: frameRows, latency: latencyRows, errors }, null, "\t"),
)
writeFileSync(join(reportDir, "report.md"), lines.join("\n"))
console.log(lines.join("\n"))
console.log(`\nWrote ${reportDir}/report.{json,md}`)

await browser.close()
for (const server of servers) server.stop(true)
await backend.stop()
