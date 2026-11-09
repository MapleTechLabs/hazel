/**
 * Parity crawl: every route and every control on it, in Chromium and natively, from the same
 * offline fixture. Finds what differs without a hand-written list of what to check. The `open`
 * phase goes a level deeper: each control that opens something (a menu, a dialog, a popover)
 * is opened again and every new control in it clicked, both sides from a fresh load.
 *   bun apps/native/bench/parity/run.ts [--route <substring>] [--max <controls per route>]
 *     [--jobs <native processes at once>] [--skip-build]
 * For each route: the texts each side shows (content missing or extra natively). For each control
 * Chromium finds there (buttons, links, menu items, tabs, switches): a click from a fresh load on
 * both sides, and what appeared; a click that does nothing natively, shows something else or throws
 * is a finding. Writes out/report.md and out/report.json.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { type Browser, chromium, type Page } from "playwright"

const here = import.meta.dirname
const appDir = resolve(here, "../..")
const webDir = resolve(appDir, "../web-foldkit")
const distDir = resolve(here, "../web/dist")
const outDir = join(here, "out")
const host = join(appDir, "host/target/release/hazel-native")
const VIEWPORT = { width: 1280, height: 800 }

const GENERAL = "00000005-0000-4000-8000-000000000001"
const ADA = "00000002-0000-4000-8000-000000000001"
const ROUTES = [
	`/hazel/chat/${GENERAL}`,
	`/hazel/chat/${GENERAL}/files`,
	`/hazel/chat/${GENERAL}/settings`,
	"/hazel/notifications",
	"/hazel/notifications/dms",
	"/hazel/my-settings",
	"/hazel/my-settings/profile",
	"/hazel/my-settings/linked-accounts",
	"/hazel/my-settings/notifications",
	"/hazel/my-settings/desktop",
	"/hazel/settings",
	"/hazel/settings/team",
	"/hazel/settings/invitations",
	"/hazel/settings/custom-emojis",
	"/hazel/settings/integrations",
	"/hazel/settings/chat-sync",
	"/hazel/settings/debug",
	`/hazel/profile/${ADA}`,
]

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const routeFilter = option("--route")
const maxPerRoute = Number(option("--max") ?? 40)
const jobs = Number(option("--jobs") ?? 4)
const phases = new Set((option("--phases") ?? "load,click,hover,tab,open,type").split(","))
/** What the `type` phase types into each field before pressing Return. */
const TYPED = "parity probe"
/** How many openers, and how many of the controls each opens, the `open` phase follows. */
const maxOpeners = Number(option("--max-openers") ?? 12)
const maxOpened = Number(option("--max-opened") ?? 12)
/** How many Tab presses the tab-order phase follows on each route. */
const TABS = 24

type Control = { label: string; role: string; x: number; y: number }
type Outcome = { texts: Array<string>; errors: Array<string> }

// Bidi isolates (\u2066-\u2069) wrap names in the web build and draw nothing.
const normalize = (text: string) =>
	text
		.replaceAll(/[\u2066-\u2069]/g, "")
		.replaceAll(/\s+/g, " ")
		.trim()

/**
 * Differences by design: the version label (the web build's number, the native build's name),
 * and an editor's placeholder, which the native text field draws itself rather than as text.
 */
const BY_DESIGN = new Set(["vnative", "v", "#.#.#", "v#.#.#", "Type a message..."])

/** Openers whose result differs by design: "Generate" makes random theme palettes. */
const RANDOM_OPENERS = new Set(["Generate"])

/** A text as both sides compare it: digits masked, so clocks and counts a minute apart agree. */
const comparable = (texts: ReadonlyArray<string>) => [
	...new Set(
		texts
			// The app's own origin: the test server's on the web, the configured app URL natively.
			.map((t) =>
				normalize(t).replaceAll(/https?:\/\/(127\.0\.0\.1:\d+|app\.hazel\.test)/g, "<origin>"),
			)
			.map((t) => t.replaceAll(/\d/g, "#"))
			.filter((t) => t !== "" && !BY_DESIGN.has(t)),
	),
]

// WEB

const mimeTypes = new Map([
	[".html", "text/html"],
	[".js", "text/javascript"],
	[".css", "text/css"],
	[".wasm", "application/wasm"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".woff2", "font/woff2"],
	[".json", "application/json"],
	[".mp3", "audio/mpeg"],
])

const startServer = async () => {
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://parity").pathname
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
	return { server, origin: `http://127.0.0.1:${address.port}` }
}

declare global {
	interface Window {
		__parityLastMutation?: number
	}
}

const waitQuiet = async (page: Page, quietMs: number) => {
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		const idle = await page.evaluate(() => performance.now() - (window.__parityLastMutation ?? 0))
		if (idle >= quietMs) return
		await sleep(80)
	}
}

/**
 * Runs in the page: each element's own text (its text children joined, as the native export
 * reads it) when the element is drawn inside the viewport; screen-reader-only boxes excluded.
 */
const visibleTexts = (): Array<string> => {
	const out = new Set<string>()
	for (const el of document.body.querySelectorAll("*")) {
		let own = ""
		for (const child of el.childNodes)
			if (child.nodeType === Node.TEXT_NODE) own += child.textContent ?? ""
		const text = own.replaceAll(/\s+/g, " ").trim()
		if (text === "") continue
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
		const box = el.getBoundingClientRect()
		if (box.width < 2 || box.height < 2 || box.right <= 0 || box.bottom <= 0) continue
		if (box.left >= window.innerWidth || box.top >= window.innerHeight) continue
		out.add(text)
	}
	return [...out]
}

/** Runs in the page: every enabled control drawn inside the viewport, by its centre. */
const findControls = (): Array<Control> => {
	const selector =
		'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], summary'
	const seen = new Set<string>()
	const out: Array<Control> = []
	for (const el of document.querySelectorAll<HTMLElement>(selector)) {
		if (el.closest("[inert], [aria-hidden='true']") !== null) continue
		if (el.matches(":disabled, [aria-disabled='true']")) continue
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
		const box = el.getBoundingClientRect()
		if (box.width < 4 || box.height < 4) continue
		const x = Math.round(box.left + box.width / 2)
		const y = Math.round(box.top + box.height / 2)
		if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) continue
		// The element a click there lands on must be this control or inside it.
		const hit = document.elementFromPoint(x, y)
		if (hit === null || !(el === hit || el.contains(hit))) continue
		const key = `${x},${y}`
		if (seen.has(key)) continue
		seen.add(key)
		const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replaceAll(/\s+/g, " ").trim()
		out.push({
			label: label.slice(0, 50) || el.tagName.toLowerCase(),
			role: el.getAttribute("role") ?? el.tagName.toLowerCase(),
			x,
			y,
		})
	}
	return out
}

/** Runs in the page: every text field drawn inside the viewport, by its centre. */
const findFields = (): Array<Control> => {
	const selector =
		'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]), textarea, [contenteditable="true"]'
	const out: Array<Control> = []
	for (const el of document.querySelectorAll<HTMLElement>(selector)) {
		if (el.closest("[inert], [aria-hidden='true']") !== null) continue
		if (el.matches(":disabled, [readonly]")) continue
		if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
		const box = el.getBoundingClientRect()
		if (box.width < 8 || box.height < 8) continue
		const x = Math.round(box.left + Math.min(box.width / 2, 40))
		const y = Math.round(box.top + box.height / 2)
		if (x <= 0 || y <= 0 || x >= window.innerWidth || y >= window.innerHeight) continue
		const hit = document.elementFromPoint(x, y)
		if (hit === null || !(el === hit || el.contains(hit) || hit.contains(el))) continue
		const label =
			el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("name") ?? ""
		out.push({
			label: label.slice(0, 50) || el.tagName.toLowerCase(),
			role: el.tagName.toLowerCase(),
			x,
			y,
		})
	}
	return out
}

const openPage = async (browser: Browser, url: string) => {
	const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "dark" })
	const page = await context.newPage()
	const errors: Array<string> = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.addInitScript(() => {
		window.__parityLastMutation = 0
		new MutationObserver(() => {
			window.__parityLastMutation = performance.now()
		}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
	})
	await page.goto(url)
	// The app has booted when its shell shows; only then does a quiet DOM mean it settled.
	await page.waitForFunction(() => (document.body.innerText ?? "").length > 40, null, { timeout: 30_000 })
	await waitQuiet(page, 900)
	return { page, context, errors }
}

const webRoute = async (browser: Browser, url: string) => {
	const { page, context, errors } = await openPage(browser, url)
	const texts = await page.evaluate(visibleTexts)
	const controls = (await page.evaluate(findControls)).slice(0, maxPerRoute)
	await context.close()
	return { texts, controls, errors }
}

const webClick = (browser: Browser, url: string, control: Control) =>
	webAct(browser, url, (page) => page.mouse.click(control.x, control.y))

/** Clicks at a control, then waits for the page to settle; a click that navigates waits for the new page. */
const clickAndSettle = async (page: Page, control: Control) => {
	const before = page.url()
	await page.mouse.click(control.x, control.y)
	await sleep(300)
	if (page.url() !== before) {
		await page.waitForFunction(() => (document.body.innerText ?? "").length > 40, null, {
			timeout: 15_000,
		})
		await waitQuiet(page, 900)
	} else await waitQuiet(page, 600)
}

/** Clicks into `field`, types, and presses Return. */
const webType = (browser: Browser, url: string, field: Control) =>
	webAct(browser, url, async (page) => {
		await page.mouse.click(field.x, field.y)
		await sleep(200)
		await page.keyboard.type(TYPED, { delay: 20 })
		await sleep(200)
		await page.keyboard.press("Enter")
	})

/** Clicks `controls` in turn, each once the page has settled from the one before. */
const webClicks = (browser: Browser, url: string, controls: ReadonlyArray<Control>) =>
	webAct(browser, url, async (page) => {
		for (const [i, control] of controls.entries()) {
			if (i < controls.length - 1) await clickAndSettle(page, control)
			else await page.mouse.click(control.x, control.y)
		}
	})

/** Clicks `opener` and returns what shows then, and the controls that were not there before. */
const webOpen = async (browser: Browser, url: string, opener: Control, before: ReadonlyArray<Control>) => {
	const { page, context } = await openPage(browser, url)
	await clickAndSettle(page, opener)
	const texts = await page.evaluate(visibleTexts)
	const known = new Set(before.map((c) => `${c.label}@${c.x},${c.y}`))
	const opened = (await page.evaluate(findControls)).filter((c) => !known.has(`${c.label}@${c.x},${c.y}`))
	await context.close()
	return { texts, opened: opened.slice(0, maxOpened) }
}

/** Points at a control and waits out a tooltip's delay. */
const webHover = (browser: Browser, url: string, control: Control) =>
	webAct(browser, url, async (page) => {
		await page.mouse.move(control.x, control.y)
		await sleep(900)
	})

/** Runs in the page: what has focus, as a label and the centre of its box. */
const focusedControl = () => {
	const el = document.activeElement
	if (el === null || el === document.body) return null
	const box = el.getBoundingClientRect()
	const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").replaceAll(/\s+/g, " ").trim()
	return {
		label: label.slice(0, 50),
		x: Math.round(box.left + box.width / 2),
		y: Math.round(box.top + box.height / 2),
	}
}

const webTabs = async (browser: Browser, url: string) => {
	const { page, context } = await openPage(browser, url)
	const order: Array<{ label: string; x: number; y: number } | null> = []
	for (let i = 0; i < TABS; i++) {
		await page.keyboard.press("Tab")
		await sleep(60)
		order.push(await page.evaluate(focusedControl))
	}
	await context.close()
	return order
}

const webAct = async (
	browser: Browser,
	url: string,
	act: (page: Page) => Promise<void>,
): Promise<Outcome> => {
	const { page, context, errors } = await openPage(browser, url)
	await act(page)
	// A link may load a page: give it a moment, then wait for content and for the DOM to settle.
	await sleep(300)
	await page.waitForFunction(() => (document.body.innerText ?? "").length > 40, null, { timeout: 15_000 })
	await waitQuiet(page, 700)
	const texts = await page.evaluate(visibleTexts)
	await context.close()
	return { texts, errors }
}

// NATIVE

type NativeElement = {
	text: string
	rect: { x: number; y: number; w: number; h: number; opacity: number } | null
}
type NativeFocus = { label: string | null; text: string; rect: [number, number, number, number] }

const nativeRun = (route: string, steps: ReadonlyArray<Record<string, unknown>>, name: string) =>
	new Promise<Outcome & { focused: Map<string, NativeFocus | null> }>((done) => {
		const script = join(outDir, "scripts", `${name}.json`)
		const layout = join(outDir, "scripts", `${name}.layout.json`)
		writeFileSync(
			script,
			JSON.stringify([{ settle: 2500 }, { wait: 300 }, ...steps, { exportLayout: layout }]),
		)
		const child = spawn(host, ["--capture", script], {
			cwd: appDir,
			env: {
				...process.env,
				HAZEL_NATIVE_ENTRY: "dist/entry.js",
				NATIVE_THEME: "dark",
				NATIVE_PATH: route,
			},
		})
		let stderr = ""
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString()
		})
		const timer = setTimeout(() => child.kill(), 90_000)
		child.on("close", () => {
			clearTimeout(timer)
			const errors = stderr
				.split("\n")
				.filter((l) =>
					/^\[uncaught |^(TypeError|ReferenceError|RangeError|SyntaxError): |^\[capture\] .*(not found|fail)/.test(
						l,
					),
				)
			const focused = new Map<string, NativeFocus | null>()
			for (const line of stderr.split("\n")) {
				const probe = /^\[probe (.+?)\] (\{.*)$/.exec(line)
				if (!probe?.[1] || !probe[2]) continue
				// SAFETY: the host's probe step prints this shape (apps/native/host/src/capture.rs).
				const parsed = JSON.parse(probe[2]) as { focused: Array<NativeFocus> }
				focused.set(probe[1], parsed.focused[0] ?? null)
			}
			if (!existsSync(layout))
				return done({ texts: [], errors: [...errors, "native run produced no layout"], focused })
			// SAFETY: the host's exportLayout step writes this shape (apps/native/host/src/capture.rs).
			const elements = (JSON.parse(readFileSync(layout, "utf8")) as { elements: Array<NativeElement> })
				.elements
			const texts = new Set<string>()
			for (const e of elements) {
				const text = normalize(e.text)
				const r = e.rect
				// Below 1% opacity draws nothing: the host's mark on a screen-reader-only control.
				if (text === "" || r === null || r.opacity < 0.01 || r.w <= 0 || r.h <= 0) continue
				if (r.x + r.w <= 0 || r.y + r.h <= 0 || r.x >= VIEWPORT.width || r.y >= VIEWPORT.height)
					continue
				texts.add(text)
			}
			done({ texts: [...texts], errors, focused })
		})
	})

/** Runs `tasks` with at most `limit` at a time. */
const pool = async <A>(tasks: ReadonlyArray<() => Promise<A>>, limit: number): Promise<Array<A>> => {
	const results: Array<A> = []
	let next = 0
	const worker = async () => {
		while (next < tasks.length) {
			const at = next++
			const task = tasks[at]
			if (task) results[at] = await task()
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
	return results
}

// COMPARE

const without = (after: ReadonlyArray<string>, before: ReadonlyArray<string>) => {
	const base = new Set(before)
	return after.filter((t) => !base.has(t))
}

/** How much two sets of texts agree, 1 when both are empty. */
const overlap = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) => {
	if (a.length === 0 && b.length === 0) return 1
	const right = new Set(b)
	const shared = a.filter((t) => right.has(t)).length
	return shared / new Set([...a, ...b]).size
}

type Finding = { route: string; control?: string; kind: string; detail: string }

/** Flags how an action's outcome differs between the sides, each against its own state before. */
const judge = (
	flag: (kind: string, detail: string) => void,
	webBefore: ReadonlyArray<string>,
	nativeBefore: ReadonlyArray<string>,
	webOutcome: Outcome | undefined,
	nativeOutcome: Outcome | undefined,
) => {
	const w = comparable(webOutcome?.texts ?? [])
	const n = comparable(nativeOutcome?.texts ?? [])
	for (const error of nativeOutcome?.errors ?? []) flag("native error", error)
	const webDelta = without(w, webBefore)
	const nativeDelta = without(n, nativeBefore)
	const webGone = without(webBefore, w)
	const nativeGone = without(nativeBefore, n)
	const webChanged = webDelta.length > 0 || webGone.length > 0
	const nativeChanged = nativeDelta.length > 0 || nativeGone.length > 0
	if (webChanged && !nativeChanged)
		flag(
			"does nothing natively",
			`web shows: ${webDelta.slice(0, 8).join(" | ") || `(removes ${webGone.slice(0, 5).join(" | ")})`}`,
		)
	else if (!webChanged && nativeChanged)
		flag("does something only natively", `native shows: ${nativeDelta.slice(0, 8).join(" | ")}`)
	else if (webChanged && overlap(webDelta, nativeDelta) < 0.5 && overlap(webGone, nativeGone) < 0.5)
		flag(
			"shows something else natively",
			`web: ${webDelta.slice(0, 6).join(" | ")} || native: ${nativeDelta.slice(0, 6).join(" | ")}`,
		)
}

// MAIN

mkdirSync(join(outDir, "scripts"), { recursive: true })
if (!args.includes("--skip-build")) {
	spawnSync("bun", ["run", "build"], { cwd: appDir, stdio: "inherit" })
	spawnSync("cargo", ["build", "--release"], { cwd: join(appDir, "host"), stdio: "inherit" })
	spawnSync("./node_modules/.bin/vite", ["build", "--config", "../native/bench/web/vite.config.ts"], {
		cwd: webDir,
		stdio: "inherit",
	})
}

const { server, origin } = await startServer()
const browser = await chromium.launch()
const findings: Array<Finding> = []
const summary: Array<{ route: string; controls: number; flagged: number; contentMatch: number }> = []

for (const route of ROUTES.filter((r) => routeFilter === undefined || r.includes(routeFilter))) {
	const url = `${origin}${route}`
	const slug = route.replaceAll(/\W+/g, "-").slice(1, 50)
	console.log(`route ${route}`)
	const web = await webRoute(browser, url)
	const native = await nativeRun(route, [], `${slug}-base`)
	for (const error of [...web.errors.map((e) => `web: ${e}`), ...native.errors.map((e) => `native: ${e}`)])
		findings.push({ route, kind: "error on load", detail: error })
	web.texts = comparable(web.texts)
	native.texts = comparable(native.texts)
	const missing = without(web.texts, native.texts)
	const extra = without(native.texts, web.texts)
	if (missing.length > 0)
		findings.push({ route, kind: "missing natively", detail: missing.slice(0, 15).join(" | ") })
	if (extra.length > 0)
		findings.push({ route, kind: "extra natively", detail: extra.slice(0, 15).join(" | ") })
	const contentMatch = overlap(web.texts, native.texts)

	console.log(`  ${web.controls.length} controls`)
	let flagged = 0
	const flagFor = (control: Control, phase: string) => (kind: string, detail: string) => {
		flagged++
		findings.push({
			route,
			control: `${phase}: ${control.label} (${control.role} at ${control.x},${control.y})`,
			kind,
			detail,
		})
	}

	/** Each control acted on from a fresh load, both sides, and what each showed afterwards. */
	const comparePhase = async (
		phase: string,
		webAction: (control: Control) => Promise<Outcome>,
		nativeSteps: (control: Control) => ReadonlyArray<Record<string, unknown>>,
	) => {
		const webOutcomes = await pool(
			web.controls.map((control) => () => webAction(control)),
			jobs,
		)
		const nativeOutcomes = await pool(
			web.controls.map(
				(control, i) => () => nativeRun(route, nativeSteps(control), `${slug}-${phase}-${i}`),
			),
			jobs,
		)
		web.controls.forEach((control, i) => {
			judge(flagFor(control, phase), web.texts, native.texts, webOutcomes[i], nativeOutcomes[i])
		})
	}

	if (phases.has("click"))
		await comparePhase(
			"click",
			(control) => webClick(browser, url, control),
			(control) => [{ clickAt: [control.x, control.y] }, { settle: 600 }, { wait: 300 }],
		)
	if (phases.has("hover"))
		await comparePhase(
			"hover",
			(control) => webHover(browser, url, control),
			(control) => [{ move: [control.x, control.y] }, { wait: 900 }, { settle: 300 }],
		)
	if (phases.has("open")) {
		// Which controls open something, and what each opens (web), then that state natively.
		const openings = (
			await pool(
				web.controls.map((opener) => () => webOpen(browser, url, opener, web.controls)),
				jobs,
			)
		)
			.map((o, i) => ({ ...o, opener: web.controls[i] }))
			.filter(
				(o): o is typeof o & { opener: Control } =>
					o.opener !== undefined && o.opened.length > 0 && !RANDOM_OPENERS.has(o.opener.label),
			)
			.slice(0, maxOpeners)
		const openStep = (c: Control) => [{ clickAt: [c.x, c.y] }, { settle: 600 }, { wait: 300 }]
		const nativeOpened = await pool(
			openings.map((o, i) => () => nativeRun(route, openStep(o.opener), `${slug}-opener-${i}`)),
			jobs,
		)
		const pairs = openings.flatMap((o, i) => o.opened.map((item) => ({ o, i, item })))
		console.log(`  ${openings.length} openers, ${pairs.length} opened controls`)
		const webOutcomes = await pool(
			pairs.map(
				({ o, item }) =>
					() =>
						webClicks(browser, url, [o.opener, item]),
			),
			jobs,
		)
		const nativeOutcomes = await pool(
			pairs.map(
				({ o, item }, k) =>
					() =>
						nativeRun(route, [...openStep(o.opener), ...openStep(item)], `${slug}-open-${k}`),
			),
			jobs,
		)
		pairs.forEach(({ o, i, item }, k) => {
			const flag = (kind: string, detail: string) => {
				flagged++
				findings.push({
					route,
					control: `open: ${o.opener.label} > ${item.label} (${item.role} at ${item.x},${item.y})`,
					kind,
					detail,
				})
			}
			judge(
				flag,
				comparable(o.texts),
				comparable(nativeOpened[i]?.texts ?? []),
				webOutcomes[k],
				nativeOutcomes[k],
			)
		})
	}
	if (phases.has("type")) {
		const { page, context } = await openPage(browser, url)
		const fields = await page.evaluate(findFields)
		await context.close()
		console.log(`  ${fields.length} fields`)
		const webOutcomes = await pool(
			fields.map((field) => () => webType(browser, url, field)),
			jobs,
		)
		const nativeOutcomes = await pool(
			fields.map(
				(field, i) => () =>
					nativeRun(
						route,
						[
							{ clickAt: [field.x, field.y] },
							{ settle: 300 },
							{ type: TYPED },
							{ key: "Enter" },
							{ settle: 600 },
							{ wait: 300 },
						],
						`${slug}-type-${i}`,
					),
			),
			jobs,
		)
		// A field's own value is text natively and a value on the web: compare what typing did
		// elsewhere, so the typed words count only where they show up outside the field.
		const typedOnly = (o: Outcome | undefined) =>
			o && { ...o, texts: o.texts.filter((t) => normalize(t) !== TYPED) }
		fields.forEach((field, i) =>
			judge(
				flagFor(field, "type"),
				web.texts,
				native.texts,
				typedOnly(webOutcomes[i]),
				typedOnly(nativeOutcomes[i]),
			),
		)
	}
	if (phases.has("tab")) {
		const webOrder = await webTabs(browser, url)
		const steps = webOrder.flatMap((_, i) => [{ tab: 1 }, { wait: 60 }, { probe: { label: `tab ${i}` } }])
		const nativeOrder = await nativeRun(route, steps, `${slug}-tab`)
		// The first step where the two sides focus different controls: the rest follows from it.
		// Past the last control the web's focus leaves for the browser's own UI; a window wraps.
		const end = webOrder.indexOf(null)
		const compared = end === -1 ? webOrder : webOrder.slice(0, end)
		const at = compared.findIndex((w, i) => {
			const n = nativeOrder.focused.get(`tab ${i}`) ?? null
			if (w === null || n === null) return (w === null) !== (n === null)
			// The same named control (a visually hidden radio sits where its box puts it), or one
			// at the same place.
			const named = w.label !== "" && (n.label ?? n.text) === w.label
			const [x, y, width, height] = n.rect
			const near = Math.abs(x + width / 2 - w.x) <= 12 && Math.abs(y + height / 2 - w.y) <= 12
			return !named && !near
		})
		if (at !== -1) {
			const w = webOrder[at]
			const n = nativeOrder.focused.get(`tab ${at}`) ?? null
			const describe = (label: string | null | undefined, x: number, y: number) =>
				`"${label ?? ""}" at ${x},${y}`
			findings.push({
				route,
				kind: "tab order differs",
				detail: `Tab ${at + 1}: web ${w ? describe(w.label, w.x, w.y) : "nothing"}, native ${
					n
						? describe(
								n.label ?? n.text,
								Math.round(n.rect[0] + n.rect[2] / 2),
								Math.round(n.rect[1] + n.rect[3] / 2),
							)
						: "nothing"
				}`,
			})
			flagged++
		}
	}
	summary.push({ route, controls: web.controls.length, flagged, contentMatch })
}

await browser.close()
server.close()

const byKind = new Map<string, number>()
for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1)
const report = [
	"# Parity crawl",
	"",
	`${findings.length} findings: ${[...byKind].map(([k, n]) => `${n} ${k}`).join(", ") || "none"}.`,
	"",
	"| route | controls | flagged | content match |",
	"| --- | --- | --- | --- |",
	...summary.map(
		(s) => `| ${s.route} | ${s.controls} | ${s.flagged} | ${Math.round(s.contentMatch * 100)}% |`,
	),
	"",
	"## Findings",
	"",
	...findings.map((f) => `- **${f.kind}** ${f.route}${f.control ? ` / ${f.control}` : ""}: ${f.detail}`),
].join("\n")
writeFileSync(join(outDir, "report.md"), report)
writeFileSync(join(outDir, "report.json"), JSON.stringify({ summary, findings }, null, 2))
console.log(`\n${findings.length} findings (${[...byKind].map(([k, n]) => `${n} ${k}`).join(", ")})`)
console.log(`report: ${join(outDir, "report.md")}`)
process.exit(findings.length > 0 ? 1 : 0)
