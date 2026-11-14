import { describe, expect, it } from "vitest"
import { warmUrl } from "./warm"

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

describe("warmUrl", () => {
	it("names nothing but the user's own object when there is nothing to add", () => {
		expect(warmUrl([], [], "https://api.test")).toBe("https://api.test/sync/warm")
	})

	it("names the organizations and the channel", () => {
		expect(warmUrl([id(1), id(2)], [id(3)], "https://api.test")).toBe(
			`https://api.test/sync/warm?org=${id(1)}&org=${id(2)}&channel=${id(3)}`,
		)
	})

	it("sends no more of each than the route takes", () => {
		const many = Array.from({ length: 12 }, (_, n) => id(n))
		const query = new URL(warmUrl(many, many, "https://api.test")).searchParams
		expect(query.getAll("org")).toEqual(many.slice(0, 8))
		expect(query.getAll("channel")).toEqual(many.slice(0, 8))
	})
})
