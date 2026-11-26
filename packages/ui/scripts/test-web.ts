import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { chromium, type Page } from "playwright"
import { createServer } from "vite"
import type { CaseOutcome } from "../src/gallery/primitives.ts"
import { galleryConfig } from "../src/gallery/vite.config.ts"
import { CHANNEL_TOLERANCE, diffInPage, openGallery, PIXEL_TOLERANCE, runs } from "./shoot.ts"

// Glyphs drawn the same at any fractional x: Linux Chromium positions text by subpixel, so the kit
// and hazel specimens (side by side, at different offsets) would otherwise rasterize differently.
const TEXT_RENDERING_ARGS = ["--disable-font-subpixel-positioning", "--font-render-hinting=none"]

/**
 * `bun run --cwd packages/ui test:web [--lane A4] [--tags item,section]`: the browser runner (phase 1.5).
 * Mounts every conformance case on the real web host in Chromium, in light and dark and both size
 * classes; checks each drawn case's ARIA (the fixture's `aria` roles, and an accessible name on every
 * control); screenshots it to `src/conformance/__shots__/<theme>-<sizeClass>/`; and pixel-diffs a case
 * with a `kit` counterpart against today's Foldkit kit, at G6's tolerance (`shoot.ts`).
 * A stub or missing renderer is reported as "not implemented: lane X" and skipped, not failed.
 */

const arg = (name: string) => {
	const at = process.argv.indexOf(`--${name}`)
	return at < 0 ? undefined : process.argv[at + 1]
}
const lane = arg("lane")
const tagsArg = arg("tags")
const query = [lane ? `lane=${lane}` : "", tagsArg ? `tags=${tagsArg}` : ""].filter(Boolean).join("&")
const shotsDir = resolve(import.meta.dirname, "../src/conformance/__shots__")

/** Kit diffs known to fail, each with its owning lane; a listed case that passes fails the run. */
const knownDiffs: ReadonlyArray<{ readonly case: string; readonly lane: string; readonly reason: string }> =
	JSON.parse(readFileSync(resolve(import.meta.dirname, "../src/conformance/known-diffs.json"), "utf8"))
const known = new Map(knownDiffs.map((entry) => [entry.case, entry]))

interface Result {
	readonly run: string
	readonly id: string
	readonly outcome: "pass" | "fail" | "skip" | "known"
	readonly detail: string
}

/** Controls with no accessible name: what a screen reader could not announce. */
const unnamedControls = (page: Page, id: string) =>
	page.evaluate((caseId) => {
		const root = document.querySelector(`[data-case="${CSS.escape(caseId)}"]`)
		if (root === null) return ["case not found"]
		const controls = root.querySelectorAll("button, a[href], input, textarea, select, [role=button]")
		return [...controls]
			.filter((node) => {
				const labelled = node.getAttribute("aria-labelledby")
				const named =
					(node.getAttribute("aria-label") ?? "").trim() !== "" ||
					(node.textContent ?? "").trim() !== "" ||
					(labelled !== null && document.getElementById(labelled) !== null) ||
					(node instanceof HTMLInputElement && (node.labels?.length ?? 0) > 0) ||
					(node instanceof HTMLTextAreaElement && (node.labels?.length ?? 0) > 0)
				return !named
			})
			.map((node) => node.outerHTML.slice(0, 80))
	}, id)

const caseTarget = (page: Page, c: CaseOutcome) => {
	const frame = page.locator(`[data-case="${c.id}"]`)
	const target = c.kit?.target ?? "frame"
	return target === "frame" ? frame : frame.locator(`[data-hz="${target}"]`).first()
}

const main = async () => {
	const server = await createServer(galleryConfig())
	await server.listen()
	const base = server.resolvedUrls?.local[0]
	if (base === undefined) throw new Error("the gallery server has no URL")
	const browser = await chromium.launch({ args: TEXT_RENDERING_ARGS })
	rmSync(shotsDir, { recursive: true, force: true })
	const results: Array<Result> = []
	const notImplemented = new Map<string, Set<string>>()
	try {
		for (const run of runs) {
			const name = `${run.theme}-${run.sizeClass}`
			const context = await browser.newContext({
				viewport: { width: run.width, height: 1600 },
				deviceScaleFactor: 2,
			})
			const page = await context.newPage()
			const errors: Array<string> = []
			page.on("pageerror", (error) => errors.push(error.message))
			await page.goto(`${base}primitives.html?theme=${run.theme}${query ? `&${query}` : ""}`)
			await page.waitForSelector("html[data-ready]", { timeout: 120_000 })
			await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; }" })
			const outcomes = await page.evaluate(() => window.__hazelCases ?? [])
			const needsKit = outcomes.some((c) => c.status === "ok" && c.kit !== undefined)
			const kit = needsKit ? await context.newPage() : undefined
			if (kit !== undefined) await openGallery(kit, `${base}kit.html?theme=${run.theme}`)
			const scratch = needsKit ? await context.newPage() : undefined
			const dir = resolve(shotsDir, name)
			mkdirSync(dir, { recursive: true })
			for (const c of outcomes) {
				if (c.status === "stub" || c.status === "missing") {
					for (const owner of c.lanes)
						notImplemented.set(owner, (notImplemented.get(owner) ?? new Set()).add(`hz:${c.tag}`))
					results.push({
						run: name,
						id: c.id,
						outcome: "skip",
						detail: `not implemented: lane ${c.lanes.join(", ")}`,
					})
					continue
				}
				if (c.status === "error") {
					results.push({
						run: name,
						id: c.id,
						outcome: "fail",
						detail: `mount failed: ${c.error ?? ""}`,
					})
					continue
				}
				const problems: Array<string> = []
				const frame = page.locator(`[data-case="${c.id}"]`)
				for (const expected of c.aria) {
					const found = await frame
						.getByRole(
							expected.role as Parameters<Page["getByRole"]>[0],
							expected.name === undefined ? {} : { name: expected.name, exact: true },
						)
						.count()
					if (found === 0)
						problems.push(
							`no ${expected.role}${expected.name ? ` named "${expected.name}"` : ""}`,
						)
				}
				for (const html of await unnamedControls(page, c.id))
					problems.push(`control without a name: ${html}`)
				await page.mouse.move(0, 0)
				const shot = await caseTarget(page, c).screenshot({ animations: "disabled" })
				const file = c.id.replaceAll("/", "__").replaceAll(/[^A-Za-z0-9._-]/g, "_")
				writeFileSync(resolve(dir, `${file}.png`), shot)
				let detail = "drawn"
				if (c.kit !== undefined && kit !== undefined && scratch !== undefined) {
					const specimen = kit.locator(`[data-specimen="${c.kit.specimen}"]`)
					const theirs = await specimen.screenshot({ animations: "disabled" })
					const diff = await diffInPage(scratch, theirs, shot, CHANNEL_TOLERANCE)
					const [kitBox, ourBox] = await Promise.all([
						specimen.boundingBox(),
						caseTarget(page, c).boundingBox(),
					])
					const sameSize = kitBox?.width === ourBox?.width && kitBox?.height === ourBox?.height
					const ratio = diff.differing / (diff.width * diff.height)
					writeFileSync(resolve(dir, `${file}.kit.png`), theirs)
					writeFileSync(resolve(dir, `${file}.diff.png`), Buffer.from(diff.diffPng, "base64"))
					detail = `kit ${c.kit.specimen}: ${Math.round(ratio * 1e5) / 1e3}% differ, max delta ${diff.maxDelta}, kit ${kitBox?.width}x${kitBox?.height}, hazel ${ourBox?.width}x${ourBox?.height}`
					const over = !sameSize || ratio > PIXEL_TOLERANCE
					const listed = known.get(c.id)
					if (over && listed !== undefined) {
						results.push({
							run: name,
							id: c.id,
							outcome: problems.length === 0 ? "known" : "fail",
							detail: [
								...problems,
								`known diff, lane ${listed.lane}: ${listed.reason} (${detail})`,
							].join("; "),
						})
						continue
					}
					if (over) problems.push(`pixel diff over tolerance (${detail})`)
					if (!over && listed !== undefined)
						problems.push(`known diff now passes: remove ${c.id} from known-diffs.json`)
				}
				results.push(
					problems.length === 0
						? { run: name, id: c.id, outcome: "pass", detail }
						: { run: name, id: c.id, outcome: "fail", detail: problems.join("; ") },
				)
			}
			for (const error of errors)
				results.push({ run: name, id: "(page)", outcome: "fail", detail: error })
			await context.close()
		}
	} finally {
		await browser.close()
		await server.close()
	}
	mkdirSync(shotsDir, { recursive: true })
	writeFileSync(resolve(shotsDir, "report.json"), `${JSON.stringify(results, null, "\t")}\n`)
	for (const row of results)
		if (row.outcome !== "skip")
			console.log(`${row.outcome.toUpperCase()} ${row.run} ${row.id}: ${row.detail}`)
	for (const [owner, missing] of [...notImplemented].sort())
		console.log(`not implemented: lane ${owner} (${[...missing].sort().join(", ")})`)
	const count = (outcome: Result["outcome"]) => results.filter((row) => row.outcome === outcome).length
	console.log(
		`${count("pass")} passed, ${count("fail")} failed, ${count("known")} known diffs, ${count("skip")} skipped (not implemented), over ${runs.length} runs; tolerance channel ${CHANNEL_TOLERANCE}, pixels ${PIXEL_TOLERANCE * 100}%`,
	)
	if (results.length === 0) console.log(`no cases matched${query ? ` (${query})` : ""}`)
	process.exit(count("fail") === 0 ? 0 : 1)
}

await main()
