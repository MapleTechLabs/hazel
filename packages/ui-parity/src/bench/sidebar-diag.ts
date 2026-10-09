import { chromium } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import {
	buildDir,
	FIXTURE_BACKEND_PORT,
	FIXTURE_ELECTRIC_PORT,
	fixtureBackendUrl,
	fixtureElectricUrl,
	targets,
	type TargetName,
} from "../config.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"

/**
 * Hit-test probe for the heavy workspace: counts the sidebar elements that get their own paint layer
 * and times `elementFromPoint` over the #firehose message list, optionally with CSS experiments.
 *
 *   PARITY_PORT_BASE=8300 bun run src/bench/sidebar-diag.ts [foldkit|legacy] ['name=css' ...]
 */

const heavy = datasets.get("heavy")!
const target: TargetName = Bun.argv[2] === "legacy" ? "legacy" : "foldkit"
const experiments: ReadonlyArray<readonly [string, string]> = [
	["baseline", ""],
	["no sidebar", "[data-slot=sidebar-content]{display:none!important}"],
	...Bun.argv.slice(3).map((arg): readonly [string, string] => {
		const [name = arg, ...css] = arg.split("=")
		return [name, css.join("=")]
	}),
]

const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: "heavy",
})
const server = serveStatic(buildDir(target), targets[target].port, clerkIdentityFor(heavy))
const browser = await chromium.launch({ ...BROWSER_LAUNCH_OPTIONS })
const context = await browser.newContext({
	viewport: { width: 1440, height: 900 },
	deviceScaleFactor: 1,
	serviceWorkers: "block",
})
const page = await context.newPage()
await page.addInitScript((identity) => {
	;(window as unknown as { __parityClerkIdentity: unknown }).__parityClerkIdentity = identity
}, clerkIdentityFor(heavy))
for (const origin of [fixtureBackendUrl, new URL(fixtureElectricUrl).origin])
	await page.route(`${origin}/**`, (route) =>
		route.continue({ headers: { ...route.request().headers(), "x-parity-dataset": "heavy" } }),
	)
const firehose = String(heavy.tables.channels!.find((row) => row.name === "firehose")!.id)
await page.goto(`http://localhost:${targets[target].port}/hazel/chat/${firehose}`)
await page.waitForSelector("[data-id]", { timeout: 30_000 })
await page.waitForTimeout(3000)

const layers = await page.evaluate(() => {
	const sidebar = document.querySelector("[role=treegrid]")?.closest("[data-slot=sidebar-content]")
	const reasons: Record<string, number> = {}
	for (const element of sidebar ? Array.from(sidebar.querySelectorAll("*")) : []) {
		const style = getComputedStyle(element)
		const why = [
			style.position !== "static" && style.position,
			Number(style.opacity) < 1 && "opacity",
			style.transform !== "none" && "transform",
			style.willChange !== "auto" && "will-change",
			style.isolation === "isolate" && "isolate",
			style.contain !== "none" && "contain",
		].filter(Boolean)
		if (why.length === 0) continue
		const slot = element.getAttribute("data-slot") ?? element.getAttribute("slot") ?? ""
		const key = `${why.join("+")} <${element.tagName.toLowerCase()} ${slot}>`
		reasons[key] = (reasons[key] ?? 0) + 1
	}
	return reasons
})
console.log("sidebar layer-creating elements:", layers)

const box = await page.locator("[data-id]").last().boundingBox()
const point = { x: (box?.x ?? 800) + 100, y: (box?.y ?? 500) - 50 }
const msPerHit = () =>
	page.evaluate(({ x, y }) => {
		const start = performance.now()
		for (let i = 0; i < 2000; i++) document.elementFromPoint(x + (i % 7), y + (i % 5))
		return (performance.now() - start) / 2000
	}, point)

for (const [name, css] of experiments) {
	await page.evaluate((css) => {
		document.getElementById("sidebar-diag")?.remove()
		const style = document.createElement("style")
		style.id = "sidebar-diag"
		style.textContent = css
		document.head.append(style)
	}, css)
	await page.waitForTimeout(300)
	await msPerHit()
	const runs = [await msPerHit(), await msPerHit(), await msPerHit()]
	console.log(name.padEnd(16), runs.map((ms) => ms.toFixed(3)).join(" "), "ms per hit test")
}

await browser.close()
server.stop()
await backend.stop()
process.exit(0)
