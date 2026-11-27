// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest"
import { QUEUE_KEYS } from "@hazel/shared-screens/customers/pages/attention/AttentionPage"
import { queueKeyFilter } from "../customers/ui/queue-keys"
import { inboxKeyOf } from "./customers/inbox/subscription"
import { listKeyOf } from "./customers/list/subscription"
import { isInAssistantPanel } from "./assistant-context"

/** Page keys leave keys pressed inside the AI panel alone (the channel's are in its hotkeys test). */

const panelButton = () => {
	const panel = document.createElement("aside")
	panel.setAttribute("data-ai-panel", "")
	const button = document.createElement("button")
	panel.append(button)
	document.body.append(panel)
	return button
}

const keydown = (key: string, target: EventTarget) => ({
	key,
	target,
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	repeat: false,
})

afterEach(() => document.body.replaceChildren())

/** Needs attention's keys as the web's `QueueKeyboard` reads them (`customers/queue-keyboard.ts`). */
const queueKeyOf = queueKeyFilter(QUEUE_KEYS.keys, QUEUE_KEYS.repeatable, QUEUE_KEYS.pressable)

describe("isInAssistantPanel", () => {
	test("is true inside the panel only", () => {
		expect(isInAssistantPanel(panelButton())).toBe(true)
		expect(isInAssistantPanel(document.body)).toBe(false)
		expect(isInAssistantPanel(null)).toBe(false)
	})
})

describe("the customers pages' keys", () => {
	test("the list's j, x and Escape stay with the panel", () => {
		const target = panelButton()
		expect(listKeyOf(keydown("j", target))).toBeNull()
		expect(listKeyOf(keydown("x", target))).toBeNull()
		expect(listKeyOf(keydown("Escape", target))).toBeNull()
		expect(listKeyOf(keydown("j", document.body))).toBe("next")
	})

	test("the worklists' keys stay with the panel", () => {
		const target = panelButton()
		expect(queueKeyOf(keydown("k", target))).toBeNull()
		expect(inboxKeyOf(keydown("s", target))).toBeNull()
		expect(queueKeyOf(keydown("k", document.body))).toBe("next")
	})
})
