import { validateHotkey } from "@tanstack/hotkeys"
import { describe, expect, it } from "vitest"
import { HOTKEY_DEFINITIONS, HOTKEY_DEFINITIONS_BY_ID, isAppHotkeyActionId } from "./hotkey-registry"

describe("hotkey-registry", () => {
	it("has unique action ids", () => {
		const actionIds = HOTKEY_DEFINITIONS.map((definition) => definition.id)
		expect(new Set(actionIds).size).toBe(actionIds.length)
	})

	it("indexes all definitions by id", () => {
		expect(Object.keys(HOTKEY_DEFINITIONS_BY_ID).length).toBe(HOTKEY_DEFINITIONS.length)
		for (const definition of HOTKEY_DEFINITIONS) {
			expect(HOTKEY_DEFINITIONS_BY_ID[definition.id]).toEqual(definition)
		}
	})

	it("uses valid default hotkeys", () => {
		for (const definition of HOTKEY_DEFINITIONS) {
			const validationResult = validateHotkey(definition.defaultHotkey)
			expect(validationResult.valid).toBe(true)
		}
	})

	it("correctly narrows action ids", () => {
		expect(isAppHotkeyActionId("commandPalette.open")).toBe(true)
		expect(isAppHotkeyActionId("not-a-real-hotkey-action")).toBe(false)
	})
})
