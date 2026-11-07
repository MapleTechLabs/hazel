/**
 * Records what Chromium computes for every element of Hazel's web app (and a synthetic utility
 * page), as golden fixtures for `src/conformance.test.ts`.
 * `bun packages/foldkit-rune/conformance/extract.ts` writes `conformance/fixtures/*.jsonl`.
 * The app comes from the prebuilt offline bench bundle (`apps/native/bench/web/dist`), never rebuilt.
 */
import { compile } from "@tailwindcss/node"
import { Scanner } from "@tailwindcss/oxide"
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { chromium, type Page } from "playwright"

import { syntheticClasses, syntheticHtml } from "./synthetic"

const here = import.meta.dirname
const distDir = resolve(here, "../../../apps/native/bench/web/dist")
const stylesheet = resolve(here, "../../../apps/web-foldkit/src/styles.css")
const fixturesDir = join(here, "fixtures")
const VIEWPORT = { width: 1280, height: 800 }
/** A #general message near the bottom of the channel: the app has loaded its messages. */
const CONTENT_TEXT = "Shipping it. Thanks everyone"
const QUIET_MS = 1500

/** Properties read with `getComputedStyle` (resolved values). */
export const COMPUTED = [
	"display",
	"flex-direction",
	"flex-wrap",
	"row-gap",
	"column-gap",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"flex-grow",
	"flex-shrink",
	"align-items",
	"justify-content",
	"align-self",
	"background-color",
	"background-image",
	"color",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-top-left-radius",
	"border-top-right-radius",
	"border-bottom-right-radius",
	"border-bottom-left-radius",
	"font-size",
	"font-weight",
	"line-height",
	"letter-spacing",
	"font-family",
	"font-style",
	"text-transform",
	"text-decoration-line",
	"text-align",
	"white-space",
	"opacity",
	"overflow-x",
	"overflow-y",
	"position",
	"box-shadow",
	"outline-width",
	"outline-color",
	"outline-offset",
	"outline-style",
	"object-fit",
	"aspect-ratio",
	"visibility",
	"z-index",
	"text-overflow",
	"clip-path",
	"translate",
]

/**
 * Properties read from the typed OM (`computedStyleMap`): computed, not used, values, so `auto`
 * margins stay `auto`, a percentage stays a percentage and a width that only comes from layout
 * reads `auto`. That is what "the element sets its width explicitly" means in the test.
 */
export const TYPED = [
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"width",
	"height",
	"min-width",
	"min-height",
	"max-width",
	"max-height",
	"top",
	"right",
	"bottom",
	"left",
]

export type RecordedElement = {
	/** Parent's index, -1 for a root. */
	p: number
	/** Previous element sibling's index, -1 when none. */
	prev: number
	tag: string
	cls: Array<string>
	attrs: Record<string, string>
	style?: string
	/** 1 when the element has a text node child (it is not `:empty`). */
	text?: 1
	/** Computed values that differ from the fixture's `defaults`. */
	cs: Record<string, string>
}

export type Fixture = {
	name: string
	dark: boolean
	viewport: [number, number]
	/** `<html>`'s classes and inline style (the theme's runtime custom properties). */
	html: { cls: string; style: string }
	/** The most common value of each property: an element's `cs` lists only the others. */
	defaults: Record<string, string>
	elements: Array<RecordedElement>
}

/** Runs in the page: every element under `#app` in document order, `svg` internals and editor DOM left out. */
const capture = ({ computed, typed }: { computed: Array<string>; typed: Array<string> }) => {
	const app = document.getElementById("app")
	if (app === null) throw new Error("no #app")
	const skip = (el: Element) =>
		["STYLE", "SCRIPT", "TEMPLATE", "NOSCRIPT", "LINK", "META"].includes(el.tagName) ||
		el.closest("[contenteditable]") !== null ||
		(el.parentElement?.closest("svg") ?? null) !== null
	const index = new Map<Element, number>()
	const out: Array<{
		p: number
		prev: number
		tag: string
		cls: Array<string>
		attrs: Record<string, string>
		style?: string
		text?: 1
		cs: Record<string, string>
	}> = []
	const walk = (el: Element) => {
		for (const child of el.children) {
			if (skip(child)) continue
			index.set(child, out.length)
			const attrs: Record<string, string> = {}
			for (const attr of child.attributes) {
				const n = attr.name
				const kept =
					n.startsWith("data-") ||
					(n.startsWith("aria-") && n !== "aria-label") ||
					["role", "id", "type", "slot", "href", "src", "open", "disabled", "hidden"].includes(n)
				if (kept) attrs[n] = attr.value
				else if (n === "aria-label") attrs[n] = ""
			}
			let prev = child.previousElementSibling
			const cs = getComputedStyle(child)
			const values: Record<string, string> = {}
			for (const name of computed) values[name] = cs.getPropertyValue(name)
			const map = child.computedStyleMap()
			for (const name of typed) values[`@${name}`] = String(map.get(name) ?? "")
			const parentIndex = el === app ? -1 : (index.get(el) ?? -1)
			while (prev !== null && !index.has(prev)) prev = prev.previousElementSibling
			const record: (typeof out)[number] = {
				p: parentIndex,
				prev: prev === null ? -1 : (index.get(prev) ?? -1),
				tag: child.tagName.toLowerCase(),
				cls: [...child.classList],
				attrs,
				cs: values,
			}
			const style = child.getAttribute("style")
			if (style !== null) record.style = style
			if (
				[...child.childNodes].some(
					(n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "") !== "",
				)
			)
				record.text = 1
			out.push(record)
			walk(child)
		}
	}
	walk(app)
	return {
		html: {
			cls: document.documentElement.className,
			style: document.documentElement.getAttribute("style") ?? "",
		},
		elements: out,
	}
}

const compress = (name: string, dark: boolean, raw: Awaited<ReturnType<typeof captureIn>>): Fixture => {
	const counts = new Map<string, Map<string, number>>()
	for (const el of raw.elements)
		for (const [prop, value] of Object.entries(el.cs)) {
			const perProp = counts.get(prop) ?? new Map<string, number>()
			perProp.set(value, (perProp.get(value) ?? 0) + 1)
			counts.set(prop, perProp)
		}
	const defaults: Record<string, string> = {}
	for (const prop of [...counts.keys()].sort()) {
		const entries = [...(counts.get(prop) ?? new Map<string, number>())].sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
		)
		defaults[prop] = entries[0]?.[0] ?? ""
	}
	const elements = raw.elements.map((el) => {
		const cs: Record<string, string> = {}
		for (const prop of Object.keys(el.cs).sort())
			if (el.cs[prop] !== defaults[prop]) cs[prop] = el.cs[prop] ?? ""
		return { ...el, cs }
	})
	return { name, dark, viewport: [VIEWPORT.width, VIEWPORT.height], html: raw.html, defaults, elements }
}

/** The page's origin carries the server's random port: fixtures name it `http://page.test`. */
export const PAGE_ORIGIN = "http://page.test"

const captureIn = async (page: Page) => {
	const raw = await page.evaluate(capture, { computed: COMPUTED, typed: TYPED })
	const origin = new URL(page.url()).origin
	for (const el of raw.elements)
		for (const prop in el.cs) el.cs[prop] = (el.cs[prop] ?? "").replaceAll(origin, PAGE_ORIGIN)
	return raw
}

/** Resolves once the DOM has gone `QUIET_MS` without a mutation. */
const settle = async (page: Page) => {
	await page.evaluate((quiet) => {
		return new Promise<void>((done) => {
			let timer = setTimeout(done, quiet)
			new MutationObserver(() => {
				clearTimeout(timer)
				timer = setTimeout(done, quiet)
			}).observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
		})
	}, QUIET_MS)
}

/** JSON Lines: the header (everything but the elements), then one element per line. */
const write = (fixture: Fixture) => {
	mkdirSync(fixturesDir, { recursive: true })
	const path = join(fixturesDir, `${fixture.name}.jsonl`)
	const { elements, ...header } = fixture
	const text = `${[header, ...elements].map((line) => JSON.stringify(line)).join("\n")}\n`
	writeFileSync(path, text)
	console.log(`${path}: ${elements.length} elements, ${(text.length / 1024).toFixed(0)} KiB`)
}

const mimeTypes = new Map([
	[".html", "text/html"],
	[".js", "text/javascript"],
	[".css", "text/css"],
	[".wasm", "application/wasm"],
	[".svg", "image/svg+xml"],
	[".png", "image/png"],
	[".woff2", "font/woff2"],
	[".json", "application/json"],
])

/** The bench bundle, plus `/__synthetic/{light,dark}.html` for the utility page. */
const serve = async (synthetic: { light: string; dark: string }) => {
	const server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://bench").pathname
		const page =
			path === "/__synthetic/light.html"
				? synthetic.light
				: path === "/__synthetic/dark.html"
					? synthetic.dark
					: null
		if (page !== null) {
			response.writeHead(200, { "content-type": "text/html" })
			response.end(page)
			return
		}
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
	return { server, url: `http://127.0.0.1:${address.port}` }
}

/** Hazel's stylesheet compiled for the synthetic page's classes plus everything its sources use. */
const syntheticCss = async () => {
	const css = readFileSync(stylesheet, "utf8")
	const base = stylesheet.slice(0, stylesheet.lastIndexOf("/") + 1)
	const compiler = await compile(css, { base, from: stylesheet, onDependency() {} })
	const sources = [...compiler.sources]
	if (compiler.root !== null && compiler.root !== "none") sources.push({ ...compiler.root, negated: false })
	const scanned = sources.length > 0 ? new Scanner({ sources }).scan() : []
	return compiler.build([...scanned, ...syntheticClasses()])
}

if (!existsSync(join(distDir, "index.html")))
	throw new Error(`${distDir} is not built: run apps/native/bench/web/run.ts once`)
const css = await syntheticCss()
const { server, url } = await serve({ light: syntheticHtml(css, false), dark: syntheticHtml(css, true) })
const browser = await chromium.launch()
try {
	for (const dark of [false, true]) {
		const context = await browser.newContext({
			viewport: VIEWPORT,
			colorScheme: dark ? "dark" : "light",
			locale: "en-US",
			timezoneId: "UTC",
		})
		const page = await context.newPage()
		await page.goto(`${url}/`)
		await page.waitForFunction(
			(text) => document.body.textContent?.includes(text) ?? false,
			CONTENT_TEXT,
			{
				timeout: 30_000,
			},
		)
		await settle(page)
		write(compress(dark ? "app-dark" : "app-light", dark, await captureIn(page)))
		await page.goto(`${url}/__synthetic/${dark ? "dark" : "light"}.html`)
		await page.evaluate(() => document.fonts.ready)
		write(compress(dark ? "synthetic-dark" : "synthetic-light", dark, await captureIn(page)))
		await context.close()
	}
} finally {
	await browser.close()
	server.close()
}
