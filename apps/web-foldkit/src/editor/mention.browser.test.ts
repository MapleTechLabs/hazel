import "../styles.css"
import type { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, test } from "vitest"
import { userEvent } from "vitest/browser"
import { createComposerEditor, insertMention } from "./editor-view"
import { blocksOf, serializeToMarkdown } from "./markdown"

/**
 * Mentions laid out with the app's stylesheet. A mention that ends a line makes ProseMirror append
 * an `<img class="ProseMirror-separator">`, which Tailwind's preflight turns into a block, pushing
 * the caret onto a line of its own.
 */

let view: EditorView | null = null
afterEach(() => {
	view?.destroy()
	view = null
	document.body.innerHTML = ""
})

const mount = () => {
	const element = document.createElement("div")
	element.style.width = "600px"
	document.body.append(element)
	const editor = createComposerEditor(element, {
		placeholder: "Type a message...",
		initialMarkdown: "",
		listboxId: "composer-autocomplete",
		emit: () => {},
	})
	view = editor
	editor.focus()
	const paragraph = () => editor.dom.querySelector("p") as HTMLElement
	return {
		view: editor,
		markdown: () => serializeToMarkdown(blocksOf(editor.state.doc)),
		height: () => paragraph().getBoundingClientRect().height,
		separator: () => editor.dom.querySelector<HTMLElement>("img.ProseMirror-separator"),
	}
}

describe("mentions in a real browser", () => {
	test("a mention at the end of the line keeps the caret on that line", async () => {
		const editor = mount()
		await userEvent.keyboard("hello @da")
		const oneLine = editor.height()
		insertMention(editor.view, "user-1", "David")

		// The mention's padding makes its line a little taller; a second line would double it.
		expect(Math.round(editor.height() / oneLine)).toBe(1)
		expect(editor.separator()).not.toBeNull()
		expect(getComputedStyle(editor.separator() as HTMLElement).display).toBe("inline")
	})

	test("typing after a mention continues on the same line", async () => {
		const editor = mount()
		await userEvent.keyboard("hello @da")
		const oneLine = editor.height()
		insertMention(editor.view, "user-1", "David")
		await userEvent.keyboard(" there")

		expect(editor.markdown()).toBe("hello @[userId:user-1] there")
		// The mention's padding makes its line a little taller; a second line would double it.
		expect(Math.round(editor.height() / oneLine)).toBe(1)
	})
})
