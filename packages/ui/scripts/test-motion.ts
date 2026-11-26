import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { type Browser, chromium, type Page } from "playwright"
import { createServer } from "vite"
import { type MotionCase, motionCases } from "../src/gallery/motion-cases.ts"
import { galleryConfig } from "../src/gallery/vite.config.ts"

/**
 * `bun scripts/test-motion.ts` (from `packages/ui`): plays each motion case (`motion-cases.ts`) on
 * today's kit classes and on the hazel renderers, pauses it, and compares the two at fixed points in
 * the timeline: what animates (names, durations, curves), the moving element's opacity, offset and
 * scale, and that an exit keeps the panel shown until it ends. Writes a frame strip per case to
 * `docs/hazel-ui-screens/motion/` and fails on any difference over tolerance.
 */

const outDir = resolve(import.meta.dirname, "../../../docs/hazel-ui-screens/motion")
const TIMES = [0, 25, 50, 75, 100, 150, 200, 260] as const
const STRIP_TIMES = [0, 50, 100, 200] as const
const WIDTHS = [1180, 390] as const
/** Opacity, and offset in px (in fractions of the element's height for a count). */
const OPACITY_TOLERANCE = 0.03
const OFFSET_TOLERANCE = 0.75
const SCALE_TOLERANCE = 0.005

interface Timing {
	readonly kind: string
	readonly name: string
	readonly duration: number
	readonly delay: number
	readonly easing: string
	readonly iterations: number
}

interface Sample {
	readonly at: number
	readonly opacity: number
	readonly dx: number
	readonly dy: number
	readonly scale: number
}

interface Run {
	readonly timings: ReadonlyArray<Timing>
	readonly samples: ReadonlyArray<Sample>
	readonly frames: ReadonlyArray<Buffer>
	/** Exit only: whether the panel was still shown halfway, and gone once the motion ended. */
	readonly shownMidway?: boolean
	readonly goneAfter?: boolean
}

const isCount = (name: MotionCase) => name === "countUp" || name === "countDown"

/** Starts the case, pauses everything on the moving element (and its backdrop), describes it. */
const begin = (page: Page, name: MotionCase) =>
	page.evaluate(async (motionCase) => {
		const motion = window.__motion
		if (motion === undefined) throw new Error("no motion page")
		await motion.start(motionCase)
		const target = document.querySelector<HTMLElement>("[data-motion-target]")
		if (target === null) throw new Error("no target")
		const mine = document
			.getAnimations()
			.filter(
				(animation) =>
					animation.effect instanceof KeyframeEffect && animation.effect.target === target,
			)
		for (const animation of mine) animation.pause()
		const easingOf = (animation: Animation) => {
			const effect = animation.effect as KeyframeEffect
			const own = effect.getTiming().easing ?? "linear"
			const frames = effect.getKeyframes()
			return own !== "linear" || frames.length === 0 ? own : String(frames[0]?.easing ?? "linear")
		}
		return mine.map((animation) => ({
			kind: animation.constructor.name,
			name:
				animation instanceof CSSAnimation
					? animation.animationName
					: animation instanceof CSSTransition
						? animation.transitionProperty
						: "",
			duration: Number((animation.effect as KeyframeEffect).getComputedTiming().duration),
			delay: Number((animation.effect as KeyframeEffect).getTiming().delay),
			easing: easingOf(animation),
			iterations: Number((animation.effect as KeyframeEffect).getTiming().iterations),
		}))
	}, name)

/** Seeks the target's animations to `at` ms (or their end) and reads its pose against its rest. */
const sampleAt = (page: Page, at: number | "end") =>
	page.evaluate((time) => {
		const target = document.querySelector<HTMLElement>("[data-motion-target]")
		if (target === null) throw new Error("no target")
		const mine = document
			.getAnimations()
			.filter(
				(animation) =>
					animation.effect instanceof KeyframeEffect && animation.effect.target === target,
			)
		for (const animation of mine) {
			const end = Number((animation.effect as KeyframeEffect).getComputedTiming().endTime)
			animation.currentTime = time === "end" ? Math.max(0, end - 0.001) : Math.min(time, end - 0.001)
		}
		const box = target.getBoundingClientRect()
		return {
			opacity: Number(getComputedStyle(target).opacity),
			x: box.left + box.width / 2,
			y: box.top + box.height / 2,
			width: box.width,
			height: box.height,
		}
	}, at)

const play = async (
	browser: Browser,
	base: string,
	side: "kit" | "hazel",
	name: MotionCase,
	width: number,
) => {
	const context = await browser.newContext({ viewport: { width, height: 720 }, deviceScaleFactor: 2 })
	const page = await context.newPage()
	const errors: Array<string> = []
	page.on("pageerror", (error) => errors.push(error.message))
	await page.goto(`${base}motion-${side}.html?theme=light`)
	await page.waitForSelector("html[data-ready]", { timeout: 120_000 })
	// Inter loads on first use: load it now, or text reflows in the middle of the samples.
	await page.evaluate(async () => {
		await Promise.all(["400", "500", "600"].map((weight) => document.fonts.load(`${weight} 16px Inter`)))
		await document.fonts.ready
	})
	const timings = await begin(page, name)
	// The rest pose: the final, or for an exit the first (shown) frame.
	const exit = name === "toastExit"
	const rest = await sampleAt(page, exit ? 0 : "end")
	const samples: Array<Sample> = []
	for (const at of TIMES) {
		const now = await sampleAt(page, at)
		const unit = isCount(name) ? rest.height : 1
		samples.push({
			at,
			opacity: Math.round(now.opacity * 1000) / 1000,
			dx: Math.round(((now.x - rest.x) / unit) * 1000) / 1000,
			dy: Math.round(((now.y - rest.y) / unit) * 1000) / 1000,
			scale: Math.round((now.width / rest.width) * 10000) / 10000,
		})
	}
	const frames: Array<Buffer> = []
	const clip = await page.evaluate(() => {
		const target = document.querySelector<HTMLElement>("[data-motion-target]")
		const box = target?.getBoundingClientRect()
		return box === undefined
			? undefined
			: { x: box.left, y: box.top, width: box.width, height: box.height }
	})
	if (clip !== undefined) {
		const pad = 24
		const area = {
			x: Math.max(0, clip.x - pad),
			y: Math.max(0, clip.y - pad),
			width: Math.min(width - Math.max(0, clip.x - pad), clip.width + 2 * pad),
			height: Math.min(720 - Math.max(0, clip.y - pad), clip.height + 2 * pad + 24),
		}
		for (const at of STRIP_TIMES) {
			await sampleAt(page, at)
			frames.push(await page.screenshot({ clip: area }))
		}
	}
	let shownMidway: boolean | undefined
	let goneAfter: boolean | undefined
	if (exit && side === "hazel") {
		await sampleAt(page, 75)
		shownMidway = await page.evaluate(
			() => document.querySelector<HTMLElement>("[data-motion-target]")?.dataset.open !== undefined,
		)
		await page.evaluate(async () => {
			for (const animation of document.getAnimations()) animation.finish()
			await new Promise((done) => setTimeout(done, 50))
		})
		goneAfter = await page.evaluate(
			() => document.querySelector<HTMLElement>("[data-motion-target]")?.dataset.open === undefined,
		)
	}
	if (errors.length > 0) throw new Error(`${side} ${name}: ${errors.join("; ")}`)
	await context.close()
	return { timings, samples, frames, shownMidway, goneAfter } satisfies Run
}

/** Today's row above hazel's, one column per strip time, drawn on a canvas in `page`. */
const strip = (page: Page, kit: ReadonlyArray<Buffer>, hazel: ReadonlyArray<Buffer>, label: string) =>
	page.evaluate(
		async ({ kitFrames, hazelFrames, times, title }) => {
			const load = (data: string) =>
				new Promise<HTMLImageElement>((done, fail) => {
					const image = new Image()
					image.onload = () => done(image)
					image.onerror = fail
					image.src = `data:image/png;base64,${data}`
				})
			const rows = [await Promise.all(kitFrames.map(load)), await Promise.all(hazelFrames.map(load))]
			const cell = rows.flat().reduce(
				(size, image) => ({
					w: Math.max(size.w, image.width),
					h: Math.max(size.h, image.height),
				}),
				{ w: 0, h: 0 },
			)
			const gutter = 160
			const head = 56
			const canvas = document.createElement("canvas")
			canvas.width = gutter + cell.w * times.length
			canvas.height = head + cell.h * 2
			const context = canvas.getContext("2d")
			if (context === null) throw new Error("no canvas")
			context.fillStyle = "#fff"
			context.fillRect(0, 0, canvas.width, canvas.height)
			context.fillStyle = "#111"
			context.font = "600 24px sans-serif"
			context.fillText(title, 16, 34)
			context.font = "20px sans-serif"
			times.forEach((at, column) => context.fillText(`${at}ms`, gutter + column * cell.w + 8, head - 4))
			;["today", "hazel"].forEach((name, row) => {
				context.fillText(name, 16, head + row * cell.h + cell.h / 2)
				rows[row]?.forEach((image, column) =>
					context.drawImage(image, gutter + column * cell.w, head + row * cell.h),
				)
			})
			return canvas.toDataURL("image/png").slice("data:image/png;base64,".length)
		},
		{
			kitFrames: kit.map((frame) => frame.toString("base64")),
			hazelFrames: hazel.map((frame) => frame.toString("base64")),
			times: [...STRIP_TIMES],
			title: label,
		},
	)

const compare = (name: MotionCase, kit: Run, hazel: Run): ReadonlyArray<string> => {
	const problems: Array<string> = []
	if (hazel.timings.length === 0) problems.push("hazel: nothing animates")
	const span = (run: Run) => Math.max(0, ...run.timings.map((timing) => timing.duration + timing.delay))
	if (Math.abs(span(kit) - span(hazel)) > 1)
		problems.push(`duration: today ${span(kit)}ms, hazel ${span(hazel)}ms`)
	kit.samples.forEach((ours, index) => {
		const theirs = hazel.samples[index]
		if (theirs === undefined) return
		const unit = isCount(name) ? 0.02 : OFFSET_TOLERANCE
		const off = [
			Math.abs(ours.opacity - theirs.opacity) > OPACITY_TOLERANCE
				? `opacity ${ours.opacity} vs ${theirs.opacity}`
				: "",
			Math.abs(ours.dy - theirs.dy) > unit ? `dy ${ours.dy} vs ${theirs.dy}` : "",
			Math.abs(ours.dx - theirs.dx) > unit ? `dx ${ours.dx} vs ${theirs.dx}` : "",
			Math.abs(ours.scale - theirs.scale) > SCALE_TOLERANCE
				? `scale ${ours.scale} vs ${theirs.scale}`
				: "",
		].filter((each) => each !== "")
		if (off.length > 0) problems.push(`at ${ours.at}ms: ${off.join(", ")}`)
	})
	if (name === "toastExit" && hazel.shownMidway !== true)
		problems.push("hazel: the toast hid before its exit ended")
	if (name === "toastExit" && hazel.goneAfter !== true)
		problems.push("hazel: the toast stayed after its exit")
	return problems
}

const main = async () => {
	const server = await createServer(galleryConfig())
	await server.listen()
	const base = server.resolvedUrls?.local[0]
	if (base === undefined) throw new Error("the gallery server has no URL")
	const browser = await chromium.launch()
	mkdirSync(outDir, { recursive: true })
	const report: Array<Record<string, unknown>> = []
	let failures = 0
	try {
		const scratch = await browser.newPage()
		for (const width of WIDTHS)
			for (const name of motionCases) {
				const kit = await play(browser, base, "kit", name, width)
				const hazel = await play(browser, base, "hazel", name, width)
				const problems = compare(name, kit, hazel)
				failures += problems.length === 0 ? 0 : 1
				console.log(
					`${problems.length === 0 ? "PASS" : "FAIL"} ${name} @${width}${problems.length === 0 ? "" : `: ${problems.join("; ")}`}`,
				)
				report.push({
					case: name,
					width,
					today: { timings: kit.timings, samples: kit.samples },
					hazel: {
						timings: hazel.timings,
						samples: hazel.samples,
						shownMidway: hazel.shownMidway,
						goneAfter: hazel.goneAfter,
					},
					problems,
				})
				if (kit.frames.length > 0 && hazel.frames.length > 0) {
					const png = await strip(scratch, kit.frames, hazel.frames, `${name} @${width}`)
					writeFileSync(resolve(outDir, `${name}-${width}.png`), Buffer.from(png, "base64"))
				}
			}
	} finally {
		await browser.close()
		await server.close()
	}
	writeFileSync(resolve(outDir, "report.json"), `${JSON.stringify(report, null, "\t")}\n`)
	console.log(`${report.length - failures} passed, ${failures} failed`)
	process.exit(failures === 0 ? 0 : 1)
}

await main()
