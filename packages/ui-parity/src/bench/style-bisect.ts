import { parseArgs } from "node:util"
import { chromium } from "playwright"
import { startFixtureBackend } from "../backend/server.ts"
import { BROWSER_LAUNCH_OPTIONS } from "../capture.ts"
import { buildDir, FIXTURE_BACKEND_PORT, FIXTURE_ELECTRIC_PORT, targets, type TargetName } from "../config.ts"
import { heavyIds } from "../fixtures/datasets/heavy.ts"
import { clerkIdentityFor } from "../fixtures/identity.ts"
import { datasets } from "../scenarios.ts"
import { serveStatic } from "../serve.ts"
import { prepareList } from "./chat-list-probes.ts"

/**
 * Finds the CSS rule that makes a DOM insertion expensive. Opens the heavy channel, times
 * "insert a div next to a message row + force style and layout", then bisects the stylesheet
 * (rules swapped for no-ops in place) down to the rule whose removal makes insertions cheap.
 * This found the `has-disabled` rule that restyled ~23k elements per insertion (S4 record).
 *
 *   PARITY_PORT_BASE=5750 bun run src/bench/style-bisect.ts [--target foldkit|legacy|legacy-head]
 */

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		target: { type: "string", default: "foldkit" },
		probe: { type: "string", default: "div" },
		strip: { type: "string" },
	},
})
const target = values.target as TargetName
const dataset = datasets.get("heavy")!
const backend = startFixtureBackend({
	port: FIXTURE_BACKEND_PORT,
	electricPort: FIXTURE_ELECTRIC_PORT,
	datasets,
	defaultDataset: "heavy",
})
const server = serveStatic(buildDir(target), targets[target].port, clerkIdentityFor(dataset))
const browser = await chromium.launch(BROWSER_LAUNCH_OPTIONS)
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage()
await page.goto(`http://localhost:${targets[target].port}/${heavyIds.orgSlug}/chat/${heavyIds.bigChannelId}`)
await prepareList(page)

const log = await page.evaluate(
	([probeKind, strip]) => {
		// `--strip <text>` deletes every rule containing <text> first, to test a family of rules.
		const stripRules = (parent: CSSStyleSheet | CSSGroupingRule): number => {
			let removed = 0
			for (let index = parent.cssRules.length - 1; index >= 0; index--) {
				const rule = parent.cssRules[index]!
				if (rule instanceof CSSGroupingRule && !(rule instanceof CSSStyleRule))
					removed += stripRules(rule)
				else if (strip && rule.cssText.includes(strip)) {
					parent.deleteRule(index)
					removed++
				}
			}
			return removed
		}
		const stripped = strip
			? [...document.styleSheets].reduce((sum, sheet) => sum + stripRules(sheet), 0)
			: 0
		const row = document.querySelector("[data-id]")!
		const where = row.parentElement!
		// `row` probes clone a rendered message row's wrapper, which is what scrolling inserts.
		const makeProbe = () =>
			probeKind === "row"
				? ((row.closest("[data-list-key], [data-index]") ?? row).cloneNode(true) as Element)
				: document.createElement("div")
		const measure = () => {
			const started = performance.now()
			for (let i = 0; i < 3; i++) {
				const probe = makeProbe()
				;(probeKind === "row"
					? row.closest("[data-list-key], [data-index]")!.parentElement!
					: where
				).appendChild(probe)
				void document.documentElement.offsetHeight
				probe.remove()
				void document.documentElement.offsetHeight
			}
			return (performance.now() - started) / 6
		}
		interface Slot {
			readonly parent: CSSStyleSheet | CSSGroupingRule
			readonly index: number
			readonly text: string
		}
		const slots: Slot[] = []
		const walk = (parent: CSSStyleSheet | CSSGroupingRule) => {
			for (let index = 0; index < parent.cssRules.length; index++) {
				const rule = parent.cssRules[index]!
				if (
					rule instanceof CSSGroupingRule &&
					!(rule instanceof CSSStyleRule) &&
					rule.cssRules.length > 0
				)
					walk(rule)
				else slots.push({ parent, index, text: rule.cssText })
			}
		}
		for (const sheet of document.styleSheets) walk(sheet)
		const toggle = (from: number, to: number, isDisabled: boolean) => {
			for (let k = from; k < to; k++) {
				const slot = slots[k]!
				slot.parent.deleteRule(slot.index)
				slot.parent.insertRule(isDisabled ? ".__parity-disabled{}" : slot.text, slot.index)
			}
		}
		const base = measure()
		const lines = [`${slots.length} rules (${stripped} stripped), insertion costs ${base.toFixed(1)} ms`]
		let low = 0
		let high = slots.length
		while (high - low > 1) {
			const middle = (low + high) >> 1
			toggle(low, middle, true)
			const cost = measure()
			toggle(low, middle, false)
			if (cost < base / 4) high = middle
			else low = middle
		}
		toggle(low, low + 1, true)
		lines.push(`culprit: ${slots[low]!.text.slice(0, 300)}`, `without it: ${measure().toFixed(1)} ms`)
		return lines
	},
	[values.probe, values.strip ?? ""] as const,
)
console.log(log.join("\n"))
await browser.close()
server.stop(true)
await backend.stop()
