import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { directionOfKey } from "./collection"

/** The arrow-key directions for roving focus in tabs, toolbars, toggle groups, trees and tables. */

describe("directionOfKey", () => {
	test("horizontal collections move with left and right arrows only", () => {
		expect(directionOfKey("horizontal", "ArrowRight")).toEqual(Option.some("Next"))
		expect(directionOfKey("horizontal", "ArrowLeft")).toEqual(Option.some("Previous"))
		expect(directionOfKey("horizontal", "ArrowDown")).toEqual(Option.none())
	})

	test("vertical collections move with up and down arrows only", () => {
		expect(directionOfKey("vertical", "ArrowDown")).toEqual(Option.some("Next"))
		expect(directionOfKey("vertical", "ArrowUp")).toEqual(Option.some("Previous"))
		expect(directionOfKey("vertical", "ArrowRight")).toEqual(Option.none())
	})

	test("Home and End jump to the ends in either orientation, other keys do nothing", () => {
		expect(directionOfKey("vertical", "Home")).toEqual(Option.some("First"))
		expect(directionOfKey("horizontal", "End")).toEqual(Option.some("Last"))
		expect(directionOfKey("horizontal", "a")).toEqual(Option.none())
	})
})
