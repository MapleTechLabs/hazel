import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { extname, resolve } from "node:path"
import { chromium, type Page } from "playwright"

/**
 * `bun run --cwd packages/ui test:channel-shift [--frames] [--cold N] [--throttle X] [--only ID]`:
 * serves the offline build (run `bun run --cwd apps/ios build:web:offline` first; this builds
 * nothing) and switches to every fixture channel from the sidebar: N times (default COLD_RUNS) as the
 * first switch after a fresh page load, then twice round on one page (warm). Fails when one switch's summed
 * layout-shift score passes MAX_SCORE, printing each shift's sources. `--throttle` slows the CPU by X
 * (4 makes a cold load's late lookups reliably lose the race); `--only` keeps channels ending in ID.
 *
 * It also reports, without failing, a row that moved on screen between two painted frames: the
 * layout-shift API leaves out moves the list makes by scrolling (sticking to the bottom while a row
 * above the end grows). `--frames` prints what the message pane drew after each paint.
 */
export const MAX_SCORE = 0.01
const WATCH_MS = 1500
const VIEWPORT = { width: 1280, height: 800 }

const root = resolve(import.meta.dirname, "../../../apps/ios/build/web")
if (!existsSync(`${root}/index.html`))
	throw new Error(`no offline build at ${root}: run bun run --cwd apps/ios build:web:offline`)
const showFrames = process.argv.includes("--frames")
/** A race must lose every time to pass: each channel's cold switch runs this many times. */
const COLD_RUNS = 5
const flag = (name: string, fallback: number) => {
	const at = process.argv.indexOf(name)
	return at === -1 ? fallback : Number(process.argv[at + 1])
}
const coldRuns = flag("--cold", COLD_RUNS)
const throttle = flag("--throttle", 1)

const TYPES = new Map([
	[".html", "text/html"],
	[".js", "text/javascript"],
	[".css", "text/css"],
	[".json", "application/json"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".ico", "image/x-icon"],
])

/** The build as a static host with an `index.html` fallback, on a free port. */
const server = createServer((request, response) => {
	const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)
	const file = resolve(root, `.${path}`)
	const served =
		file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile()
			? file
			: `${root}/index.html`
	response.writeHead(200, { "content-type": TYPES.get(extname(served)) ?? "application/octet-stream" })
	createReadStream(served).pipe(response)
})
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
const address = server.address()
const port = typeof address === "object" && address !== null ? address.port : 0

interface Shift {
	readonly at: number
	readonly value: number
	readonly sources: ReadonlyArray<string>
}
interface Note {
	readonly at: number
	readonly text: string
}
interface Watched {
	readonly shifts: ReadonlyArray<Shift>
	readonly moves: ReadonlyArray<Note>
	readonly frames: ReadonlyArray<Note>
}

/** Records the page for WATCH_MS: its layout shifts, rows that moved, and each painted frame. */
const watch = (page: Page) =>
	page.evaluate((watchMs) => {
		interface ShiftEntry extends PerformanceEntry {
			readonly value: number
			readonly sources: ReadonlyArray<{
				readonly node: Node | null
				readonly previousRect: DOMRectReadOnly
				readonly currentRect: DOMRectReadOnly
			}>
		}
		const start = performance.now()
		const since = () => Math.round(performance.now() - start)
		const shifts: Array<Shift> = []
		const moves: Array<Note> = []
		const frames: Array<Note> = []
		const describe = (node: Node | null) => {
			if (!(node instanceof Element)) return "?"
			const hz = node.getAttribute("data-hz")
			return hz === null ? node.tagName.toLowerCase() : `hz:${hz}`
		}
		// The click is input, so CLS would skip these shifts; the reader still sees them, so all count.
		const observer = new PerformanceObserver((list) => {
			for (const entry of list.getEntries() as Array<ShiftEntry>)
				shifts.push({
					at: Math.round(entry.startTime - start),
					value: entry.value,
					sources: entry.sources.map(
						({ node, previousRect: a, currentRect: b }) =>
							`${describe(node)} y${Math.round(a.y)}->${Math.round(b.y)} h${Math.round(a.height)}->${Math.round(b.height)}`,
					),
				})
		})
		observer.observe({ type: "layout-shift", buffered: false })

		let last = ""
		let seen = new Map<Element, number>()
		const sample = () => {
			const hole = document.querySelector('[data-hazel-hole="message-list"]')
			const list = hole?.querySelector('[data-hz="list"]')
			const viewport = list?.querySelector('[data-hz-part="viewport"]')
			const rows = [...(list?.querySelectorAll('[data-hz="message"]') ?? [])]
			const box = viewport?.getBoundingClientRect()
			const now = new Map<Element, number>()
			for (const row of rows) {
				const rect = row.getBoundingClientRect()
				if (box !== undefined && rect.bottom > box.top && rect.top < box.bottom)
					now.set(row, rect.top)
			}
			const moved = [...now].flatMap(([row, top]) => {
				const before = seen.get(row)
				return before === undefined || Math.abs(before - top) < 1 ? [] : [Math.round(top - before)]
			})
			if (moved.length > 0) moves.push({ at: since(), text: `${moved.length} rows by ${moved[0]}px` })
			seen = now
			const lastRow = rows[rows.length - 1]
			const state = [
				`hole=${hole === null ? "none" : hole.children.length}`,
				`list=${list == null ? "none" : list.hasAttribute("data-loading") ? "loading" : "ready"}`,
				`empty=${hole?.querySelector('[data-hz="emptyState"]') != null}`,
				`rows=${rows.length}`,
				`end=${lastRow === undefined || box === undefined ? "-" : Math.round(box.bottom - lastRow.getBoundingClientRect().bottom)}`,
			].join(" ")
			if (state !== last) frames.push({ at: since(), text: state })
			last = state
			if (performance.now() - start < watchMs) requestAnimationFrame(afterPaint)
		}
		// Samples just after each paint (a task queued from the frame), so it reads what was drawn.
		const channel = new MessageChannel()
		channel.port1.onmessage = sample
		const afterPaint = () => channel.port2.postMessage(null)
		requestAnimationFrame(afterPaint)
		return new Promise<Watched>((done) =>
			setTimeout(() => {
				observer.disconnect()
				done({ shifts, moves, frames })
			}, watchMs),
		)
	}, WATCH_MS)

const browser = await chromium.launch()
let failed = false

/** One switch to `href`, recorded and reported. */
const switchTo = async (page: Page, href: string, label: string) => {
	const watched = watch(page)
	// Evaluations run in order, so the recording has started once this one answers.
	await page.evaluate(() => 0)
	await page.click(`a[href="${href}"] >> nth=0`, { noWaitAfter: true })
	const { shifts, moves, frames } = await watched
	const score = shifts.reduce((sum, shift) => sum + shift.value, 0)
	const over = score > MAX_SCORE
	failed ||= over
	console.log(`${over ? "FAIL" : "ok  "} ${label} ${href.slice(-4)} score=${score.toFixed(4)}`)
	for (const shift of shifts)
		if (shift.value >= 0.0001)
			console.log(`     shift +${shift.at}ms ${shift.value.toFixed(4)} ${shift.sources.join(", ")}`)
	for (const move of moves) console.log(`     moved +${move.at}ms ${move.text} (not scored)`)
	if (showFrames) for (const frame of frames) console.log(`     frame +${frame.at}ms ${frame.text}`)
}

/** A fresh page on the channel index, its sidebar drawn. */
const freshPage = async () => {
	const page = await browser.newPage({ viewport: VIEWPORT })
	if (throttle > 1) {
		const cdp = await page.context().newCDPSession(page)
		await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle })
	}
	await page.goto(`http://127.0.0.1:${port}/`)
	await page.waitForSelector('a[href*="/chat/"]', { timeout: 20_000 })
	await page.waitForTimeout(1000)
	return page
}

const channelsOf = async (page: Page) => [
	...new Set(
		await page.$$eval('a[href*="/chat/"]', (links) =>
			links
				.map((link) => link.getAttribute("href") ?? "")
				.filter((href) => /\/chat\/[0-9a-f-]{36}$/.test(href)),
		),
	),
]

try {
	const warm = await freshPage()
	const only = process.argv.indexOf("--only")
	const suffix = only === -1 ? "" : (process.argv[only + 1] ?? "")
	const hrefs = (await channelsOf(warm)).filter((href) => href.endsWith(suffix))
	for (const href of hrefs)
		for (let run = 1; run <= coldRuns; run++) {
			const page = await freshPage()
			await switchTo(page, href, `cold#${run}`)
			await page.close()
		}
	// Then one page through them all, and round again: channels already visited.
	if (hrefs.length > 1)
		for (const pass of ["warm#1", "warm#2"]) for (const href of hrefs) await switchTo(warm, href, pass)
} finally {
	await browser.close()
	server.close()
}
if (failed) {
	console.error(`a channel switch shifted the layout by more than ${MAX_SCORE}`)
	process.exit(1)
}
