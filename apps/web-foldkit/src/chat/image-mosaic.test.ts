import { describe, expect, test } from "vitest"
import { mosaicLayout } from "./image-mosaic"

describe("mosaicLayout", () => {
	test("one image keeps its own shape; three is one large beside two", () => {
		expect(mosaicLayout(1)).toBe("single")
		expect(mosaicLayout(3)).toBe("feature")
	})

	test("two to ten images fill Discord's rows, every image shown", () => {
		for (let count = 2; count <= 10; count++) {
			if (count === 3) continue
			const rows = mosaicLayout(count) as ReadonlyArray<number>
			expect(rows.reduce((sum, cells) => sum + cells, 0)).toBe(count)
		}
		expect(mosaicLayout(7)).toEqual([1, 3, 3])
	})

	test("past ten, the rows of ten (the last cell counts the rest)", () => {
		expect(mosaicLayout(14)).toEqual(mosaicLayout(10))
	})
})
