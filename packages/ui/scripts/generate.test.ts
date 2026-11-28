import { describe, expect, it } from "vitest"
import { parseColor, toHex } from "./color.ts"
import { staleOutputs } from "./generate.ts"
import { tokens } from "../src/style/tokens.ts"
import { generateSwift } from "./swift.ts"
import { generateCss, recipeRules } from "./css.ts"
import { recipes } from "../src/style/recipes/index.ts"

describe("ui:generate", () => {
	it("leaves src/style/generated current (run `bun run --cwd packages/ui ui:generate`)", () => {
		expect(staleOutputs()).toEqual([])
	})

	it("resolves colours to the values the hybrid measured on the live page (Theme.swift seed)", () => {
		// apps/ios/EffectUiSpike/Theme.swift: Row.label is fg-3, Row.selectedFg is sidebar-primary-fg.
		const swift = generateSwift(tokens, recipes)
		expect(swift).toContain("/// `fg-3`: #424245ff / #b1b1b1ff")
		expect(swift).toContain("/// `sidebar-primary-fg`: #6941c6ff / #d6bbfbff")
		expect(toHex(parseColor("oklch(98.5% 0 none)"))).toBe("#fafafaff")
	})

	it("keeps the seeds' surfaces (styles.css `--overlay`, `--field`) in both themes", () => {
		const swift = generateSwift(tokens, recipes)
		expect(swift).toContain("/// `overlay`: #ffffffff / #1e1e1eff")
		expect(swift).toContain("/// `accent-fg`: #6941c6ff / #d6bbfbff")
	})

	it("writes tracking only for tracked roles, and `code` in the mono family", () => {
		const css = generateCss(tokens, recipes)
		expect(css).toContain("--hz-text-display-tracking: -0.48px;")
		expect(css).not.toContain("--hz-text-body-tracking")
		const code = recipeRules(
			{ primitive: "text", parts: {}, base: { root: { text: "code" } }, options: {} },
			new Set(),
		)
		expect(code[0]?.lines).toContain("font-family: var(--hz-font-mono);")
		expect(generateSwift(tokens, recipes)).toContain(
			"TypeMetrics(size: 24, lineHeight: 32, tracking: -0.48)",
		)
	})

	it("writes the motion layer: keyframes, uses per trigger, today's reduced-motion rule", () => {
		const css = generateCss(tokens, recipes)
		expect(css).toContain("@keyframes hz-countUp {\n\t0% { opacity: 0; translate: 0px 70%; }\n}")
		expect(css).toContain(
			'[data-hz="toast"] [data-hz-part="panel"][data-motion~="exit"] {\n\tanimation: hz-toastOut var(--hz-duration-fast) var(--hz-ease-in) 0s 1 both;',
		)
		expect(css).toContain('[data-hz="dialog"] [data-hz-part="panel"][data-motion~="enter"]::backdrop')
		expect(css).toContain("animation-duration: 0.01ms !important;")
		expect(css).toContain("--hz-palette-brand-600: var(--color-brand-600, rgb(127 86 217));")
		const swift = generateSwift(tokens, recipes)
		expect(swift).toContain('public static let reduceMotion = "instant"')
		expect(swift).toContain(
			'"toast": [Use(trigger: .enter, motion: toastIn, part: "panel", backdrop: false, regular: nil), Use(trigger: .exit, motion: toastOut, part: "panel", backdrop: false, regular: nil)],',
		)
	})
})
