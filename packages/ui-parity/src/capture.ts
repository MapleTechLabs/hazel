import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromium, type Browser } from "playwright"
import { fixtureBackendUrl, fixtureElectricUrl, outDir, targets, type TargetName } from "./config.ts"
import { BOX_STYLE_PROPS, collectSnapshot, TEXT_STYLE_PROPS } from "./runtime/snapshot.ts"
import { installDeterminism, waitForVisualQuiet } from "./runtime/stabilize.ts"
import {
	datasets,
	scenarios,
	viewports,
	type Scenario,
	type ThemeName,
	type ViewportName,
} from "./scenarios.ts"

/**
 * One capture = one (scenario, viewport, theme) rendered by one target.
 * Output per capture: `<id>.png` + `<id>.json` (structural snapshot + diagnostics).
 */
export interface CaptureVariant {
	readonly scenario: Scenario
	readonly viewport: ViewportName
	readonly theme: ThemeName
	readonly id: string
}

export interface CaptureResult {
	readonly variantId: string
	readonly ok: boolean
	readonly error?: string
	readonly consoleErrors: ReadonlyArray<string>
	readonly blockedRequests: ReadonlyArray<string>
	readonly durationMs: number
}

export const expandVariants = (filter?: string): CaptureVariant[] =>
	scenarios
		.flatMap((scenario) =>
			(scenario.viewports ?? ["desktop"]).flatMap((viewport) =>
				(scenario.themes ?? ["light"]).map((theme) => ({
					scenario,
					viewport,
					theme,
					id: `${scenario.id}--${viewport}--${theme}`,
				})),
			),
		)
		.filter((variant) => !filter || variant.id.includes(filter) || variant.scenario.area === filter)

export const captureDir = (run: string, target: string) => join(outDir, "runs", run, target)

const SEED = 0x4a2e1

export const captureTarget = async (options: {
	readonly target: TargetName
	/** Output folder name under the run; defaults to the target name (self-checks capture one target twice). */
	readonly label?: string
	readonly run: string
	readonly variants: ReadonlyArray<CaptureVariant>
	readonly browser?: Browser
}): Promise<CaptureResult[]> => {
	const target = targets[options.target]
	const dir = captureDir(options.run, options.label ?? options.target)
	mkdirSync(dir, { recursive: true })
	const browser = options.browser ?? (await chromium.launch())
	const allowedOrigins = new Set([
		`http://localhost:${target.port}`,
		fixtureBackendUrl,
		new URL(fixtureElectricUrl).origin,
	])

	const results: CaptureResult[] = []
	for (const variant of options.variants) {
		const started = performance.now()
		const dataset = datasets.get(variant.scenario.dataset ?? "default")!
		const context = await browser.newContext({
			viewport: viewports[variant.viewport],
			deviceScaleFactor: 1,
			colorScheme: variant.theme,
			reducedMotion: "reduce",
			timezoneId: "UTC",
			locale: "en-US",
			serviceWorkers: "block",
			extraHTTPHeaders: {},
		})
		const page = await context.newPage()
		page.setDefaultTimeout(5000)
		const consoleErrors: string[] = []
		const blockedRequests: string[] = []
		page.on("console", (message) => {
			if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300))
		})
		page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message.slice(0, 300)}`))

		await page.clock.setFixedTime(dataset.now)
		await page.addInitScript(installDeterminism, SEED)
		await page.route("**/*", (route) => {
			const url = new URL(route.request().url())
			if (!allowedOrigins.has(url.origin)) {
				blockedRequests.push(`${url.origin}${url.pathname}`)
				return route.abort("blockedbyclient")
			}
			if (url.origin === `http://localhost:${target.port}`) return route.continue()
			return route.continue({
				headers: { ...route.request().headers(), "x-parity-dataset": dataset.name },
			})
		})

		let error: string | undefined
		try {
			await page.goto(`http://localhost:${target.port}${variant.scenario.path}`, { waitUntil: "load" })
			await page.evaluate(waitForVisualQuiet, { quietMs: 400, timeoutMs: 8000 })
			if (variant.scenario.steps) {
				await variant.scenario.steps(page)
				await page.evaluate(waitForVisualQuiet, { quietMs: 300, timeoutMs: 5000 })
			}
			await page.screenshot({
				path: join(dir, `${variant.id}.png`),
				fullPage: variant.scenario.fullPage ?? false,
				mask: variant.scenario.mask?.(page) as never,
				animations: "disabled",
				caret: "hide",
			})
			const snapshot = await page.evaluate(collectSnapshot, {
				textProps: [...TEXT_STYLE_PROPS],
				boxProps: [...BOX_STYLE_PROPS],
			})
			writeFileSync(join(dir, `${variant.id}.json`), JSON.stringify({ url: page.url(), ...snapshot }))
		} catch (cause) {
			error = cause instanceof Error ? cause.message.split("\n")[0] : String(cause)
			await page.screenshot({ path: join(dir, `${variant.id}.png`) }).catch(() => undefined)
		}
		await context.close()

		const result: CaptureResult = {
			variantId: variant.id,
			ok: !error,
			error,
			consoleErrors: consoleErrors.filter((line) => !/PostHog|Failed to load resource/.test(line)),
			blockedRequests: [...new Set(blockedRequests)],
			durationMs: Math.round(performance.now() - started),
		}
		results.push(result)
		console.log(
			`[capture] ${options.label ?? options.target} ${variant.id} ${result.ok ? "ok" : `FAILED: ${error}`} (${result.durationMs}ms)`,
		)
	}

	writeFileSync(join(dir, "_results.json"), JSON.stringify(results, null, 2))
	if (!options.browser) await browser.close()
	return results
}
