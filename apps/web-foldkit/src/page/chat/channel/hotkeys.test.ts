// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import { collectKeyStream } from "../../../test/key-stream"
import { channelHotkeysStream } from "./hotkeys"

/** The channel page's Discord keys from real `keydown`s: from the composer, and while a dialog is open. */

const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
const mod = (init: KeyboardEventInit): KeyboardEventInit =>
	isMac ? { ...init, metaKey: true } : { ...init, ctrlKey: true }
const run = (act: Parameters<typeof collectKeyStream>[1], isDialogOpen = false) =>
	collectKeyStream(
		channelHotkeysStream((action) => action, { isDialogOpen }),
		act,
	)

// jsdom has no `isContentEditable`, which the bindings read to tell typing apart (browsers have it).
if (!("isContentEditable" in HTMLElement.prototype))
	Object.defineProperty(HTMLElement.prototype, "isContentEditable", {
		get(this: HTMLElement) {
			return this.getAttribute("contenteditable") === "true"
		},
	})

const composer = () => {
	const editable = document.createElement("div")
	editable.setAttribute("contenteditable", "true")
	document.body.append(editable)
	return editable
}

describe("channel hotkeys", () => {
	test("from the composer: the pickers, upload, pins and the page keys; plain Escape is the editor's", async () => {
		const editable = composer()
		const fired = await run((press) => {
			press(mod({ key: "e" }), editable)
			press(mod({ key: "g" }), editable)
			press(mod({ key: "U", shiftKey: true }), editable)
			press(mod({ key: "p" }), editable)
			press({ key: "PageUp" }, editable)
			press({ key: "PageDown" }, editable)
			press({ key: "Escape" }, editable)
		})
		editable.remove()
		expect(fired).toEqual(["EmojiPicker", "GifPicker", "Upload", "Pins", "ScrollUp", "ScrollDown"])
	})

	test("Escape outside a field marks the channel read and leaves the event to others", async () => {
		const prevented: Array<boolean> = []
		const fired = await run((press) => prevented.push(press({ key: "Escape" }).defaultPrevented))
		expect(fired).toEqual(["MarkRead"])
		expect(prevented).toEqual([false])
	})

	test("while a picker or menu is open only the toggles stay bound", async () => {
		const fired = await run((press) => {
			press({ key: "PageDown" })
			press({ key: "Escape" })
			press(mod({ key: "U", shiftKey: true }))
			press(mod({ key: "e" }))
		}, true)
		expect(fired).toEqual(["EmojiPicker"])
	})
})
