import { Option, Schema } from "effect"
import { describe, expect, test } from "vitest"
import {
	combo,
	comboLabel,
	comboOfPress,
	comboSearchWords,
	identityOf,
	isTypingSafe,
	KeyCombo,
	keyCaps,
	normalizeCombo,
} from "./key-combo"

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

	test("both primary keys held are named, so the combo stays valid", () => {
		for (const platform of ["mac", "windows"] as const) {
			const recorded = comboOfPress(press("k", { metaKey: true, ctrlKey: true }), platform)
			expect(recorded).toEqual(Option.some("Control+Meta+K"))
			expect(Schema.is(KeyCombo)(Option.getOrThrow(recorded))).toBe(true)
		}
	})

	test("a letter whose upper case is two letters keeps its own spelling", () => {
		const recorded = comboOfPress(press("ß", { altKey: true }), "linux")
		expect(recorded).toEqual(Option.some("Alt+ß"))
		expect(Schema.is(KeyCombo)(Option.getOrThrow(recorded))).toBe(true)
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

describe("comboSearchWords", () => {
	test("names each key the way the platform does", () => {
		expect(comboSearchWords("Mod+Alt+ArrowUp", "mac")).toEqual(
			expect.arrayContaining(["⌘", "cmd", "command", "option", "alt", "up", "arrowup"]),
		)
		expect(comboSearchWords("Mod+Shift+K", "windows")).toEqual(
			expect.arrayContaining(["ctrl", "control", "shift", "k"]),
		)
		expect(comboSearchWords("Mod+K", "windows")).not.toContain("cmd")
		expect(comboSearchWords("Escape", "linux")).toEqual(expect.arrayContaining(["esc", "escape"]))
	})
})

describe("isTypingSafe", () => {
	test("a key that types needs ⌘, Ctrl or Win (Alt types on a Mac); keys that type nothing need less", () => {
		for (const text of [
			"Mod+K",
			"Alt+ArrowUp",
			"Control+J",
			"Meta+Tab",
			"Escape",
			"Shift+Escape",
			"PageUp",
			"F5",
		])
			expect(isTypingSafe(combo(text)), text).toBe(true)
		for (const text of [
			"K",
			"Shift+K",
			"Alt+K",
			"Alt+@",
			"Alt+Space",
			"Tab",
			"Shift+Tab",
			"ArrowUp",
			"/",
		])
			expect(isTypingSafe(combo(text)), text).toBe(false)
	})
})
