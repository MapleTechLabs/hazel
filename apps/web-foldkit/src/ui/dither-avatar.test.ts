import { describe, expect, it } from "vitest"
import { ditherHue, ditherInitial, ditherPath } from "./dither-avatar"

describe("dither avatar", () => {
	it("maps each seed to a fixed hue", () => {
		expect(ditherHue("Noor Haddad")).toBe(285)
		expect(ditherHue("Ada Lovelace")).toBe(45)
		expect(ditherHue("Chloe Park")).toBe(165)
	})

	it("uses the first letter of the trimmed seed, uppercased", () => {
		expect(ditherInitial("  noor")).toBe("N")
		expect(ditherInitial("")).toBe("?")
	})

	it("keeps an emoji or a letter that uppercases to two whole", () => {
		expect(ditherInitial("🤖 Deploy Bot")).toBe("🤖")
		expect(ditherInitial("👩‍💻 Ada")).toBe("👩‍💻")
		expect(ditherInitial("ßtra")).toBe("ß")
	})

	it("lights the top-left corner and leaves the bottom-right dark", () => {
		const n = 16
		const lit = new Set<string>()
		for (const [, x, y, w] of ditherPath(n).matchAll(/M(\d+) (\d+)h(\d+)/g)) {
			for (let i = 0; i < Number(w); i++) lit.add(`${Number(x) + i},${y}`)
		}
		expect(lit.has("0,0")).toBe(true)
		expect(lit.has(`${n - 1},${n - 1}`)).toBe(false)
		const topLeft = [...lit].filter((key) => key.split(",").every((v) => Number(v) < n / 2)).length
		const bottomRight = [...lit].filter((key) => key.split(",").every((v) => Number(v) >= n / 2)).length
		expect(topLeft).toBeGreaterThan(bottomRight)
	})
})
