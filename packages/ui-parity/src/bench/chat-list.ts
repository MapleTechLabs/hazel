import { existsSync } from "node:fs"
import { join } from "node:path"
import { parseArgs } from "node:util"
import { chromium, type Page } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import { buildDir, FIXTURE_BACKEND_PORT, FIXTURE_ELECTRIC_PORT, targets, type TargetName } from "../config.ts"
import { heavyIds } from "../fixtures/datasets/heavy.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"
import {
	installFirstRowProbe,
	measureFrames,
	measurePrependAnchor,
	prepareList,
	type FrameStats,
} from "./chat-list-probes.ts"

/**
 * S4 benchmark: scroll the heavy dataset's 10k-message channel in the static parity builds and
 * report frame times (rAF probe), blank frames and long tasks, plus how far the anchored row
 * moves when an older page is prepended. No dev server: the builds and the fixture backend.
 *
 *   PARITY_PORT_BASE=5750 bun run src/bench/chat-list.ts [--targets legacy,foldkit] [--seconds 6] [--speed 40] [--runs 3]
 */

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		targets: { type: "string", default: "legacy,foldkit" },
		seconds: { type: "string", default: "6" },
		speed: { type: "string", default: "40" },
		runs: { type: "string", default: "3" },
		headed: { type: "boolean", default: false },
		trace: { type: "boolean", default: false },
		"anchor-only": { type: "boolean", default: false },
	},
})

const names = values.targets.split(",") as TargetName[]
const dataset = datasets.get("heavy")!
const path = `/${heavyIds.orgSlug}/chat/${heavyIds.bigChannelId}`

const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: "heavy",
})
const servers = names.map((name) => {
	const dir = buildDir(name)
	if (!existsSync(join(dir, "index.html"))) throw new Error(`No build for "${name}". Run: bun parity build ${name}`)
	return serveStatic(dir, targets[name].port, clerkIdentityFor(dataset))
})
const browser = await chromium.launch({ ...BROWSER_LAUNCH_OPTIONS, headless: !values.headed })

const openChannel = async (name: TargetName): Promise<{ page: Page; firstRowMs: number }> => {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
	const page = await context.newPage()
	page.setDefaultTimeout(30_000)
	page.on("pageerror", (error) => console.log(`  [${name}] pageerror: ${error.message.slice(0, 200)}`))
	await page.addInitScript((identity) => {
		;(window as unknown as { __parityClerkIdentity: unknown }).__parityClerkIdentity = identity
	}, clerkIdentityFor(dataset))
	await page.addInitScript(installFirstRowProbe)
	await page.goto(`http://localhost:${targets[name].port}${path}`, { waitUntil: "load" })
	const firstRowMs = await prepareList(page)
	return { page, firstRowMs }
}

const percentile = (values: ReadonlyArray<number>, p: number) => {
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0
}

const summarize = (label: string, stats: FrameStats) => {
	const over = (ms: number) => stats.frameMs.filter((frame) => frame > ms).length
	return {
		label,
		frames: stats.frameMs.length,
		p50: +percentile(stats.frameMs, 50).toFixed(1),
		p95: +percentile(stats.frameMs, 95).toFixed(1),
		p99: +percentile(stats.frameMs, 99).toFixed(1),
		max: +Math.max(...stats.frameMs).toFixed(1),
		"over20ms%": +((100 * over(20)) / stats.frameMs.length).toFixed(1),
		"blank%": +((100 * stats.blankFrames) / stats.frameMs.length).toFixed(1),
		longTasks: stats.longTasks,
		longTaskMs: Math.round(stats.longTaskMs),
		scrolledPx: Math.round(stats.scrolledPx),
		rowsInDom: stats.maxRowsInDom,
	}
}

const results: Array<Record<string, unknown>> = []
for (const name of names) {
	for (let run = 1; run <= Number(values.runs); run++) {
		if (!values["anchor-only"]) {
		const { page, firstRowMs } = await openChannel(name)
		const up = await measureFrames(page, { direction: -1, seconds: Number(values.seconds), speed: Number(values.speed) })
		const down = await measureFrames(page, { direction: 1, seconds: Number(values.seconds), speed: Number(values.speed) })
		results.push({ target: name, run, firstRowMs: Math.round(firstRowMs), ...summarize("up (paging)", up) })
		results.push({ target: name, run, firstRowMs: Math.round(firstRowMs), ...summarize("down (loaded)", down) })
		await page.context().close()
		}

		const fresh = await openChannel(name)
		const { trace, ...anchor } = await measurePrependAnchor(fresh.page)
		results.push({ target: name, run, label: "prepend anchor", ...anchor })
		if (values.trace) console.log(name, JSON.stringify(trace))
		await fresh.page.context().close()
	}
}

console.table(results)
console.log(JSON.stringify(results))
await browser.close()
for (const server of servers) server.stop(true)
await backend.stop()
