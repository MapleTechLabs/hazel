import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { CHANNEL_TOLERANCE, diffInPage } from "./shoot.ts"

/**
 * `bun packages/ui/scripts/compare-islands.ts [--build] [--only <screen>] [--out <dir>] [--probe]`: the phase 3
 * islands against the Foldkit screens they replace. Serves the offline web build
 * (`apps/ios-hybrid/build/web`; `--build` runs `build:web:offline` first), opens `/` with each flag off
 * and on, clicks into the screen, and diffs the two shots per width (390, 1180) and theme. Writes
 * `<out>/<screen>/<theme>-<width>.png` strips (today | island | diff) and prints the differing share.
 * `--probe` also pairs the two runs' text by content and prints each run that moved or changed type.
 * The clock is pinned, so relative times and the fixture's `Date.now()` rows match between the runs.
 */

const repo = resolve(import.meta.dirname, "../../..")
const webRoot = resolve(repo, "apps/ios-hybrid/build/web")
const FIXED_NOW = new Date("2026-11-26T15:00:00Z")

interface Clip {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

interface Screen {
	readonly id: "channel-sidebar" | "dms" | "activity"
	readonly flag: string
	/** The phone tab bar's tab, or (wide) the app route opened by a link click. */
	readonly tab: string | null
	readonly href: string
	/** The island's container, which must exist with the flag on (else the island never mounted). */
	readonly island: string
	/** False where the island is phone only: wide, the flag changes nothing. */
	readonly wide: boolean
}

const screens: ReadonlyArray<Screen> = [
	{
		id: "channel-sidebar",
		flag: "hazel:island:channel-list",
		tab: "Home",
		href: "/hazel/chat",
		island: '[data-island="channel-list"]',
		wide: true,
	},
	{
		id: "dms",
		flag: "hazel:island:dms",
		tab: "DMs",
		href: "/hazel/chat/dms",
		island: '[data-island="dms"]',
		wide: false,
	},
	{
		id: "activity",
		flag: "hazel:island:activity",
		tab: "Activity",
		href: "/hazel/notifications",
		island: '[data-island="activity"]',
		wide: true,
	},
]

const widths = [390, 1180] as const
const themes = ["light", "dark"] as const

const argument = (name: string) => {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
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

/** Opens the screen at one width and theme with the flag on or off; returns the viewport's shot. */
const shoot = async (
	browser: Browser,
	base: string,
	screen: Screen,
	width: number,
	theme: string,
	island: boolean,
	clip: Clip | undefined,
): Promise<{ png: Buffer; mounted: boolean; region: Clip | undefined; runs: ReadonlyArray<Run> }> => {
	const context = await browser.newContext({
		viewport: { width, height: 844 },
		deviceScaleFactor: 2,
		reducedMotion: "reduce",
		colorScheme: theme === "dark" ? "dark" : "light",
	})
	await context.addInitScript(
		({ flag, island, theme }) => {
			localStorage.setItem("hazel-ui-theme", JSON.stringify(theme))
			if (island) localStorage.setItem(flag, "1")
		},
		{ flag: screen.flag, island, theme },
	)
	const page = await context.newPage()
	await page.clock.install({ time: FIXED_NOW })
	await page.clock.resume()
	try {
		await page.goto(base)
		await page.waitForURL(/\/hazel\/chat/, { timeout: 30_000 })
		await settle(page)
		const tab = page.locator("nav a", { hasText: screen.tab ?? "" }).last()
		if (width < 768 && screen.tab !== null && (await tab.count()) > 0) await tab.click()
		else await openRoute(page, screen.href)
		await settle(page)
		const mounted = (await page.locator(screen.island).count()) > 0
		// Wide, the island's slot (its container's parent) is the region compared; the rest is the page.
		const region =
			mounted && width >= 768
				? ((await page.locator(screen.island).evaluate((element) => {
						const box = (element.parentElement ?? element).getBoundingClientRect()
						return { x: box.x, y: box.y, width: box.width, height: box.height }
					})) ?? undefined)
				: undefined
		// Off the page: a pointer inside the sidebar would hover it (today's palette hint inks on that).
		await page.mouse.move(-10, -10)
		const png = await page.screenshot({ animations: "disabled", caret: "hide", clip: clip ?? region })
		const runs = await page.evaluate(textRuns, clip ?? region ?? { x: 0, y: 0, width, height: 844 })
		return { png, mounted, region, runs }
	} finally {
		await context.close()
	}
}

/** A text run's box and type, to pair today's with the island's (`--probe`). */
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
const probe = (today: ReadonlyArray<Run>, island: ReadonlyArray<Run>) => {
	const left = [...island]
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
	for (const run of left) console.log(`    only island: "${run.text}" at ${run.x},${run.y}`)
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

const settle = async (page: Page) => {
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" })
	await page.waitForTimeout(1500)
}

/** Today | island | diff, side by side, in the page's canvas. */
const strip = (page: Page, images: ReadonlyArray<Buffer>): Promise<Buffer> =>
	page
		.evaluate(
			async (images) => {
				const bitmaps = await Promise.all(
					images.map(async (base64) =>
						createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob()),
					),
				)
				const gap = 16
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
			images.map((image) => image.toString("base64")),
		)
		.then((base64) => Buffer.from(base64, "base64"))

const main = async () => {
	if (process.argv.includes("--build")) {
		const build = spawnSync("bun", ["run", "--cwd", "apps/ios-hybrid", "build:web:offline"], {
			cwd: repo,
			stdio: "inherit",
		})
		if (build.status !== 0) process.exit(build.status ?? 1)
	}
	const only = argument("--only")
	const out = resolve(repo, argument("--out") ?? "docs/hazel-ui-screens/phase3")
	const server = await serve()
	const base = `http://localhost:${(server.address() as AddressInfo).port}/`
	const browser = await chromium.launch()
	const scratch = await browser.newPage()
	const rows: Array<string> = []
	let failed = false
	try {
		for (const screen of screens.filter((s) => only === undefined || s.id === only)) {
			mkdirSync(resolve(out, screen.id), { recursive: true })
			for (const width of widths)
				for (const theme of themes) {
					const island = await shoot(browser, base, screen, width, theme, true, undefined)
					const today = await shoot(browser, base, screen, width, theme, false, island.region)
					const diff = await diffInPage(scratch, today.png, island.png, CHANNEL_TOLERANCE)
					const png = Buffer.from(diff.diffPng, "base64")
					writeFileSync(
						resolve(out, screen.id, `${theme}-${width}.png`),
						await strip(scratch, [today.png, island.png, png]),
					)
					const percent = (100 * diff.differing) / (diff.width * diff.height)
					const expected = width < 768 || screen.wide
					if (expected && !island.mounted) failed = true
					rows.push(
						`${screen.id.padEnd(16)} ${theme.padEnd(5)} ${String(width).padEnd(4)} ` +
							`${percent.toFixed(3).padStart(7)}% differ (${diff.differing} px, max delta ${diff.maxDelta})` +
							(island.mounted
								? ""
								: expected
									? "  ISLAND DID NOT MOUNT"
									: "  (no island at this width)"),
					)
					console.log(rows.at(-1))
					if (process.argv.includes("--probe")) probe(today.runs, island.runs)
				}
		}
	} finally {
		await browser.close()
		server.close()
	}
	process.exit(failed ? 1 : 0)
}

if (import.meta.main) await main()
