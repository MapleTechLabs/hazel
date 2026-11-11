import type { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, test } from "vitest"
import { userEvent } from "vitest/browser"
import { createComposerEditor, type EditorEvent } from "./editor-view"
import { blocksOf, serializeToMarkdown } from "./markdown"

/**
 * The edits the composer leaves to the browser (plain Backspace, word and line deletes, deleting a
 * selection), typed for real in Chromium: jsdom performs none of them. `keyboard.test.ts` covers the
 * keys the editor handles itself.
 */

let view: EditorView | null = null
afterEach(() => {
	view?.destroy()
	view = null
	document.body.innerHTML = ""
})

const isMac = /Mac/.test(navigator.platform)
const mod = isMac ? "Meta" : "Control"

const mount = (initialMarkdown = "") => {
	const element = document.createElement("div")
	document.body.append(element)
	const events: Array<EditorEvent> = []
	const editor = createComposerEditor(element, {
		placeholder: "Type a message...",
		initialMarkdown,
		listboxId: "composer-autocomplete",
		emit: (event) => events.push(event),
	})
	view = editor
	editor.focus()
	return {
		markdown: () => serializeToMarkdown(blocksOf(editor.state.doc)),
		submitted: () => events.filter((event) => event._tag === "Submitted"),
	}
}

describe("deleting in a real browser", () => {
	test("Backspace removes one character at a time", async () => {
		const editor = mount()
		await userEvent.keyboard("hello")
		await userEvent.keyboard("{Backspace}")
		expect(editor.markdown()).toBe("hell")
		await userEvent.keyboard("{Backspace}{Backspace}")
		expect(editor.markdown()).toBe("he")
	})

	test("Backspace through highlighted markdown removes one character at a time", async () => {
		const editor = mount()
		await userEvent.keyboard("hello **bold** [[link](https://x.com)")
		await userEvent.keyboard("{Backspace}")
		expect(editor.markdown()).toBe("hello **bold** [link](https://x.com")
		for (let index = 0; index < 21; index++) await userEvent.keyboard("{Backspace}")
		expect(editor.markdown()).toBe("hello **bold**")
		await userEvent.keyboard("{Backspace}")
		expect(editor.markdown()).toBe("hello **bold*")
	})

	test("Backspace then typing keeps going", async () => {
		const editor = mount()
		await userEvent.keyboard("helo{Backspace}lo")
		expect(editor.markdown()).toBe("hello")
	})

	test("Alt+Backspace deletes the previous word", async () => {
		const editor = mount()
		await userEvent.keyboard("one two three")
		await userEvent.keyboard(isMac ? "{Alt>}{Backspace}{/Alt}" : "{Control>}{Backspace}{/Control}")
		expect(editor.markdown()).toBe("one two ")
	})

	test("Mod+A then Backspace clears the composer, and typing starts over", async () => {
		const editor = mount()
		await userEvent.keyboard("first line{Shift>}{Enter}{/Shift}second line")
		await userEvent.keyboard(`{${mod}>}a{/${mod}}{Backspace}`)
		expect(editor.markdown()).toBe("")
		await userEvent.keyboard("fresh")
		expect(editor.markdown()).toBe("fresh")
	})

	test("Shift+ArrowLeft then Delete removes only the selection", async () => {
		const editor = mount()
		await userEvent.keyboard("hello world")
		await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}")
		// A separate press, as a person's would be: the editor reads the new selection on `selectionchange`.
		await userEvent.keyboard("{Delete}")
		expect(editor.markdown()).toBe("hello wo")
	})

	test("typing over a selection that spans lines replaces it", async () => {
		const editor = mount()
		await userEvent.keyboard("one{Shift>}{Enter}{/Shift}two")
		await userEvent.keyboard(`{${mod}>}a{/${mod}}`)
		await userEvent.keyboard("x")
		expect(editor.markdown()).toBe("x")
	})

	test("Mod+B wraps the word just typed when it is selected", async () => {
		const editor = mount()
		await userEvent.keyboard("make it loud")
		await userEvent.keyboard("{Shift>}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{/Shift}")
		await userEvent.keyboard(`{${mod}>}b{/${mod}}`)
		expect(editor.markdown()).toBe("make it **loud**")
	})

	test("Enter sends what was typed, Shift+Enter does not", async () => {
		const editor = mount()
		await userEvent.keyboard("one{Shift>}{Enter}{/Shift}two")
		expect(editor.submitted()).toEqual([])
		await userEvent.keyboard("{Enter}")
		expect(editor.submitted()).toEqual([{ _tag: "Submitted", markdown: "one\ntwo" }])
	})
})
