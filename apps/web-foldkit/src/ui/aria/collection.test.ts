import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { directionOfKey, focusItem, hoverItem, initInteraction, itemState, moveKey, useModality } from "./collection"

/** Pure roving-focus helpers shared by tabs, toolbars, toggle groups, trees and tables. */

const keys = ["a", "b", "c", "d"]
const none = () => false
const disabled =
	(...disabledKeys: ReadonlyArray<string>) =>
	(key: string) =>
		disabledKeys.includes(key)

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

describe("moveKey", () => {
	test("Next skips disabled items", () => {
		expect(moveKey(keys, "a", "Next", disabled("b"), false)).toEqual(Option.some("c"))
	})

	test("Previous skips disabled items", () => {
		expect(moveKey(keys, "d", "Previous", disabled("c", "b"), false)).toEqual(Option.some("a"))
	})

	test("without wrapping, moving past either end finds nothing", () => {
		expect(moveKey(keys, "d", "Next", none, false)).toEqual(Option.none())
		expect(moveKey(keys, "a", "Previous", none, false)).toEqual(Option.none())
	})

	test("with wrapping, moving past either end continues from the other end", () => {
		expect(moveKey(keys, "d", "Next", disabled("a"), true)).toEqual(Option.some("b"))
		expect(moveKey(keys, "a", "Previous", disabled("d"), true)).toEqual(Option.some("c"))
	})

	test("First and Last find the outermost enabled items", () => {
		expect(moveKey(keys, "c", "First", disabled("a"), false)).toEqual(Option.some("b"))
		expect(moveKey(keys, "b", "Last", disabled("d"), false)).toEqual(Option.some("c"))
	})

	test("with every other item disabled there is nowhere to move", () => {
		expect(moveKey(keys, "a", "Next", disabled("b", "c", "d"), true)).toEqual(Option.none())
	})
})

describe("itemState", () => {
	test("a hovered, focused item shows focus-visible under keyboard modality", () => {
		const interaction = useModality(focusItem(hoverItem(initInteraction(), "a"), "a"), "Keyboard")
		expect(itemState(interaction, "a")).toEqual({ isHovered: true, isFocused: true, isFocusVisible: true })
		expect(itemState(interaction, "b")).toEqual({ isHovered: false, isFocused: false, isFocusVisible: false })
	})

	test("pointer focus is not focus-visible and disabled items are never hovered", () => {
		const interaction = useModality(focusItem(hoverItem(initInteraction(), "a"), "a"), "Pointer")
		expect(itemState(interaction, "a", true)).toEqual({
			isHovered: false,
			isFocused: true,
			isFocusVisible: false,
		})
	})
})
