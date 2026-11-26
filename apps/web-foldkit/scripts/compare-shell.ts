import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { CHANNEL_TOLERANCE, diffInPage } from "../../../packages/ui/scripts/shoot.ts"

/**
 * `bun apps/web-foldkit/scripts/compare-shell.ts --before <web root> [--after <web root>] [--out <dir>] [--only <id>]`:
 * the app's frame before and after the Effect UI shell (phase 4). Serves each offline build
 * (`bun run --cwd apps/ios-hybrid build:web:offline`, `apps/ios-hybrid/build/web` by default for
 * `--after`) with an `index.html` fallback, opens each screen at 390 and 1180 wide in both themes,
 * and writes `<out>/<screen>/<theme>-<width>.png` strips (before | after | diff) and the share of
 * pixels that differ. With `--after` only, it shoots one build and prints its console errors.
 */

const repo = resolve(import.meta.dirname, "../../..")
const FIXED_NOW = new Date("2026-11-26T15:00:00Z")

interface Screen {
	readonly id: string
	/** The route opened after the app lands in the chat. */
	readonly href: (orgSlug: string) => string | null
}

/** The org slug is read from the chat URL the app lands on; channel ids from the sidebar's links. */
const screens: ReadonlyArray<Screen> = [
	{ id: "chat-index", href: (orgSlug) => `/${orgSlug}/chat` },
	{ id: "channel", href: () => null },
	{ id: "settings", href: (orgSlug) => `/${orgSlug}/settings` },
	{ id: "customers", href: (orgSlug) => `/${orgSlug}/customers` },
]

const widths = [390, 1180] as const
const themes = ["light", "dark"] as const

const argument = (name: string) => {
	const index = process.argv.indexOf(name)
	return index === -1 ? undefined : process.argv[index + 1]
}

const types: Record<string, string> = {
	html: "text/html",
	js: "text/javascript",
	css: "text/css",
	json: "application/json",
	svg: "image/svg+xml",
	png: "image/png",
	webp: "image/webp",
	woff2: "font/woff2",
}

const isFile = (path: string) => {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

const serve = (root: string): Promise<Server> =>
	new Promise((ready) => {
		const server = createServer((request, response) => {
			const path = new URL(request.url ?? "/", "http://localhost").pathname
			const file = path !== "/" && isFile(resolve(root, `.${path}`)) ? resolve(root, `.${path}`) : resolve(root, "index.html")
			response.writeHead(200, {
				"content-type": Object.entries(types).find(([extension]) => file.endsWith(`.${extension}`))?.[1] ?? "application/octet-stream",
			})
			response.end(readFileSync(file))
		})
		server.listen(0, () => ready(server))
	})

const settle = async (page: Page) => {
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" })
	await page.waitForTimeout(1500)
}

/** Opens `href` the way a user would: its link when one is on screen, else a history push. */
const openRoute = async (page: Page, href: string) => {
	if (new URL(page.url()).pathname === href) return
	const link = page.locator(`a[href="${href}"]`).first()
	if ((await link.count()) > 0 && (await link.isVisible())) await link.click()
	else
		await page.evaluate((target) => {
			history.pushState(null, "", target)
			dispatchEvent(new PopStateEvent("popstate"))
		}, href)
	await page.waitForURL((url) => url.pathname === href, { timeout: 10_000 })
}

const shoot = async (
	browser: Browser,
	base: string,
	screen: Screen,
	width: number,
	theme: string,
	errors: Array<string>,
): Promise<Buffer> => {
	const context = await browser.newContext({
		viewport: { width, height: 844 },
		deviceScaleFactor: 2,
		reducedMotion: "reduce",
		colorScheme: theme === "dark" ? "dark" : "light",
	})
	// The phase 3 flags, read by the build before the shell (the islands it compares against).
	await context.addInitScript((value) => {
		localStorage.setItem("hazel-ui-theme", JSON.stringify(value))
		for (const flag of ["channel-list", "dms", "activity", "channel"]) localStorage.setItem(`hazel:island:${flag}`, "1")
	}, theme)
	const page = await context.newPage()
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(`${screen.id} ${theme}-${width}: ${message.text()}`)
	})
	page.on("pageerror", (error) => errors.push(`${screen.id} ${theme}-${width}: ${error.message}`))
	await page.clock.install({ time: FIXED_NOW })
	await page.clock.resume()
	try {
		await page.goto(base)
		await page.waitForURL(/\/[^/]+\/chat/, { timeout: 30_000 })
		await settle(page)
		const orgSlug = new URL(page.url()).pathname.split("/")[1] ?? "hazel"
		const href =
			screen.href(orgSlug) ??
			(await page
				.locator(`a[href^="/${orgSlug}/chat/"]`)
				.first()
				.getAttribute("href")
				.catch(() => null))
		if (href !== null) await openRoute(page, href)
		await settle(page)
		await page.mouse.move(-10, -10)
		return await page.screenshot({ animations: "disabled", caret: "hide" })
	} finally {
		await context.close()
	}
}

/** Before | after | diff, side by side, with the share of differing pixels. */
const strip = async (page: Page, before: Buffer, after: Buffer) => {
	const diff = await diffInPage(page, before, after, CHANNEL_TOLERANCE)
	return { png: Buffer.from(diff.diffPng, "base64"), ratio: diff.differing / (diff.width * diff.height) }
}

const main = async () => {
	const beforeRoot = argument("--before")
	const afterRoot = resolve(repo, argument("--after") ?? "apps/ios-hybrid/build/web")
	const out = resolve(repo, argument("--out") ?? "docs/hazel-ui-screens/phase4/shell")
	const only = argument("--only")
	const browser = await chromium.launch()
	const servers = await Promise.all([serve(afterRoot), ...(beforeRoot === undefined ? [] : [serve(resolve(repo, beforeRoot))])])
	const [afterBase, beforeBase] = servers.map((server) => `http://localhost:${(server.address() as AddressInfo).port}/`)
	const errors: Array<string> = []
	const tool = await (await browser.newContext()).newPage()
	try {
		for (const screen of screens.filter((candidate) => only === undefined || candidate.id === only))
			for (const theme of themes)
				for (const width of widths) {
					const after = await shoot(browser, afterBase!, screen, width, theme, errors)
					mkdirSync(resolve(out, screen.id), { recursive: true })
					writeFileSync(resolve(out, screen.id, `${theme}-${width}-after.png`), after)
					if (beforeBase === undefined) {
						console.log(`${screen.id} ${theme}-${width}: shot`)
						continue
					}
					const before = await shoot(browser, beforeBase, screen, width, theme, [])
					writeFileSync(resolve(out, screen.id, `${theme}-${width}-before.png`), before)
					const result = await strip(tool, before, after)
					writeFileSync(resolve(out, screen.id, `${theme}-${width}-diff.png`), result.png)
					console.log(`${screen.id} ${theme}-${width}: ${(result.ratio * 100).toFixed(3)}% of pixels differ`)
				}
	} finally {
		for (const error of errors) console.log(`console: ${error}`)
		await browser.close()
		for (const server of servers) server.close()
	}
}

await main()
