import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import { combo, comboLabel, comboOfPress, identityOf, KeyCombo, keyCaps, normalizeCombo } from "./key-combo"

const press = (
	key: string,
	modifiers: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {},
) => ({
	key,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...modifiers,
})

describe("KeyCombo", () => {
	test.each([
		"Mod+K",
		"Mod+Shift+F",
		"Alt+ArrowUp",
		"Escape",
		"Mod+/",
		"Shift+Enter",
		"Plus",
		"Mod+Alt+Shift+ArrowDown",
	])("accepts the canonical %s", (text) => expect(Schema.is(KeyCombo)(text)).toBe(true))

	test.each([
		["", "empty"],
		["Mod", "a modifier alone"],
		["Shift+Shift+K", "a repeated modifier"],
		["Mod+Meta+K", "Mod with Meta"],
		["Cmd+K", "an unknown modifier"],
		["Mod+k", "a lower case letter (not canonical)"],
		["Shift+Mod+K", "modifiers out of order"],
		["Mod+Banana", "an unknown named key"],
	])("rejects %j: %s", (text) => expect(Schema.is(KeyCombo)(text)).toBe(false))

	test("normalizeCombo makes any spelling canonical", () => {
		expect(normalizeCombo("shift+mod+k")).toEqual(Option.some("Mod+Shift+K"))
		expect(normalizeCombo("escape")).toEqual(Option.some("Escape"))
		expect(normalizeCombo(" + ")).toEqual(Option.none())
	})

	test("combo throws on a typo", () => expect(() => combo("Mod+")).toThrow(/Invalid key combo/))
})

describe("comboOfPress", () => {
	test("the platform's primary key is Mod, so a combo recorded on a Mac works on Windows", () => {
		expect(comboOfPress(press("k", { metaKey: true }), "mac")).toEqual(Option.some("Mod+K"))
		expect(comboOfPress(press("k", { ctrlKey: true }), "windows")).toEqual(Option.some("Mod+K"))
		expect(comboOfPress(press("k", { ctrlKey: true }), "mac")).toEqual(Option.some("Control+K"))
		expect(comboOfPress(press("k", { metaKey: true }), "windows")).toEqual(Option.some("Meta+K"))
	})

	test("a modifier alone, or a key no binding can match, makes no combo", () => {
		expect(comboOfPress(press("Shift", { shiftKey: true }), "mac")).toEqual(Option.none())
		expect(comboOfPress(press("Meta", { metaKey: true }), "mac")).toEqual(Option.none())
		expect(comboOfPress(press("Dead", { altKey: true }), "mac")).toEqual(Option.none())
	})

	test("space and plus get their names, other keys their canonical case", () => {
		expect(comboOfPress(press(" ", { ctrlKey: true }), "linux")).toEqual(Option.some("Mod+Space"))
		expect(comboOfPress(press("+"), "linux")).toEqual(Option.some("Plus"))
		expect(comboOfPress(press("arrowup", { altKey: true }), "linux")).toEqual(Option.some("Alt+ArrowUp"))
		expect(comboOfPress(press("?", { shiftKey: true }), "linux")).toEqual(Option.some("Shift+?"))
	})
})

describe("identityOf", () => {
	test("Mod is the platform's key", () => {
		expect(identityOf(combo("Mod+K"), "mac")).toBe(identityOf(combo("Meta+K"), "mac"))
		expect(identityOf(combo("Mod+K"), "windows")).toBe(identityOf(combo("Control+K"), "windows"))
		expect(identityOf(combo("Mod+K"), "mac")).not.toBe(identityOf(combo("Control+K"), "mac"))
	})
})

describe("labels", () => {
	test("Mac symbols in Apple's order; Ctrl-style elsewhere", () => {
		expect(keyCaps("Mod+Shift+K", "mac")).toEqual(["⇧", "⌘", "K"])
		expect(comboLabel("Mod+Alt+ArrowUp", "mac")).toBe("⌥⌘↑")
		expect(comboLabel("Mod+Shift+K", "windows")).toBe("Ctrl+Shift+K")
		expect(comboLabel("Escape", "linux")).toBe("Esc")
	})
})
