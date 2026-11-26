import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium, type Page } from "playwright"
import { createServer } from "vite"
import { specimenIds } from "../src/gallery/specimens.ts"
import { galleryConfig } from "../src/gallery/vite.config.ts"

/**
 * `bun run --cwd packages/ui gallery:shots`: screenshots every specimen on both sides of the parity
 * gallery (kit and hazel), in light and dark and in both size classes, and pixel-diffs each pair.
 * Writes `src/gallery/__shots__/<theme>-<sizeClass>/<id>.{kit,hazel,diff}.png` and `report.json`.
 *
 * Tolerance: a pixel differs when any RGBA channel differs by more than CHANNEL_TOLERANCE (of 255),
 * and a pair passes when no more than PIXEL_TOLERANCE (0.1%) of its pixels differ and the sizes match.
 * Both sides run in one Chromium with the same fonts, so layout and glyphs match exactly; the slack
 * covers colour rounding and the 3 to 6 device pixels at the hashtag icon's stroke ends that raster
 * differently (delta up to 5). One step of text colour on a row already differs on 3% of pixels.
 */
export const CHANNEL_TOLERANCE = 2
export const PIXEL_TOLERANCE = 0.001

const shotsDir = resolve(import.meta.dirname, "../src/gallery/__shots__")
export const runs = [
	{ theme: "light", sizeClass: "regular", width: 1180 },
	{ theme: "dark", sizeClass: "regular", width: 1180 },
	{ theme: "light", sizeClass: "compact", width: 390 },
	{ theme: "dark", sizeClass: "compact", width: 390 },
] as const

export interface Diff {
	readonly width: number
	readonly height: number
	readonly differing: number
	readonly maxDelta: number
	readonly diffPng: string
}

/** Diffs two PNGs in the page's canvas (no image library needed); returns the diff as a PNG. */
export const diffInPage = (page: Page, kit: Buffer, hazel: Buffer, channelTolerance: number): Promise<Diff> =>
	page.evaluate(
		async ({ kit, hazel, channelTolerance }) => {
			const load = async (base64: string) =>
				createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
			const [a, b] = await Promise.all([load(kit), load(hazel)])
			const width = Math.max(a.width, b.width)
			const height = Math.max(a.height, b.height)
			const pixels = (image: ImageBitmap) => {
				const canvas = new OffscreenCanvas(width, height)
				const context = canvas.getContext("2d")
				if (context === null) throw new Error("no 2d context")
				context.drawImage(image, 0, 0)
				return context.getImageData(0, 0, width, height).data
			}
			const pa = pixels(a)
			const pb = pixels(b)
			const out = new OffscreenCanvas(width, height)
			const context = out.getContext("2d")
			if (context === null) throw new Error("no 2d context")
			const image = context.createImageData(width, height)
			let differing = 0
			let maxDelta = 0
			for (let i = 0; i < pa.length; i += 4) {
				let delta = 0
				for (let c = 0; c < 4; c++)
					delta = Math.max(delta, Math.abs((pa[i + c] ?? 0) - (pb[i + c] ?? 0)))
				maxDelta = Math.max(maxDelta, delta)
				const gray = ((pa[i] ?? 0) + (pa[i + 1] ?? 0) + (pa[i + 2] ?? 0)) / 3
				if (delta > channelTolerance) {
					differing++
					image.data.set([255, 0, 64, 255], i)
				} else image.data.set([gray, gray, gray, 48], i)
			}
			context.putImageData(image, 0, 0)
			const blob = await out.convertToBlob({ type: "image/png" })
			const bytes = new Uint8Array(await blob.arrayBuffer())
			let binary = ""
			for (const byte of bytes) binary += String.fromCharCode(byte)
			return { width, height, differing, maxDelta, diffPng: btoa(binary) }
		},
		{ kit: kit.toString("base64"), hazel: hazel.toString("base64"), channelTolerance },
	)

/** Specimens also shot under the pointer (regular size class only, where `hover: hover` holds). */
const hovered = new Set([
	"item-default",
	"item-selected",
	"button-primary-regular",
	"button-secondary-regular",
	"button-outline-regular",
	"button-ghost-regular",
	"button-warning-regular",
	"button-danger-regular",
	"button-primary-icon-label",
	"button-secondary-icon-label",
	"button-outline-icon-label",
	"button-ghost-icon-label",
	"button-warning-icon-label",
	"button-danger-icon-label",
	"button-primary-disabled",
])

export const openGallery = async (page: Page, url: string) => {
	await page.goto(url)
	await page.waitForSelector(`[data-specimen="${specimenIds.at(-1)}"]`, { timeout: 30_000 })
	await page.evaluate(() => document.fonts.ready.then(() => undefined))
	// Transitions finish before a shot (the kit's buttons fade colour in on load).
	await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" })
}

const main = async () => {
	const server = await createServer(galleryConfig())
	await server.listen()
	const base = server.resolvedUrls?.local[0]
	if (base === undefined) throw new Error("the gallery server has no URL")
	const browser = await chromium.launch()
	rmSync(shotsDir, { recursive: true, force: true })
	const report: Array<Record<string, string | number | boolean>> = []
	try {
		for (const run of runs) {
			const context = await browser.newContext({
				viewport: { width: run.width, height: 1600 },
				deviceScaleFactor: 2,
			})
			const [kit, hazel, scratch] = await Promise.all([
				context.newPage(),
				context.newPage(),
				context.newPage(),
			])
			await Promise.all([
				openGallery(kit, `${base}kit.html?theme=${run.theme}`),
				openGallery(hazel, `${base}hazel.html?theme=${run.theme}`),
			])
			const dir = resolve(shotsDir, `${run.theme}-${run.sizeClass}`)
			mkdirSync(dir, { recursive: true })
			const shots = [
				...specimenIds.map((id) => ({ id, hover: false })),
				...(run.sizeClass === "regular"
					? specimenIds.filter((id) => hovered.has(id)).map((id) => ({ id, hover: true }))
					: []),
			]
			for (const { id: specimen, hover } of shots) {
				const selector = `[data-specimen="${specimen}"]`
				const id = hover ? `${specimen}-hover` : specimen
				const shoot = async (page: Page) => {
					await page.mouse.move(0, 0)
					if (hover) await page.locator(selector).hover({ force: true })
					return page.locator(selector).screenshot({ animations: "disabled" })
				}
				const [a, b] = await Promise.all([shoot(kit), shoot(hazel)])
				const diff = await diffInPage(scratch, a, b, CHANNEL_TOLERANCE)
				const [kitBox, hazelBox] = await Promise.all([
					kit.locator(selector).boundingBox(),
					hazel.locator(selector).boundingBox(),
				])
				const sameSize = kitBox?.width === hazelBox?.width && kitBox?.height === hazelBox?.height
				const ratio = diff.differing / (diff.width * diff.height)
				writeFileSync(resolve(dir, `${id}.kit.png`), a)
				writeFileSync(resolve(dir, `${id}.hazel.png`), b)
				writeFileSync(resolve(dir, `${id}.diff.png`), Buffer.from(diff.diffPng, "base64"))
				report.push({
					run: `${run.theme}-${run.sizeClass}`,
					id,
					pass: sameSize && ratio <= PIXEL_TOLERANCE,
					differingPercent: Math.round(ratio * 1e5) / 1e3,
					maxDelta: diff.maxDelta,
					kitSize: `${kitBox?.width}x${kitBox?.height}`,
					hazelSize: `${hazelBox?.width}x${hazelBox?.height}`,
				})
			}
			await context.close()
		}
	} finally {
		await browser.close()
		await server.close()
	}
	writeFileSync(resolve(shotsDir, "report.json"), `${JSON.stringify(report, null, "\t")}\n`)
	for (const row of report)
		console.log(
			`${row.pass ? "PASS" : "FAIL"} ${row.run} ${row.id}: ${row.differingPercent}% differ, max delta ${row.maxDelta}, kit ${row.kitSize}, hazel ${row.hazelSize}`,
		)
	const failed = report.filter((row) => !row.pass).length
	console.log(
		`${report.length - failed}/${report.length} pairs within tolerance (channel ${CHANNEL_TOLERANCE}, pixels ${PIXEL_TOLERANCE * 100}%)`,
	)
	process.exit(failed === 0 ? 0 : 1)
}

if (import.meta.main) await main()
