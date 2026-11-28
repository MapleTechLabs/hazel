import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyGrayPalette } from "./apply"

/** The root's inline style, as a map: all `applyGrayPalette` touches. */
const makeRoot = () => {
	const props = new Map<string, string>()
	return {
		props,
		style: {
			setProperty: (name: string, value: string) => void props.set(name, value),
			removeProperty: (name: string) => void props.delete(name),
		},
	}
}

let root: ReturnType<typeof makeRoot>

beforeEach(() => {
	root = makeRoot()
	vi.stubGlobal("document", { documentElement: { style: root.style } })
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe("applyGrayPalette", () => {
	it("tints the ink ladder in dark mode instead of overriding surfaces", () => {
		applyGrayPalette("gray-warm", true)
		expect(Object.fromEntries(root.props)).toEqual({
			"--ink-h": "56",
			"--ink-c": "0.007",
			"--ink-lift": "0",
		})
	})

	it("keeps Ink achromatic for the default palette", () => {
		applyGrayPalette("gray-neutral", true)
		expect(root.props.get("--ink-c")).toBe("0")
		expect(root.props.has("--sidebar")).toBe(false)
	})

	it("lifts the ladder for the classic zinc theme", () => {
		applyGrayPalette("gray-zinc", true)
		expect(root.props.get("--ink-h")).toBe("285.9")
		expect(root.props.get("--ink-lift")).toBe("0.005")
	})

	it("swaps light tokens for the palette's shades, and clears them going dark", () => {
		applyGrayPalette("gray-cool", false)
		expect(root.props.get("--sidebar")).toBe("var(--color-gray-cool-25)")
		expect(root.props.has("--ink-h")).toBe(false)

		applyGrayPalette("gray-cool", true)
		expect(root.props.has("--sidebar")).toBe(false)
		expect(root.props.get("--ink-h")).toBe("276")
	})

	it("leaves light mode on the CSS defaults for neutral and zinc", () => {
		applyGrayPalette("gray-neutral", false)
		applyGrayPalette("gray-zinc", false)
		expect(root.props.size).toBe(0)
	})
})
