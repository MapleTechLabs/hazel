import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { basename, resolve } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import type { ComparePage, CompareStep } from "../../../apps/web-foldkit/src/parity/compare-entry.ts"
import { CHANNEL_TOLERANCE, diffInPage } from "./shoot.ts"

/**
 * `bun packages/ui/scripts/compare-pages.ts [--build] [--only <id,...>] [--out <dir>] [--probe] [--strict]
 * [--baseline [--from <dir>]]`: each hazel page against the Foldkit screen it replaces, over the offline
 * web build (`apps/ios-hybrid/build/web`; `--build` runs `build:web:offline` first). Pages come from
 * `apps/web-foldkit/src/parity/pages/<id>.ts` (a `ComparePage`); a page's own fixture data from
 * `apps/ios-hybrid/fixture/pages/<id>.ts` (`page-fixture.ts`), applied on both sides.
 *
 * Live: opens `href` with the flag off (today) and on (hazel), runs the steps, and writes
 * `<out>/<id>/<theme>-<width>.png` strips (today | hazel | diff), 390 and 1180 wide, light and dark.
 * `--baseline`: today is the left panel of the stored strip in `<from>/<id>/` (so a page can still be
 * checked once its Foldkit original is gone); only the hazel side runs, and strips go to `<out>`.
 * The clock is pinned and motion reduced, so both runs draw the same rows at the same times.
 */

const repo = resolve(import.meta.dirname, "../../..")
const webRoot = resolve(repo, "apps/ios-hybrid/build/web")
const pagesDir = resolve(repo, "apps/web-foldkit/src/parity/pages")
const fixturePagesDir = resolve(repo, "apps/ios-hybrid/fixture/pages")
const storedDir = resolve(repo, "docs/hazel-ui-screens/phase4")
const FIXED_NOW = new Date("2026-11-26T15:00:00Z")
/** `PAGE_FIXTURE_KEY` in `apps/ios-hybrid/fixture/page-fixture.ts` (Vite-only, not importable here). */
const PAGE_FIXTURE_KEY = "hazel:fixture:page"
/** The tolerance (`docs/hazel-ui-phase4.md`, "Pixel parity method"): residue up to a channel delta of 5. */
const MAX_DELTA = 5
/** The gap between a strip's panels. */
const GAP = 16

const widths = [390, 1180] as const
const themes = ["light", "dark"] as const
const COMPACT_BELOW = 768

interface Clip {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

interface Entry extends ComparePage {
	readonly id: string
}

const argument = (name: string) => {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

/** Every `pages/<id>.ts`, by id; a file whose default export is not a page fails loudly. */
const loadRegistry = async (): Promise<ReadonlyArray<Entry>> => {
	const files = readdirSync(pagesDir)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.sort()
	return Promise.all(
		files.map(async (file) => {
			const page = ((await import(resolve(pagesDir, file))) as { default?: ComparePage }).default
			if (typeof page?.flag !== "string" || typeof page.href !== "string" || !Array.isArray(page.steps))
				throw new Error(`${file}: the default export is not a ComparePage`)
			return { ...page, id: basename(file, ".ts") }
		}),
	)
}

const types = {
	html: "text/html",
	js: "text/javascript",
	css: "text/css",
	json: "application/json",
	svg: "image/svg+xml",
	png: "image/png",
	webp: "image/webp",
	woff2: "font/woff2",
} as const satisfies Record<string, string>

const isFile = (path: string) => {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

/** The build on a free port; app routes fall back to the page, as the shell's server does. */
const serve = (): Promise<Server> =>
	new Promise((ready) => {
		const server = createServer((request, response) => {
			const path = new URL(request.url ?? "/", "http://localhost").pathname
			const file =
				path !== "/" && isFile(resolve(webRoot, `.${path}`))
					? resolve(webRoot, `.${path}`)
					: resolve(webRoot, "index.html")
			response.writeHead(200, {
				"content-type":
					Object.entries(types).find(([extension]) => file.endsWith(`.${extension}`))?.[1] ??
					"application/octet-stream",
			})
			response.end(readFileSync(file))
		})
		server.listen(0, () => ready(server))
	})

interface Shot {
	readonly png: Buffer
	readonly mounted: boolean
	readonly region: Clip | undefined
	readonly runs: ReadonlyArray<Run>
}

/** Opens the page at one width and theme with the flag on or off; returns the compared region's shot. */
const shoot = async (
	browser: Browser,
	base: string,
	entry: Entry,
	width: number,
	theme: string,
	hazel: boolean,
	clip: Clip | undefined,
): Promise<Shot> => {
	const context = await browser.newContext({
		viewport: { width, height: 844 },
		deviceScaleFactor: 2,
		reducedMotion: "reduce",
		colorScheme: theme === "dark" ? "dark" : "light",
	})
	await context.addInitScript(
		({ flag, hazel, theme, id, key }) => {
			localStorage.setItem("hazel-ui-theme", JSON.stringify(theme))
			localStorage.setItem(key, id)
			if (hazel) localStorage.setItem(flag, "1")
		},
		{ flag: entry.flag, hazel, theme, id: entry.id, key: PAGE_FIXTURE_KEY },
	)
	const page = await context.newPage()
	await page.clock.install({ time: FIXED_NOW })
	await page.clock.resume()
	const compact = width < COMPACT_BELOW
	try {
		await page.goto(base)
		await page.waitForURL(/\/hazel\/chat/, { timeout: 30_000 })
		await settle(page)
		const tab = page.locator("nav a", { hasText: entry.tab ?? "" }).last()
		if (compact && entry.tab !== undefined && (await tab.count()) > 0) await tab.click()
		else await openRoute(page, entry.href)
		await settle(page)
		const size = compact ? "compact" : "regular"
		for (const step of entry.steps.filter((s) => s.at === undefined || s.at === size)) {
			await runStep(page, step)
			await settle(page, 400)
		}
		const mounted = (await page.locator(entry.island).count()) > 0
		// Wide, the page's slot (its container's parent) is the region compared, unless the entry says viewport.
		const region =
			mounted && !compact && entry.region !== "viewport"
				? ((await page
						.locator(entry.island)
						.first()
						.evaluate((element) => {
							const box = (element.parentElement ?? element).getBoundingClientRect()
							return { x: box.x, y: box.y, width: box.width, height: box.height }
						})) ?? undefined)
				: undefined
		// Off the page, unless a step hovers: a pointer inside a sidebar would hover a row.
		if (!entry.steps.some((step) => "hover" in step)) await page.mouse.move(-10, -10)
		const png = await page.screenshot({ animations: "disabled", caret: "hide", clip: clip ?? region })
		const runs = await page.evaluate(textRuns, clip ?? region ?? { x: 0, y: 0, width, height: 844 })
		return { png, mounted, region, runs }
	} finally {
		await context.close()
	}
}

const runStep = async (page: Page, step: CompareStep) => {
	if ("click" in step) await page.locator(step.click).first().click()
	else if ("hover" in step) await page.locator(step.hover).first().hover()
	else if ("press" in step) await page.keyboard.press(step.press)
	else if ("fill" in step) await page.locator(step.fill).first().fill(step.text)
	else if ("waitFor" in step) await page.locator(step.waitFor).first().waitFor({ timeout: 10_000 })
	else await openRoute(page, step.route)
}

/** A text run's box and type, to pair today's with the hazel side's (`--probe`). */
interface Run {
	readonly text: string
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
	readonly style: string
}

/** Every visible text run inside the region, in document order (runs in the page). */
const textRuns = (region: Clip): Array<Run> => {
	const runs: Array<Run> = []
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
	for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
		const text = node.textContent?.trim() ?? ""
		const parent = node.parentElement
		if (text === "" || parent === null) continue
		const range = document.createRange()
		range.selectNodeContents(node)
		const box = range.getBoundingClientRect()
		if (box.width === 0 || box.bottom <= region.y || box.top >= region.y + region.height) continue
		if (box.right <= region.x || box.left >= region.x + region.width) continue
		const css = getComputedStyle(parent)
		if (css.visibility === "hidden" || Number(css.opacity) === 0) continue
		const round = (n: number) => Math.round(n * 10) / 10
		runs.push({
			text: text.slice(0, 40),
			x: round(box.x - region.x),
			y: round(box.y - region.y),
			w: round(box.width),
			h: round(box.height),
			style: `${css.fontSize}/${css.lineHeight} ${css.fontWeight} ${css.color} ${css.letterSpacing} ${css.textTransform}`,
		})
	}
	return runs
}

/** Pairs runs by text (in order) and prints each that moved or changed type. */
const probe = (today: ReadonlyArray<Run>, hazel: ReadonlyArray<Run>) => {
	const left = [...hazel]
	for (const run of today) {
		const index = left.findIndex((other) => other.text.toLowerCase() === run.text.toLowerCase())
		if (index === -1) {
			console.log(`    only today: "${run.text}" at ${run.x},${run.y}`)
			continue
		}
		const [other] = left.splice(index, 1)
		if (other === undefined) continue
		const moved = ["x", "y", "w", "h"] as const
		const deltas = moved
			.filter((key) => Math.abs(run[key] - other[key]) > 0.5)
			.map((key) => `${key} ${run[key]}->${other[key]}`)
		if (run.text !== other.text) deltas.push(`text "${other.text}"`)
		if (run.style !== other.style) deltas.push(`style ${run.style} -> ${other.style}`)
		if (deltas.length > 0) console.log(`    "${run.text}": ${deltas.join(", ")}`)
	}
	for (const run of left) console.log(`    only hazel: "${run.text}" at ${run.x},${run.y}`)
}

/** In-app navigation (a deep link can hang on the loader offline): a link click, else history. */
const openRoute = async (page: Page, href: string) => {
	if (new URL(page.url()).pathname === href) return
	const link = page.locator(`a[href="${href}"]`).first()
	if ((await link.count()) > 0 && (await link.isVisible())) await link.click()
	else
		await page.evaluate((href) => {
			history.pushState(null, "", href)
			dispatchEvent(new PopStateEvent("popstate"))
		}, href)
	await page.waitForURL((url) => url.pathname === href, { timeout: 10_000 })
}

const settle = async (page: Page, ms = 1500) => {
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" })
	await page.waitForTimeout(ms)
}

const fromBase64 = (base64: string) => Buffer.from(base64, "base64")

/** Today | hazel | diff, side by side, in the page's canvas. */
const strip = (page: Page, images: ReadonlyArray<Buffer>): Promise<Buffer> =>
	page
		.evaluate(
			async ({ images, gap }) => {
				const bitmaps = await Promise.all(
					images.map(async (base64) =>
						createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob()),
					),
				)
				const width = bitmaps.reduce((sum, b) => sum + b.width, 0) + gap * (bitmaps.length - 1)
				const height = Math.max(...bitmaps.map((b) => b.height))
				const canvas = new OffscreenCanvas(width, height)
				const context = canvas.getContext("2d")
				if (context === null) throw new Error("no 2d context")
				context.fillStyle = "#808080"
				context.fillRect(0, 0, width, height)
				let x = 0
				for (const bitmap of bitmaps) {
					context.drawImage(bitmap, x, 0)
					x += bitmap.width + gap
				}
				const bytes = new Uint8Array(
					await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
				)
				let binary = ""
				for (const byte of bytes) binary += String.fromCharCode(byte)
				return btoa(binary)
			},
			{ images: images.map((image) => image.toString("base64")), gap: GAP },
		)
		.then(fromBase64)

/**
 * A stored strip's left panel (today), cropped to the hazel shot's size: the three panels share one
 * width, so today's is `(strip - 2 gaps) / 3`. `undefined` when the strip and the shot disagree.
 */
const todayFromStrip = (page: Page, stored: Buffer, hazel: Buffer): Promise<Buffer | undefined> =>
	page
		.evaluate(
			async ({ stored, hazel, gap }) => {
				const load = async (base64: string) =>
					createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
				const [a, b] = await Promise.all([load(stored), load(hazel)])
				const width = (a.width - 2 * gap) / 3
				if (width !== b.width || a.height < b.height) return undefined
				const canvas = new OffscreenCanvas(b.width, b.height)
				const context = canvas.getContext("2d")
				if (context === null) throw new Error("no 2d context")
				context.drawImage(a, 0, 0, b.width, b.height, 0, 0, b.width, b.height)
				const bytes = new Uint8Array(
					await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
				)
				let binary = ""
				for (const byte of bytes) binary += String.fromCharCode(byte)
				return btoa(binary)
			},
			{ stored: stored.toString("base64"), hazel: hazel.toString("base64"), gap: GAP },
		)
		.then((base64) => (base64 === undefined ? undefined : fromBase64(base64)))

const main = async () => {
	if (process.argv.includes("--build")) {
		const build = spawnSync("bun", ["run", "--cwd", "apps/ios-hybrid", "build:web:offline"], {
			cwd: repo,
			stdio: "inherit",
		})
		if (build.status !== 0) process.exit(build.status ?? 1)
	}
	if (!isFile(resolve(webRoot, "index.html"))) {
		console.error(`no offline build at ${webRoot}: run with --build`)
		process.exit(1)
	}
	const baseline = process.argv.includes("--baseline")
	const strict = process.argv.includes("--strict")
	const only = argument("--only")?.split(",")
	const from = resolve(repo, argument("--from") ?? storedDir)
	const out = resolve(
		repo,
		argument("--out") ?? (baseline ? "node_modules/.cache/compare-pages" : storedDir),
	)
	const registry = await loadRegistry()
	const unknown = only?.filter((id) => !registry.some((entry) => entry.id === id)) ?? []
	if (unknown.length > 0) {
		console.error(`no page ${unknown.join(", ")} in ${pagesDir}`)
		process.exit(1)
	}
	const server = await serve()
	const base = `http://localhost:${(server.address() as AddressInfo).port}/`
	const browser = await chromium.launch()
	const scratch = await browser.newPage()
	let failed = false
	try {
		for (const entry of registry.filter((e) => only === undefined || only.includes(e.id))) {
			const fixture = existsSync(resolve(fixturePagesDir, `${entry.id}.ts`)) ? " (page fixture)" : ""
			console.log(`${entry.id}${fixture}${baseline ? `, against ${from}/${entry.id}` : ""}`)
			mkdirSync(resolve(out, entry.id), { recursive: true })
			for (const width of widths)
				for (const theme of themes) {
					const name = `${theme}-${width}.png`
					const label = `${entry.id.padEnd(16)} ${theme.padEnd(5)} ${String(width).padEnd(4)}`
					const hazel = await shoot(browser, base, entry, width, theme, true, undefined)
					const expected = width < COMPACT_BELOW || entry.wide
					if (expected && !hazel.mounted) failed = true
					let today: Buffer | undefined
					if (baseline) {
						const stored = resolve(from, entry.id, name)
						today = isFile(stored)
							? await todayFromStrip(scratch, readFileSync(stored), hazel.png)
							: undefined
						if (today === undefined) {
							failed = true
							console.log(
								`${label}   ${isFile(stored) ? "stored strip does not match the shot's size" : `no stored strip ${stored}`}`,
							)
							continue
						}
					} else {
						const shot = await shoot(browser, base, entry, width, theme, false, hazel.region)
						today = shot.png
						if (process.argv.includes("--probe")) probe(shot.runs, hazel.runs)
					}
					const diff = await diffInPage(scratch, today, hazel.png, CHANNEL_TOLERANCE)
					writeFileSync(
						resolve(out, entry.id, name),
						await strip(scratch, [today, hazel.png, fromBase64(diff.diffPng)]),
					)
					const percent = (100 * diff.differing) / (diff.width * diff.height)
					const within = diff.maxDelta <= MAX_DELTA
					if (strict && expected && !within) failed = true
					console.log(
						`${label} ${percent.toFixed(3).padStart(7)}% differ (${diff.differing} px, max delta ${diff.maxDelta})` +
							(hazel.mounted
								? within
									? ""
									: "  OVER TOLERANCE"
								: expected
									? "  PAGE DID NOT MOUNT"
									: "  (no hazel page at this width)"),
					)
				}
		}
	} finally {
		await browser.close()
		server.close()
	}
	process.exit(failed ? 1 : 0)
}

if (import.meta.main) await main()
