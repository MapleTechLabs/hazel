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
		// apps/ios-hybrid/EffectUiSpike/Theme.swift: Row.label is fg-3, Row.selectedFg is sidebar-primary-fg.
		const swift = generateSwift(tokens, recipes)
		expect(swift).toContain("/// `fg-3`: #424245ff / #b2b2b3ff")
		expect(swift).toContain("/// `sidebar-primary-fg`: #6941c6ff / #d6bbfbff")
		expect(toHex(parseColor("oklch(98.5% 0 none)"))).toBe("#fafafaff")
	})

	it("keeps the seeds' surfaces (styles.css `--overlay`, `--field`) in both themes", () => {
		const swift = generateSwift(tokens, recipes)
		expect(swift).toContain("/// `overlay`: #ffffffff / #1d1d21ff")
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
})
