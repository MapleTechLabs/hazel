// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { collectKeyStream } from "../test/key-stream"
import { layoutHotkeys } from "./hotkeys"

/** The org layout's hotkeys from real `keydown`s: Mod is Meta on a Mac, Control elsewhere. */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (init: KeyboardEventInit): KeyboardEventInit =>
	isMac ? { ...init, metaKey: true } : { ...init, ctrlKey: true }
const run = (act: Parameters<typeof collectKeyStream>[1]) =>
	collectKeyStream(
		layoutHotkeys((id) => id),
		act,
	)

describe("layout hotkeys", () => {
	test.each([
		[{ key: "k" }, "commandPalette.open"],
		[{ key: "F", shiftKey: true }, "search.open"],
		[{ key: "n", altKey: true, code: "KeyN" }, "channel.create"],
		[{ key: "d", altKey: true, code: "KeyD" }, "dm.create"],
		[{ key: "i", altKey: true, code: "KeyI" }, "invite.email"],
	] as const)("Mod+%j fires %s and takes the key from the browser", async (init, actionId) => {
		const prevented: Array<boolean> = []
		const fired = await run((press) => prevented.push(press(mod(init)).defaultPrevented))
		expect(fired).toEqual([actionId])
		expect(prevented).toEqual([true])
	})

	test("the hotkeys fire while typing in the composer", async () => {
		const editable = document.createElement("div")
		editable.contentEditable = "true"
		document.body.append(editable)
		const fired = await run((press) => press(mod({ key: "k" }), editable))
		editable.remove()
		expect(fired).toEqual(["commandPalette.open"])
	})

	test("the plain letters do nothing", async () => {
		expect(await run((press) => press({ key: "k" }))).toEqual([])
	})

	test.todo("Mod+/ shows the keyboard shortcuts (Discord, Slack)")
	test.todo("Alt+ArrowUp / Alt+ArrowDown go to the previous / next channel (Discord, Slack)")
	test.todo(
		"Alt+Shift+ArrowUp / Alt+Shift+ArrowDown go to the previous / next unread channel (Discord, Slack)",
	)
	test.todo("Mod+[ / Mod+] go back / forward (Slack)")
	test.todo("Escape on a channel marks it read; Shift+Escape marks everything read (Discord, Slack)")
	test.todo("Mod+Shift+D toggles the sidebar (Slack; Mod+B is the composer's bold)")
})
