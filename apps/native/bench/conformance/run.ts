/**
 * Layout and visual conformance: Hazel's native renderer against Chromium on the same Foldkit view.
 *   bun apps/native/bench/conformance/run.ts [--scenario boot|sent|focus|menu|palette|dialog|context|mobile|drawer|all|routes|route-<name>]
 *     [--theme light|dark|both]
 *     [--check] [--update-thresholds] [--skip-build]
 * Writes out/<scenario>-<theme>/ (report.md, report.json, heatmap.png, crops/) and out/summary.md.
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { type Browser, chromium, type Page } from "playwright"
import {
	deltas,
	type El,
	ID_ATTRS,
	matchElements,
	normalizeText,
	onScreen,
	type Rect,
	round,
	summarize,
	type Summary,
} from "./match"
import { decodePng, encodePng } from "./png"
import { sideBySide, type Tile, visualDiff } from "./visual"

const here = import.meta.dirname
const appDir = resolve(here, "../..")
const distDir = resolve(here, "../web/dist")
const outRoot = join(here, "out")
const thresholdsPath = join(here, "thresholds.json")
const host = join(appDir, "host/target/release/hazel-native")
const CONTENT_TEXT = "Shipping it. Thanks everyone"
const TEXT = "Hello from Rune"
const SCALE = 2

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string, fallback: string) => {
	const at = args.indexOf(name)
	return at === -1 ? fallback : (args[at + 1] ?? fallback)
}
const SCENARIOS = [
	"boot",
	"sent",
	"focus",
	"menu",
	"palette",
	"dialog",
	"context",
	"mobile",
	"drawer",
] as const
/** Whole pages as they load: each route's layout and pixels against Chromium's. */
const ROUTES = new Map<`route-${string}`, string>([
	["route-files", "/hazel/chat/00000005-0000-4000-8000-000000000001/files"],
	// A channel with no messages: the empty state's masked picture.
	["route-empty", "/hazel/chat/00000005-0000-4000-8000-000000000002"],
	["route-notifications", "/hazel/notifications"],
	["route-appearance", "/hazel/my-settings"],
	["route-profile", "/hazel/my-settings/profile"],
	["route-notification-settings", "/hazel/my-settings/notifications"],
	["route-settings", "/hazel/settings"],
	["route-team", "/hazel/settings/team"],
	["route-integrations", "/hazel/settings/integrations"],
	["route-user", "/hazel/profile/00000002-0000-4000-8000-000000000001"],
])
type Scenario = (typeof SCENARIOS)[number] | `route-${string}`
const isRoute = (scenario: Scenario): scenario is `route-${string}` => scenario.startsWith("route-")
const routeOf = (scenario: Scenario) => (isRoute(scenario) ? ROUTES.get(scenario) : undefined)
/** Tabs from boot to the logo link, which draws a `focus-visible` outline. */
const FOCUS_TABS = 1
type Theme = "light" | "dark"
/** The window both sides render at: a phone's (the mobile layout) for the phone scenarios. */
const DESKTOP: Rect = { x: 0, y: 0, w: 1280, h: 800 }
const PHONE: Rect = { x: 0, y: 0, w: 402, h: 874 }
const viewportOf = (scenario: Scenario): Rect =>
	scenario === "mobile" || scenario === "drawer" ? PHONE : DESKTOP
const scenarioArg = option("--scenario", "all")
const themeArg = option("--theme", "both")
const everyScenario: Array<Scenario> = [...SCENARIOS, ...ROUTES.keys()]
const scenarios: Array<Scenario> =
	scenarioArg === "all"
		? everyScenario
		: scenarioArg === "routes"
			? [...ROUTES.keys()]
			: everyScenario.filter((scenario) => scenario === scenarioArg)
const themes: Array<Theme> =
	themeArg === "both" ? ["light", "dark"] : themeArg === "light" || themeArg === "dark" ? [themeArg] : []
if (scenarios.length === 0) throw new Error(`--scenario takes ${everyScenario.join(", ")}, all or routes`)
if (themes.length === 0) throw new Error("--theme takes light, dark or both")

// NATIVE

interface NativeLayout {
	scale: number
	elements: Array<{
		path: string
		tag: string
		text: string
		fullText: string
		attrs: Record<string, string>
		rect: { x: number; y: number; w: number; h: number; opacity: number } | null
	}>
}

const nativeSteps = (scenario: Scenario, layout: string, snap: string) => {
	if (isRoute(scenario)) return [{ settle: 2500 }, { wait: 500 }, { exportLayout: layout }, { snap }]
	const boot = [{ waitText: CONTENT_TEXT }, { settle: scenario === "boot" ? 1500 : 2500 }]
	const send = [
		{ focusEditable: null },
		{ type: TEXT },
		{ key: { name: "Enter", until: TEXT } },
		{ settle: 1500 },
	]
	const focus = [{ tab: FOCUS_TABS }, { wait: 500 }]
	// The org switcher's menu: a portalled, anchored, modal overlay.
	const menu = [{ clickText: "Hazel" }, { settle: 800 }]
	// The command palette: a modal dialog centred on the window, over a backdrop.
	const palette = [{ clickText: "Browse channels" }, { settle: 800 }]
	// The Set status dialog: foldkit UI's Dialog, modal, centred in its middle grid row.
	const dialog = [
		{ clickText: "Ada Lovelace" },
		{ settle: 500 },
		{ clickText: "Set status" },
		{ settle: 1000 },
	]
	// A message's context menu, opened at the pointer.
	const context = [{ rightClickText: CONTENT_TEXT }, { settle: 800 }]
	// The phone layout's sidebar: a drawer from the left. From #general: back to the chat list,
	// the Settings tab, and its top bar's menu.
	const drawer = [
		{ clickLabel: "Back to Chats" },
		{ settle: 1000 },
		{ clickText: "Settings" },
		{ settle: 1500 },
		{ clickLabel: "Settings menu" },
		{ settle: 1500 },
	]
	const steps = { boot: [], sent: send, focus, menu, palette, dialog, context, mobile: [], drawer }[
		scenario
	]
	return [...boot, ...steps, { exportLayout: layout }, { snap }]
}

const captureNative = async (scenario: Scenario, theme: Theme, dir: string) => {
	const layoutPath = join(dir, "native-layout.json")
	const snapPath = join(dir, "native.png")
	const script = join(dir, "native-script.json")
	writeFileSync(script, JSON.stringify(nativeSteps(scenario, layoutPath, snapPath)))
	const env = {
		...process.env,
		HAZEL_NATIVE_ENTRY: "dist/entry.js",
		NATIVE_THEME: theme,
		NATIVE_BENCH_OUT: join(dir, "native-bench.json"),
		// The page to open: the app's own start page unless the scenario is a route.
		NATIVE_PATH: routeOf(scenario) ?? process.env.NATIVE_PATH,
		NATIVE_WIDTH: String(viewportOf(scenario).w),
		NATIVE_HEIGHT: String(viewportOf(scenario).h),
	}
	// The host binary may be mid-rebuild by someone else, so retry a failed run.
	for (let attempt = 1; ; attempt++) {
		rmSync(layoutPath, { force: true })
		rmSync(snapPath, { force: true })
		const result = spawnSync(host, ["--capture", script], {
			cwd: appDir,
			env,
			stdio: ["ignore", "ignore", "pipe"],
			timeout: 120_000,
		})
		if (result.status === 0 && existsSync(layoutPath) && existsSync(snapPath)) break
		if (attempt >= 3)
			throw new Error(`native capture failed: ${result.stderr?.toString().slice(-2000) ?? "no stderr"}`)
		console.warn(`native capture attempt ${attempt} failed, retrying`)
		await sleep(5000)
	}
	// SAFETY: the host's exportLayout step writes this shape (apps/native/host/src/capture.rs).
	const layout = JSON.parse(readFileSync(layoutPath, "utf8")) as NativeLayout
	const parentPath = (path: string) => path.slice(0, path.lastIndexOf("/"))
	const byPath = new Map<string, number>()
	const hiddenAt = new Set<number>()
	const els: Array<El> = []
	for (const [index, e] of layout.elements.entries()) {
		byPath.set(e.path, index)
		const parent = byPath.get(parentPath(e.path)) ?? -1
		const siblings = parent >= 0 ? (els[parent]?.children ?? []) : []
		// The host keeps a screen-reader-only control at near-zero opacity: drawn nowhere, with all inside it.
		const hidden = (e.rect !== null && e.rect.opacity < 0.01) || (parent >= 0 && hiddenAt.has(parent))
		if (hidden) hiddenAt.add(index)
		els.push({
			index,
			path: e.path,
			tag: e.tag,
			text: normalizeText(e.text),
			fullText: normalizeText(e.fullText),
			attrs: e.attrs,
			className: "",
			rect:
				e.rect === null || e.rect.opacity <= 0 || hidden
					? null
					: { x: e.rect.x, y: e.rect.y, w: e.rect.w, h: e.rect.h },
			parent,
			childIndex: siblings.length,
			children: [],
		})
		siblings.push(index)
	}
	return { els, png: snapPath }
}

// WEB

interface WebRaw {
	path: string
	tag: string
	text: string
	fullText: string
	attrs: Record<string, string>
	className: string
	rect: { x: number; y: number; w: number; h: number } | null
	parent: number
	childIndex: number
}

declare global {
	interface Window {
		__conformanceLastMutation?: number
	}
}

const mimeTypes = new Map([
	[".html", "text/html"],
	[".js", "text/javascript"],
	[".css", "text/css"],
	[".wasm", "application/wasm"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".webp", "image/webp"],
	[".woff2", "font/woff2"],
	[".woff", "font/woff"],
	[".json", "application/json"],
	[".mp3", "audio/mpeg"],
])

const startServer = async () => {
	if (!existsSync(join(distDir, "index.html")))
		throw new Error(`${distDir} is missing; build it with bench/web/run.ts first`)
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://bench").pathname
		const candidate = join(distDir, path)
		const file =
			candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()
				? candidate
				: join(distDir, "index.html")
		response.writeHead(200, {
			"content-type": mimeTypes.get(extname(file)) ?? "application/octet-stream",
		})
		response.end(readFileSync(file))
	})
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
	const address = server.address()
	if (address === null || typeof address === "string") throw new Error("static server has no port")
	return { server, url: `http://127.0.0.1:${address.port}/` }
}

/** Waits until the DOM has been quiet for `quietMs`. */
const waitQuiet = async (page: Page, quietMs: number) => {
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		const idle = await page.evaluate(() => performance.now() - (window.__conformanceLastMutation ?? 0))
		if (idle >= quietMs) return
		await sleep(100)
	}
	console.warn("web: DOM never went quiet, capturing anyway")
}

/** Runs in the page: every element under #app in document order, svg subtrees excluded. */
const extractDom = (idAttrs: ReadonlyArray<string>) => {
	const out: Array<WebRaw> = []
	// Screen-reader-only content (`clip-path: inset(50%)`, and all inside it) draws nothing.
	const walk = (el: Element, parent: number, childIndex: number, path: string, hidden = false) => {
		const index = out.length
		const box = el.getBoundingClientRect()
		const srOnly = hidden || getComputedStyle(el).clipPath.replaceAll(" ", "") === "inset(50%)"
		const visible = !srOnly && el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
		const attrs: Record<string, string> = {}
		for (const attr of el.attributes) {
			if (attr.name.startsWith("data-") || idAttrs.includes(attr.name)) attrs[attr.name] = attr.value
		}
		const text = [...el.childNodes]
			.filter((node) => node.nodeType === Node.TEXT_NODE)
			.map((node) => node.textContent ?? "")
			.join("")
		out.push({
			path,
			tag: el.tagName.toLowerCase(),
			text,
			fullText: el.textContent ?? "",
			attrs,
			className: typeof el.className === "string" ? el.className : "",
			rect: visible ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
			parent,
			childIndex,
		})
		let i = 0
		for (const child of el.children) {
			if (child.tagName.toLowerCase() === "svg") continue
			walk(child, index, i, `${path}/${child.tagName.toLowerCase()}:${i}`, srOnly)
			i++
		}
	}
	const root = document.getElementById("app")
	if (root !== null) walk(root, -1, 0, "#app")
	return out
}

const captureWeb = async (browser: Browser, url: string, scenario: Scenario, theme: Theme, dir: string) => {
	const context = await browser.newContext({
		viewport: { width: viewportOf(scenario).w, height: viewportOf(scenario).h },
		deviceScaleFactor: SCALE,
		colorScheme: theme,
	})
	try {
		const page = await context.newPage()
		await page.addInitScript(() => {
			window.__conformanceLastMutation = 0
			new MutationObserver(() => {
				window.__conformanceLastMutation = performance.now()
			}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
		})
		const route = routeOf(scenario)
		await page.goto(route === undefined ? url : `${url.replace(/\/$/, "")}${route}`)
		if (route === undefined)
			await page.getByText(CONTENT_TEXT).first().waitFor({ state: "visible", timeout: 30_000 })
		else await page.waitForFunction(() => document.body.innerText.length > 40, null, { timeout: 30_000 })
		await waitQuiet(page, 1500)
		if (scenario === "sent") {
			const composer = page.locator(".ProseMirror").first()
			await composer.click()
			await page.keyboard.type(TEXT)
			await page.keyboard.press("Enter")
			await page.waitForFunction(
				(text) =>
					document.evaluate(
						`//text()[contains(., ${JSON.stringify(text)})][not(ancestor::*[@contenteditable="true"])]`,
						document,
						null,
						XPathResult.FIRST_ORDERED_NODE_TYPE,
						null,
					).singleNodeValue !== null,
				TEXT,
				{ timeout: 10_000 },
			)
			await waitQuiet(page, 1500)
		}
		if (scenario === "palette") {
			await page.getByText("Browse channels").first().click()
			await waitQuiet(page, 800)
		}
		if (scenario === "dialog") {
			await page.getByText("Ada Lovelace").first().click()
			await waitQuiet(page, 500)
			await page.getByText("Set status").first().click()
			await waitQuiet(page, 1000)
		}
		if (scenario === "context") {
			await page.getByText(CONTENT_TEXT).first().click({ button: "right" })
			await waitQuiet(page, 800)
		}
		if (scenario === "drawer") {
			// As the native steps press them: the chat list, the Settings tab, its menu.
			await page.getByRole("link", { name: "Back to Chats" }).click()
			await waitQuiet(page, 1000)
			await page.getByRole("navigation", { name: "Tabs" }).getByText("Settings", { exact: true }).click()
			await waitQuiet(page, 1500)
			await page.getByRole("button", { name: "Settings menu" }).click()
			await waitQuiet(page, 1500)
		}
		if (scenario === "menu") {
			await page.locator("#org-switcher-trigger").click()
			await waitQuiet(page, 800)
		}
		if (scenario === "focus") {
			for (let i = 0; i < FOCUS_TABS; i++) await page.keyboard.press("Tab")
			await waitQuiet(page, 500)
		}
		const raw = await page.evaluate(extractDom, ID_ATTRS)
		writeFileSync(join(dir, "web-layout.json"), JSON.stringify({ scale: SCALE, elements: raw }))
		const png = join(dir, "web.png")
		await page.screenshot({ path: png, animations: "disabled", caret: "hide" })
		const els: Array<El> = raw.map((r, index) => ({
			index,
			path: r.path,
			tag: r.tag,
			text: normalizeText(r.text),
			fullText: normalizeText(r.fullText),
			attrs: r.attrs,
			className: r.className,
			rect: r.rect,
			parent: r.parent,
			childIndex: r.childIndex,
			children: [],
		}))
		for (const el of els) els[el.parent]?.children.push(el.index)
		return { els, png }
	} finally {
		await context.close()
	}
}

// REPORT

const fmtRect = (rect: Rect | null) =>
	rect === null ? "-" : `${round(rect.x)},${round(rect.y)} ${round(rect.w)}x${round(rect.h)}`
const signed = (value: number) => `${value > 0 ? "+" : ""}${round(value)}`
const cell = (text: string, max = 60) => {
	const clean = text.replace(/\|/g, "\\|").replace(/\s+/g, " ")
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

type Gate = { min: Record<string, number>; max: Record<string, number> }

const runOne = async (browser: Browser, url: string, scenario: Scenario, theme: Theme) => {
	const name = `${scenario}-${theme}`
	const dir = join(outRoot, name)
	rmSync(dir, { recursive: true, force: true })
	mkdirSync(join(dir, "crops"), { recursive: true })
	console.log(`${name}: native capture`)
	const native = await captureNative(scenario, theme, dir)
	console.log(`${name}: web capture`)
	const web = await captureWeb(browser, url, scenario, theme, dir)

	const matching = matchElements(web.els, native.els)
	const viewport = viewportOf(scenario)
	const all = deltas(web.els, native.els, matching, viewport)
	const textual = all.filter((d) => d.web.text !== "")
	const layout = summarize(all)
	const text = summarize(textual)
	const missingOnNative = web.els.filter((w) => {
		if (!onScreen(w.rect, viewport)) return false
		const n = native.els[matching.webToNative.get(w.index) ?? -1]
		return n === undefined || n.rect === null
	})
	const extraOnNative = native.els.filter((n) => {
		if (!onScreen(n.rect, viewport)) return false
		const w = web.els[matching.nativeToWeb.get(n.index) ?? -1]
		return w === undefined || w.rect === null || w.rect.w <= 0 || w.rect.h <= 0
	})
	const unmatchedWeb = web.els.filter((w) => !matching.webToNative.has(w.index))
	const unmatchedNative = native.els.filter((n) => !matching.nativeToWeb.has(n.index))
	const phases = Object.fromEntries(
		["root", "text", "attrs", "structure"].map((p) => [
			p,
			[...matching.phase.values()].filter((v) => v === p).length,
		]),
	)

	const nativeImage = decodePng(readFileSync(native.png))
	const webImage = decodePng(readFileSync(web.png))
	const visual = visualDiff(nativeImage, webImage)
	writeFileSync(join(dir, "heatmap.png"), encodePng(visual.heatmap))
	const worstTiles = [...visual.tiles].sort((a, b) => a.score - b.score).slice(0, 6)
	const tileCrops = worstTiles.map((tile, i) => {
		const margin = 40
		const file = `crops/tile-${i + 1}-c${tile.col}r${tile.row}.png`
		const region = {
			x: tile.x - margin,
			y: tile.y - margin,
			w: tile.w + 2 * margin,
			h: tile.h + 2 * margin,
		}
		const box = { x: tile.x, y: tile.y, w: tile.w, h: tile.h }
		writeFileSync(
			join(dir, file),
			encodePng(sideBySide(nativeImage, webImage, region, [{ rect: box, rgba: [255, 160, 0, 255] }])),
		)
		return { tile, file }
	})

	const byOwn = [...all].sort((a, b) => b.ownScore - a.ownScore)
	const worst = [...all].sort((a, b) => b.score - a.score).slice(0, 40)
	// Crops of the worst own deltas, skipping elements nested in one already picked.
	// One crop per divergence group, on screen both sides, skipping elements nested in a picked one.
	const groupKey = (d: (typeof all)[number]) => {
		const parent = web.els[d.web.parent]
		return `${d.web.tag}|${d.web.className || `in:${parent?.className ?? ""}`}`
	}
	const inViewport = (r: Rect | null) =>
		onScreen(r, viewport) && r.x >= 0 && r.y >= 0 && r.x + r.w <= viewport.w && r.y + r.h <= viewport.h
	const picked: Array<(typeof all)[number]> = []
	const isAncestor = (a: El, b: El) => b.path.startsWith(`${a.path}/`)
	for (const d of byOwn) {
		if (picked.length >= 10 || d.ownScore < 1) break
		if (!inViewport(d.web.rect) || !inViewport(d.native.rect)) continue
		if (picked.some((p) => groupKey(p) === groupKey(d))) continue
		if (picked.some((p) => isAncestor(p.web, d.web) || isAncestor(d.web, p.web))) continue
		picked.push(d)
	}
	const groups = new Map<string, Array<(typeof all)[number]>>()
	for (const d of all) {
		if (d.ownScore < 1) continue
		groups.set(groupKey(d), [...(groups.get(groupKey(d)) ?? []), d])
	}
	const median = (values: ReadonlyArray<number>) => {
		const sorted = [...values].sort((a, b) => a - b)
		return round(sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN)
	}
	const groupRows = [...groups]
		.map(([key, items]) => ({
			key,
			count: items.length,
			total: items.reduce((sum, d) => sum + d.ownScore, 0),
			own: [
				median(items.map((d) => d.ownDx)),
				median(items.map((d) => d.ownDy)),
				median(items.map((d) => d.ownDw)),
				median(items.map((d) => d.ownDh)),
			],
			example: items[0],
		}))
		.sort((a, b) => b.total - a.total)
		.slice(0, 30)
	const elementCrops = picked.map((d, i) => {
		const n = d.native.rect ?? { x: 0, y: 0, w: 0, h: 0 }
		const w = d.web.rect ?? n
		const pad = 24
		const x0 = Math.max(0, Math.min(n.x, w.x) - pad)
		const y0 = Math.max(0, Math.min(n.y, w.y) - pad)
		const x1 = Math.min(viewport.w, Math.max(n.x + n.w, w.x + w.w) + pad, x0 + 640)
		const y1 = Math.min(viewport.h, Math.max(n.y + n.h, w.y + w.h) + pad, y0 + 400)
		const region = {
			x: Math.round(x0 * SCALE),
			y: Math.round(y0 * SCALE),
			w: Math.max(2, Math.round((x1 - x0) * SCALE)),
			h: Math.max(2, Math.round((y1 - y0) * SCALE)),
		}
		const px = (r: Rect) => ({ x: r.x * SCALE, y: r.y * SCALE, w: r.w * SCALE, h: r.h * SCALE })
		const file = `crops/element-${i + 1}.png`
		writeFileSync(
			join(dir, file),
			encodePng(
				sideBySide(nativeImage, webImage, region, [
					{ rect: px(w), rgba: [0, 180, 255, 255] },
					{ rect: px(n), rgba: [255, 0, 160, 255] },
				]),
			),
		)
		return { delta: d, file }
	})

	const metrics = {
		webElements: web.els.length,
		nativeElements: native.els.length,
		matched: matching.webToNative.size,
		matchedWebPct: round((100 * matching.webToNative.size) / Math.max(1, web.els.length)),
		unmatchedWeb: unmatchedWeb.length,
		unmatchedNative: unmatchedNative.length,
		missingOnNative: missingOnNative.length,
		extraOnNative: extraOnNative.length,
		pixelScore: visual.score,
		layout,
		text,
	}
	const deltaJson = (d: (typeof all)[number]) => ({
		webPath: d.web.path,
		nativePath: d.native.path,
		tag: d.web.tag,
		text: d.web.text,
		className: d.web.className,
		webRect: d.web.rect,
		nativeRect: d.native.rect,
		dx: round(d.dx),
		dy: round(d.dy),
		dw: round(d.dw),
		dh: round(d.dh),
		ownDx: round(d.ownDx),
		ownDy: round(d.ownDy),
		ownDw: round(d.ownDw),
		ownDh: round(d.ownDh),
	})
	const elJson = (e: El) => ({
		path: e.path,
		tag: e.tag,
		text: e.text,
		className: e.className,
		attrs: e.attrs,
		rect: e.rect,
	})
	writeFileSync(
		join(dir, "report.json"),
		`${JSON.stringify(
			{
				scenario,
				theme,
				metrics,
				matchPhases: phases,
				tiles: visual.tiles,
				groups: groupRows.map((g) => ({
					key: g.key,
					count: g.count,
					total: round(g.total),
					medianOwn: g.own,
				})),
				worst: worst.map(deltaJson),
				worstOwn: byOwn.slice(0, 100).map(deltaJson),
				missingOnNative: missingOnNative.map(elJson),
				extraOnNative: extraOnNative.map(elJson),
				unmatchedWeb: unmatchedWeb.map(elJson),
				unmatchedNative: unmatchedNative.map(elJson),
			},
			null,
			"\t",
		)}\n`,
	)

	const summaryRows = (label: string, s: Summary) =>
		`| ${label} | ${s.count} | ${s.posWithin1Pct}% | ${s.posWithin4Pct}% | ${s.sizeWithin1Pct}% | ${s.sizeWithin4Pct}% | ${s.posMedian} / ${s.posP95} | ${s.sizeMedian} / ${s.sizeP95} |`
	const deltaRow = (d: (typeof all)[number]) =>
		`| ${d.web.tag} | ${cell(d.web.text, 30)} | ${signed(d.dx)}, ${signed(d.dy)}, ${signed(d.dw)}, ${signed(d.dh)} | ${signed(d.ownDx)}, ${signed(d.ownDy)}, ${signed(d.ownDw)}, ${signed(d.ownDh)} | ${fmtRect(d.web.rect)} | ${fmtRect(d.native.rect)} | \`${cell(d.web.className, 70)}\` | \`${cell(d.native.path, 70)}\` |`
	const deltaHeader = [
		"| tag | own text | dx, dy, dw, dh | own dx, dy, dw, dh | web rect | native rect | web className | native path |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
	]
	const elRow = (e: El) =>
		`| ${e.tag} | ${cell(e.text, 30)} | ${fmtRect(e.rect)} | \`${cell(e.className || JSON.stringify(e.attrs), 70)}\` | \`${cell(e.path, 70)}\` |`
	const md = [
		`# Conformance: ${scenario}, ${theme}`,
		"",
		`Native (Rune host) against Chromium, ${viewport.w}x${viewport.h} points at 2x. Deltas are native minus web, in points.`,
		"",
		`Elements: web ${metrics.webElements}, native ${metrics.nativeElements}, matched ${metrics.matched} (${metrics.matchedWebPct}% of web; by text ${phases.text}, attributes ${phases.attrs}, structure ${phases.structure}). Unmatched: web ${metrics.unmatchedWeb}, native ${metrics.unmatchedNative}. Drawn on web but not native: ${metrics.missingOnNative}. Drawn natively but not on web: ${metrics.extraOnNative}.`,
		"",
		"| set | n | pos <=1pt | pos <=4pt | size <=1pt | size <=4pt | pos median / p95 | size median / p95 |",
		"| --- | --- | --- | --- | --- | --- | --- | --- |",
		summaryRows("all matched", layout),
		summaryRows("text-bearing", text),
		"",
		`Median abs per axis (all): dx ${layout.medianAbs.dx}, dy ${layout.medianAbs.dy}, dw ${layout.medianAbs.dw}, dh ${layout.medianAbs.dh}.`,
		"",
		`Pixels within tolerance: **${visual.score}%**. Heatmap: [heatmap.png](heatmap.png) (red = differs, grid = ${visual.tiles.length} tiles).`,
		"",
		"## Worst tiles",
		"",
		"| tile (col,row) | points | match | crop (native, web) |",
		"| --- | --- | --- | --- |",
		...tileCrops.map(
			({ tile, file }: { tile: Tile; file: string }) =>
				`| ${tile.col},${tile.row} | ${tile.x / SCALE},${tile.y / SCALE} ${tile.w / SCALE}x${tile.h / SCALE} | ${tile.score}% | [${file}](${file}) |`,
		),
		"",
		"## Divergence groups (own delta >= 1pt, grouped by tag + className, or parent className when empty)",
		"",
		"| group | n | median own dx, dy, dw, dh | sum of own error | example text | example native path |",
		"| --- | --- | --- | --- | --- | --- |",
		...groupRows.map(
			(g) =>
				`| \`${cell(g.key, 90)}\` | ${g.count} | ${g.own.map(signed).join(", ")} | ${round(g.total)} | ${cell(g.example?.web.text ?? "", 30)} | \`${cell(g.example?.native.path ?? "", 60)}\` |`,
		),
		"",
		"## 40 worst element deltas",
		"",
		"`own` is the error this element adds on top of its nearest matched ancestor: where a divergence starts.",
		"",
		...deltaHeader,
		...worst.map(deltaRow),
		"",
		"## 40 worst own deltas (where divergence originates)",
		"",
		...deltaHeader,
		...byOwn.slice(0, 40).map(deltaRow),
		"",
		"## Element crops (native, web; cyan = web rect, magenta = native rect)",
		"",
		...elementCrops.map(
			({ delta, file }) =>
				`- [${file}](${file}): ${delta.web.tag} "${cell(delta.web.text, 40)}" own ${signed(delta.ownDx)}, ${signed(delta.ownDy)}, ${signed(delta.ownDw)}, ${signed(delta.ownDh)} \`${cell(delta.web.className, 80)}\``,
		),
		"",
		`## Drawn on web, missing natively (${missingOnNative.length}, first 40)`,
		"",
		"| tag | own text | web rect | web className | web path |",
		"| --- | --- | --- | --- | --- |",
		...missingOnNative.slice(0, 40).map(elRow),
		"",
		`## Drawn natively, not on web (${extraOnNative.length}, first 25)`,
		"",
		"| tag | own text | native rect | attrs | native path |",
		"| --- | --- | --- | --- | --- |",
		...extraOnNative.slice(0, 25).map(elRow),
		"",
	].join("\n")
	writeFileSync(join(dir, "report.md"), md)
	console.log(
		`${name}: matched ${metrics.matchedWebPct}%, pos<=4pt ${layout.posWithin4Pct}%, text pos<=4pt ${text.posWithin4Pct}%, pixels ${visual.score}%`,
	)
	return { name, metrics, dir }
}

/** The values the gate checks, read off a run's metrics. */
const gateValues = (m: Awaited<ReturnType<typeof runOne>>["metrics"]) => ({
	min: {
		matchedWebPct: m.matchedWebPct,
		posWithin4Pct: m.layout.posWithin4Pct,
		sizeWithin4Pct: m.layout.sizeWithin4Pct,
		textPosWithin4Pct: m.text.posWithin4Pct,
		textSizeWithin4Pct: m.text.sizeWithin4Pct,
		pixelScore: m.pixelScore,
	},
	max: {
		missingOnNative: m.missingOnNative,
		posP95: m.layout.posP95,
		textPosP95: m.text.posP95,
	},
})

// MAIN

if (!flag("--skip-build")) {
	console.log("building the native runtime bundle")
	if (spawnSync("bun", ["run", "build"], { cwd: appDir, stdio: "ignore" }).status !== 0)
		throw new Error("bun run build failed in apps/native")
}
if (!existsSync(host)) throw new Error("Build the host first: cd apps/native && bun run host:build")
mkdirSync(outRoot, { recursive: true })
const { server, url } = await startServer()
const browser = await chromium.launch({ headless: true, channel: "chromium" })
const results: Array<Awaited<ReturnType<typeof runOne>>> = []
try {
	for (const scenario of scenarios) {
		for (const theme of themes) results.push(await runOne(browser, url, scenario, theme))
	}
} finally {
	await browser.close()
	server.close()
}

const summaryMd = [
	"# Conformance summary",
	"",
	"| run | matched (web %) | missing on native | pos <=1 / <=4pt | size <=1 / <=4pt | text pos <=1 / <=4pt | text size <=4pt | pos p95 | pixels |",
	"| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	...results.map(
		({ name, metrics: m }) =>
			`| [${name}](${name}/report.md) | ${m.matched} (${m.matchedWebPct}%) | ${m.missingOnNative} | ${m.layout.posWithin1Pct}% / ${m.layout.posWithin4Pct}% | ${m.layout.sizeWithin1Pct}% / ${m.layout.sizeWithin4Pct}% | ${m.text.posWithin1Pct}% / ${m.text.posWithin4Pct}% | ${m.text.sizeWithin4Pct}% | ${m.layout.posP95} | ${m.pixelScore}% |`,
	),
	"",
].join("\n")
writeFileSync(join(outRoot, "summary.md"), summaryMd)
console.log(`\n${summaryMd}\nreports: ${outRoot}`)

const readGates = (): Record<string, Gate> =>
	// SAFETY: thresholds.json is written by --update-thresholds in this shape.
	existsSync(thresholdsPath)
		? (JSON.parse(readFileSync(thresholdsPath, "utf8")) as Record<string, Gate>)
		: {}

if (flag("--update-thresholds")) {
	// Baseline slightly relaxed so run-to-run noise does not trip the gate.
	const gates = readGates()
	for (const { name, metrics } of results) {
		const values = gateValues(metrics)
		gates[name] = {
			min: Object.fromEntries(
				Object.entries(values.min).map(([k, v]) => [
					k,
					round(Math.max(0, v - (k === "pixelScore" ? 1 : 2))),
				]),
			),
			max: Object.fromEntries(
				Object.entries(values.max).map(([k, v]) => [
					k,
					round(k.endsWith("P95") ? v * 1.25 + 1 : v + Math.max(3, v * 0.1)),
				]),
			),
		}
	}
	writeFileSync(thresholdsPath, `${JSON.stringify(gates, null, "\t")}\n`)
	console.log(`thresholds written: ${thresholdsPath}`)
}

if (flag("--check")) {
	const gates = readGates()
	const failures: Array<string> = []
	for (const { name, metrics } of results) {
		const gate = gates[name]
		if (gate === undefined) {
			failures.push(`${name}: no thresholds (run with --update-thresholds)`)
			continue
		}
		const values = gateValues(metrics)
		for (const [k, v] of Object.entries(values.min)) {
			const limit = gate.min[k]
			if (limit !== undefined && !(v >= limit)) failures.push(`${name}: ${k} ${v} < ${limit}`)
		}
		for (const [k, v] of Object.entries(values.max)) {
			const limit = gate.max[k]
			if (limit !== undefined && !(v <= limit)) failures.push(`${name}: ${k} ${v} > ${limit}`)
		}
	}
	if (failures.length > 0) {
		console.error(`conformance check failed:\n  ${failures.join("\n  ")}`)
		process.exit(1)
	}
	console.log("conformance check passed")
}
