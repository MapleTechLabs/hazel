/**
 * Builds the browser demo and screenshots it in Playwright's Chromium (G1 evidence):
 * `bun src/demo/shoot.ts` writes `src/demo/__shots__/channel-list-web.png` and prints what it checked.
 */
import { chromium } from "playwright"

// Run with Bun; the package has no `@types/bun`, so the one call is declared here.
declare const Bun: {
	build: (options: { entrypoints: Array<string>; target: "browser"; format: "iife" }) => Promise<{
		success: boolean
		logs: Array<unknown>
		outputs: Array<{ text: () => Promise<string> }>
	}>
}

const here = new URL(".", import.meta.url).pathname
const built = await Bun.build({ entrypoints: [`${here}web-entry.ts`], target: "browser", format: "iife" })
if (!built.success) throw new AggregateError(built.logs, "demo build failed")
const script = await built.outputs[0]!.text()

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 })
const errors: Array<string> = []
page.on("pageerror", (error) => errors.push(String(error)))
await page.setContent('<!doctype html><html><body style="margin:0"><div id="app"></div></body></html>')
await page.addScriptTag({ content: script })
await page.waitForSelector("[data-hz=ext][data-ext=ActivityChart][data-drawn] canvas")

// Press a row: it becomes the selected button, the others stay links.
await page.click("[data-hz=item] >> text=engineering")
await page.waitForSelector("[data-hz=item][data-selected] > button[data-hz-part=control]")
const report = await page.evaluate(() => ({
	chartDrawn: document.querySelector("[data-ext=ActivityChart]")!.hasAttribute("data-drawn"),
	chartPixels: (() => {
		const canvas = document.querySelector("[data-ext=ActivityChart] canvas") as HTMLCanvasElement
		const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
		let painted = 0
		for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) painted++
		return painted
	})(),
	meshFallback: document.querySelector("[data-ext=MeshBackground] [data-hz=slot][data-name=fallback]")?.textContent,
	meshDrawn: document.querySelector("[data-ext=MeshBackground]")!.hasAttribute("data-drawn"),
	links: document.querySelectorAll("[data-hz=item] > a").length,
	buttons: [...document.querySelectorAll("[data-hz=item] > button")].map((node) => node.textContent),
}))
await page.screenshot({ path: `${here}__shots__/channel-list-web.png`, fullPage: true })
await browser.close()
console.log(JSON.stringify({ ...report, errors }, null, 2))
if (errors.length > 0 || !report.chartDrawn || report.meshDrawn || report.chartPixels === 0) process.exit(1)
