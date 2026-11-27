// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { describe, expect, test } from "vitest"
import { callOf, namesOf, shellSignedIn } from "../test/root-fixtures"
import { initialStored } from "./assistant"
import { update } from "./logic"
import { AppMessage } from "./message"

/** The shell owns the AI panel: open, its width, and what it stores. */

describe("the AI panel", () => {
	test("the rail's toggle opens it and remembers it open; closing hands focus back", () => {
		const opened = update(shellSignedIn("/hazel/chat"), AppMessage.PressedAiPanelToggle())
		expect(opened.model.assistant.isOpen).toBe(true)
		expect(opened.commands.map(callOf)).toEqual([
			{ name: "SaveAssistantPanel", args: { stored: { isOpen: true, width: null } } },
		])
		const closed = update(opened.model, AppMessage.RequestedCloseAssistantPanel())
		expect(closed.model.assistant.isOpen).toBe(false)
		expect(namesOf(closed.commands)).toContain("SaveAssistantPanel")
		expect(namesOf(closed.commands)).toContain("FocusAssistantToggle")
	})

	test("Mod+J (a toggle) and the palette (an open) come from the host", () => {
		const signed = shellSignedIn("/hazel/chat")
		const toggled = update(
			signed,
			AppMessage.ReceivedHostOut({ out: { _tag: "Assistant", request: "Toggle" } }),
		)
		expect(toggled.model.assistant.isOpen).toBe(true)
		const again = update(
			toggled.model,
			AppMessage.ReceivedHostOut({ out: { _tag: "Assistant", request: "Open" } }),
		)
		expect(again.model.assistant.isOpen).toBe(true)
		expect(again.commands).toEqual([])
	})

	test("a released edge stores the width", () => {
		const resized = update(
			shellSignedIn("/hazel/chat"),
			AppMessage.ResizedAssistantPanel({ width: 512.4 }),
		)
		expect(resized.model.assistant.width).toBe(512)
		expect(namesOf(resized.commands)).toContain("SaveAssistantPanel")
	})

	test("a phone never starts it open and does not remember it", () => {
		expect(initialStored({ isOpen: true, width: 2000 }, true)).toEqual({ isOpen: false, width: 960 })
		const phone = shellSignedIn("/hazel/chat", undefined, { isMobile: true })
		const opened = update(phone, AppMessage.PressedAiPanelToggle())
		expect(opened.model.assistant.isOpen).toBe(true)
		expect(opened.commands).toEqual([])
		expect(update(opened.model, AppMessage.RequestedCloseAssistantPanel()).commands).toEqual([])
	})
})
