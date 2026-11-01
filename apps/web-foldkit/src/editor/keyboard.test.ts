// @vitest-environment jsdom
import { TextSelection } from "prosemirror-state"
import { afterEach, describe, expect, test } from "vitest"
import { type EditorHarness, makeEditor } from "../test/editor-harness"
import { syncAutocompleteOptions } from "./editor-view"

/**
 * The composer's keyboard, key by key, against what Discord and Slack do. Native edits the editor
 * leaves to the browser (`handled: false`) are covered for real in `editing.browser.test.ts`.
 */

let editor: EditorHarness | null = null
const open = (markdown = "") => {
	editor = makeEditor(markdown)
	return editor
}
afterEach(() => {
	editor?.destroy()
	editor = null
})

describe("Backspace and Delete", () => {
	test("Backspace mid-text is left to the browser: it removes one character, not the text", () => {
		const e = open("hello world")
		e.caretAtEnd()
		expect(e.press("Backspace")).toBe(false)
		expect(e.markdown()).toBe("hello world")
	})

	test("Backspace after markdown leaves the line alone (the editor never deletes a whole text run)", () => {
		const e = open("hello **bold** world")
		e.caretAfter("**bold**")
		expect(e.press("Backspace")).toBe(false)
		expect(e.markdown()).toBe("hello **bold** world")
	})

	test("Delete mid-text is left to the browser", () => {
		const e = open("hello world")
		e.caretBefore("world")
		expect(e.press("Delete")).toBe(false)
		expect(e.markdown()).toBe("hello world")
	})

	test.each(["Backspace", "Delete"])("%s with a selection removes only the selection", (key) => {
		const e = open("hello world")
		e.select("wor")
		expect(e.press(key)).toBe(true)
		expect(e.markdown()).toBe("hello ld")
	})

	test("Backspace over a selection spanning lines joins what is left", () => {
		const e = open("one")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.type("two")
		const { view } = e
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 8)))
		expect(e.press("Backspace")).toBe(true)
		expect(e.markdown()).toBe("ono")
	})

	test("Alt+Backspace and Mod+Backspace (word, line) are left to the browser", () => {
		const e = open("hello world")
		e.caretAtEnd()
		expect(e.press("Backspace", { alt: true })).toBe(false)
		expect(e.press("Backspace", { mod: true })).toBe(false)
		expect(e.markdown()).toBe("hello world")
	})

	test("Backspace right after a mention removes the whole chip", () => {
		const e = open("hi ")
		e.caretAtEnd()
		e.insertMention("grace")
		expect(e.markdown()).toBe("hi @[userId:user-grace]")
		expect(e.press("Backspace")).toBe(true)
		expect(e.markdown()).toBe("hi ")
	})

	test("Delete right before a mention removes the whole chip", () => {
		const e = open("hi @[userId:grace] there")
		e.caretAfter("hi ")
		expect(e.press("Delete")).toBe(true)
		expect(e.markdown()).toBe("hi  there")
	})

	test.each([
		["> quoted", "blockquote", "quoted"],
		["- item", "list-item", "item"],
		["1. first", "list-item", "first"],
		["-# small", "subtext", "small"],
	])("Backspace at the start of %j turns it back into text, keeping the text", (markdown, type, text) => {
		const e = open(markdown)
		expect(e.blocks()).toEqual([type])
		e.caretAtStart()
		expect(e.press("Backspace")).toBe(true)
		expect(e.blocks()).toEqual(["paragraph"])
		expect(e.markdown()).toBe(text)
	})

	test("Backspace at the start of a code block turns it back into text", () => {
		const e = open("```\nconst a = 1\n```")
		e.caretAtStart()
		expect(e.press("Backspace")).toBe(true)
		expect(e.blocks()).toEqual(["paragraph"])
		expect(e.markdown()).toBe("const a = 1")
	})

	test("Backspace at the start of the second line joins it to the first", () => {
		const e = open("one")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.type("two")
		e.caretBefore("two")
		expect(e.press("Backspace")).toBe(true)
		expect(e.markdown()).toBe("onetwo")
	})

	test("Backspace at the very start of an empty composer does nothing", () => {
		const e = open("")
		e.caretAtStart()
		e.press("Backspace")
		expect(e.markdown()).toBe("")
	})
})

describe("Select all", () => {
	test("Mod+A selects everything", () => {
		const e = open("one")
		e.caretAtEnd()
		expect(e.press("a", { mod: true })).toBe(true)
		expect(e.isAllSelected()).toBe(true)
	})

	test("keys after Mod+A still work: Enter sends", () => {
		const e = open("hello")
		e.press("a", { mod: true })
		expect(() => e.press("Enter")).not.toThrow()
		expect(e.events()).toEqual([{ _tag: "Submitted", markdown: "hello" }])
	})

	test("Backspace after Mod+A clears everything, across lines, and the placeholder can return", () => {
		const e = open("> quoted")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.press("Enter", { shift: true })
		e.type("text")
		e.press("a", { mod: true })
		expect(e.press("Backspace")).toBe(true)
		expect(e.markdown()).toBe("")
		expect(e.blocks()).toHaveLength(1)
	})

	test("pasting over Mod+A replaces everything", () => {
		const e = open("hello")
		e.press("a", { mod: true })
		e.paste("replaced")
		expect(e.markdown()).toBe("replaced")
	})

	test("in a code block the first Mod+A selects the block, a second everything", () => {
		const e = open("before\n```\ncode\n```")
		e.caretAfter("co")
		e.press("a", { mod: true })
		expect(e.selectedText()).toBe("code")
		e.press("a", { mod: true })
		expect(e.isAllSelected()).toBe(true)
	})
})

describe("Enter and Shift+Enter", () => {
	test("Enter sends the draft", () => {
		const e = open("ship it")
		e.caretAtEnd()
		expect(e.press("Enter")).toBe(true)
		expect(e.events()).toEqual([{ _tag: "Submitted", markdown: "ship it" }])
	})

	test("Enter on an empty draft still reports it: the host decides (attachments)", () => {
		const e = open("")
		e.press("Enter")
		expect(e.events()).toEqual([{ _tag: "Submitted", markdown: "" }])
	})

	test("Enter while an input method is composing does not send", () => {
		const e = open("日本")
		e.caretAtEnd()
		expect(e.press("Enter", { composing: true })).toBe(false)
		expect(e.events()).toEqual([])
	})

	test("Shift+Enter adds a line and does not send", () => {
		const e = open("one")
		e.caretAtEnd()
		expect(e.press("Enter", { shift: true })).toBe(true)
		e.type("two")
		expect(e.markdown()).toBe("one\ntwo")
		expect(e.events()).toEqual([])
	})

	test("Shift+Enter in a list adds another item", () => {
		const e = open("- one")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.type("two")
		expect(e.markdown()).toBe("- one\n- two")
	})

	test("Shift+Enter on an empty list item ends the list", () => {
		const e = open("- one")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.press("Enter", { shift: true })
		e.type("after")
		expect(e.blocks()).toEqual(["list-item", "paragraph"])
		expect(e.markdown()).toBe("- one\nafter")
	})

	test("Enter in a quote sends it", () => {
		const e = open("> quoted")
		e.caretAtEnd()
		e.press("Enter")
		expect(e.events()).toEqual([{ _tag: "Submitted", markdown: "> quoted" }])
	})

	test("Shift+Enter in a quote adds a line inside the quote", () => {
		const e = open("> one")
		e.caretAtEnd()
		e.press("Enter", { shift: true })
		e.type("two")
		expect(e.markdown()).toBe("> one\n> two")
	})

	test("Enter in a code block adds a line; on an empty code block it leaves the block", () => {
		const e = open("```\nconst a = 1\n```")
		e.caretAtEnd()
		e.press("Enter")
		e.type("b")
		expect(e.markdown()).toBe("```\nconst a = 1\nb\n```")
		expect(e.events()).toEqual([])

		const empty = makeEditor("")
		empty.type("``` ")
		expect(empty.blocks()).toEqual(["code-block"])
		empty.press("Enter")
		expect(empty.blocks()).toEqual(["paragraph"])
		empty.destroy()
	})

	test("ArrowDown at the end of a code block steps out into a new line", () => {
		const e = open("```\ncode\n```")
		e.caretAtEnd()
		expect(e.press("ArrowDown")).toBe(true)
		e.type("after")
		expect(e.blocks()).toEqual(["code-block", "paragraph"])
	})

	test("ArrowUp at the start of a quote steps out above it", () => {
		const e = open("> quote")
		e.caretAtStart()
		expect(e.press("ArrowUp")).toBe(true)
		expect(e.blocks()).toEqual(["paragraph", "blockquote"])
	})
})

describe("Undo and redo", () => {
	test("Mod+Z undoes and Mod+Shift+Z / Mod+Y redo", () => {
		const e = open("")
		e.type("hello")
		expect(e.press("z", { mod: true })).toBe(true)
		expect(e.markdown()).toBe("")
		expect(e.press("z", { mod: true, shift: true })).toBe(true)
		expect(e.markdown()).toBe("hello")
		e.press("z", { mod: true })
		expect(e.press("y", { mod: true })).toBe(true)
		expect(e.markdown()).toBe("hello")
	})
})

describe("Formatting shortcuts", () => {
	test.each([
		["Mod+B", "b", {}, "**"],
		["Mod+I", "i", {}, "*"],
		["Mod+U", "u", {}, "__"],
		["Mod+Shift+X", "x", { shift: true }, "~~"],
	] as const)("%s wraps the selection in %j and keeps it selected", (_name, key, modifiers, marker) => {
		const e = open("make this loud")
		e.select("this")
		expect(e.press(key, { mod: true, ...modifiers })).toBe(true)
		expect(e.markdown()).toBe(`make ${marker}this${marker} loud`)
		expect(e.selectedText()).toBe("this")
	})

	test("pressing the shortcut again unwraps it", () => {
		const e = open("make this loud")
		e.select("this")
		e.press("b", { mod: true })
		e.press("b", { mod: true })
		expect(e.markdown()).toBe("make this loud")
	})

	test("with a caret, Mod+B inserts an empty pair and types inside it", () => {
		const e = open("")
		e.press("b", { mod: true })
		e.type("bold")
		expect(e.markdown()).toBe("**bold**")
	})

	test("inside a code block the shortcut does nothing (and the browser's bold is blocked)", () => {
		const e = open("```\ncode\n```")
		e.select("code")
		expect(e.press("b", { mod: true })).toBe(true)
		expect(e.markdown()).toBe("```\ncode\n```")
	})
})

describe("Markdown shortcuts while typing", () => {
	test.each([
		["> ", "blockquote"],
		["``` ", "code-block"],
		["- ", "list-item"],
		["* ", "list-item"],
		["1. ", "list-item"],
		["-# ", "subtext"],
	])("typing %j turns the line into a %s", (prefix, type) => {
		const e = open("")
		e.type(prefix)
		expect(e.blocks()).toEqual([type])
	})

	test("a prefix later in the line stays text", () => {
		const e = open("")
		e.type("a > b")
		expect(e.blocks()).toEqual(["paragraph"])
		expect(e.markdown()).toBe("a > b")
	})
})

describe("Composer keys the host handles", () => {
	test("ArrowUp in an empty composer asks to edit the last message", () => {
		const e = open("")
		expect(e.press("ArrowUp")).toBe(true)
		expect(e.events()).toEqual([{ _tag: "PressedArrowUpInEmpty" }])
	})

	test("ArrowUp with text moves the caret instead", () => {
		const e = open("hello")
		e.caretAtEnd()
		expect(e.press("ArrowUp")).toBe(false)
		expect(e.events()).toEqual([])
	})

	test("Escape is reported (cancel reply or edit)", () => {
		const e = open("hello")
		expect(e.press("Escape")).toBe(true)
		expect(e.events()).toEqual([{ _tag: "PressedEscape" }])
	})
})

describe("Autocomplete", () => {
	test.each([
		["@", "mention"],
		[":", "emoji"],
		["/", "command"],
	])("typing %j opens the %s picker and the search follows", (char, trigger) => {
		const e = open("")
		e.type(`${char}gr`)
		expect(e.autocomplete()).toEqual({
			_tag: "ChangedAutocomplete",
			autocomplete: { trigger, search: "gr" },
		})
	})

	test("/ only opens at the start of a line", () => {
		const e = open("")
		e.type("a/b")
		expect(e.autocomplete()).toBeUndefined()
	})

	test("@ inside a word (an email) does not open the picker", () => {
		const e = open("")
		e.type("me@x")
		expect(e.autocomplete()).toBeUndefined()
	})

	test("a space closes the mention picker", () => {
		const e = open("")
		e.type("@gr ")
		expect(e.autocomplete()).toEqual({ _tag: "ChangedAutocomplete", autocomplete: null })
	})

	test("Backspace over the trigger closes the picker", () => {
		const e = open("")
		e.type("@")
		e.view.dispatch(e.view.state.tr.delete(1, 2))
		expect(e.autocomplete()).toEqual({ _tag: "ChangedAutocomplete", autocomplete: null })
	})

	test.each(["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"])(
		"with options shown, %s goes to the picker, not the composer",
		(key) => {
			const e = open("")
			e.type("@gr")
			// The host reports how many options it shows.
			syncAutocompleteOptions(e.view, 2, "composer-option-0")
			expect(e.press(key)).toBe(true)
			expect(e.events()).toEqual([{ _tag: "PressedAutocompleteKey", key }])
		},
	)

	test("with no options shown, Enter sends instead of picking", () => {
		const e = open("")
		e.type("@nobody")
		e.press("Enter")
		expect(e.events()).toEqual([{ _tag: "Submitted", markdown: "@nobody" }])
	})

	test.todo("# opens a channel picker (Discord, Slack)")
	test.todo("typing the closing colon of :smile: turns it into the emoji (Discord, Slack)")
})

describe("Paste", () => {
	test("pasting several lines keeps them as lines", () => {
		const e = open("")
		expect(e.paste("one\ntwo")).toBe(true)
		expect(e.markdown()).toBe("one\ntwo")
	})

	test("pasting into a code block keeps the text as is", () => {
		const e = open("```\n\n```")
		e.caretAtStart()
		e.paste("a\n  b")
		expect(e.markdown()).toBe("```\na\n  b\n```")
	})

	test("pasting an image reports the file instead of text", () => {
		const e = open("")
		const png = new File(["x"], "shot.png", { type: "image/png" })
		expect(e.paste("", [png])).toBe(true)
		expect(e.events()).toEqual([{ _tag: "PastedFiles", files: [png] }])
	})

	test.todo("pasting a URL over selected text makes a link (Slack)")
})
