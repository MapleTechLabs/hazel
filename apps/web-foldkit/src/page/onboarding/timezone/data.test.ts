import { describe, expect, test } from "vitest"
import { cityFor, filterCities, offsetAt } from "./data"

/** The timezone step's offsets come from the `nowMs` the view passes, never the wall clock. */

const winter = Date.UTC(2026, 0, 15, 12)
const summer = Date.UTC(2026, 6, 15, 12)

describe("timezone offsets", () => {
	test("the offset follows nowMs across daylight saving", () => {
		expect(offsetAt("Europe/Vienna", winter)).toBe(1)
		expect(offsetAt("Europe/Vienna", summer)).toBe(2)
		expect(offsetAt("Asia/Kolkata", winter)).toBe(5.5)
	})

	test("an unknown zone reads as UTC instead of throwing", () => {
		expect(offsetAt("Not/AZone", winter)).toBe(0)
	})

	test("uncurated zones and search results carry the offset at nowMs", () => {
		expect(cityFor("America/Phoenix", summer)).toEqual({
			name: "Phoenix",
			timezone: "America/Phoenix",
			offset: -7,
			country: "America",
		})
		expect(filterCities("vienna", "UTC", summer)).toEqual([
			expect.objectContaining({ timezone: "Europe/Vienna", offset: 2 }),
		])
	})
})
