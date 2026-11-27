// @vitest-environment happy-dom
/** Lane A2 (W12b): the composer's editor in happy-dom: markdown, atoms, triggers and Model edits. */
import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, it } from "vitest"
import type { Plain, Primitive } from "../../../define.ts"
import { primitive as composer } from "../../composer.ts"
import { editorOf } from "../editor.ts"
import { fromMarkdown, toMarkdown, trustCustomEmojiBase } from "../markdown.ts"

// Views mounted by a test, destroyed after it so ProseMirror's observer timers never outlive the DOM.
const mounted: Array<EditorView> = []

const mount = (props: Readonly<Record<string, Plain>>, on: ReadonlyArray<string>) => {
	const made: Primitive = composer.create({
		document,
		tag: "hz:composer",
		outer: (tagName) => {
			const node = document.createElement(tagName)
			node.dataset.hz = "composer"
			return node
		},
		self: (node, set) => ({ tag: "hz:composer", outer: node, content: node, set, events: undefined }),
	})
	const fired: Array<readonly [string, Plain]> = []
	made.events = {
		handlers: Object.fromEntries(on.map((name) => [name, name])),
		dispatch: (event, _handler, payload) => {
			fired.push([event, payload])
			return true
		},
	}
	for (const [name, value] of Object.entries(props)) made.set(name, value)
	document.body.append(made.outer)
	const input = made.outer.querySelector<HTMLElement>("[data-hz-part=input]")!
	const view = editorOf(input)!
	mounted.push(view)
	return { node: made.outer, fired, set: made.set, input, view }
}

/** Typed text through the editor's own input path, so triggers and autoformat run as in a browser. */
const type = (view: EditorView, text: string) => {
	for (const character of text) {
		const { from, to } = view.state.selection
		const handled = view.someProp("handleTextInput", (handle) =>
			handle(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
		)
		if (handled !== true) view.dispatch(view.state.tr.insertText(character, from, to))
	}
}

const key = (target: Element, init: KeyboardEventInit) => {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
	target.dispatchEvent(event)
	return event
}

afterEach(() => {
	for (const view of mounted.splice(0)) view.destroy()
	document.body.replaceChildren()
	trustCustomEmojiBase(undefined)
})

describe("composer markdown", () => {
	it("round-trips blocks, blank lines and atoms", () => {
		const text = [
			"Hi @[userId:u1] and @[directive:here]",
			"",
			"> quoted",
			"```ts",
			"const a = 1",
			"```",
			"-# small",
			"- item",
			"3. third",
			"@[group:design] ![custom-emoji:tanuki](data:image/png;base64,AA==)",
		].join("\n")
		expect(toMarkdown(fromMarkdown(text))).toBe(text)
		expect(toMarkdown(fromMarkdown(""))).toBe("")
	})

	it("keeps only trusted custom emoji as atoms", () => {
		const untrusted = "![custom-emoji:party](https://evil.example/emojis/party.png)"
		expect(toMarkdown(fromMarkdown(untrusted))).toBe(":party:")
		trustCustomEmojiBase("https://cdn.example/")
		expect(toMarkdown(fromMarkdown("![custom-emoji:party](https://cdn.example/emojis/party.png)"))).toBe(
			"![custom-emoji:party](https://cdn.example/emojis/party.png)",
		)
		expect(toMarkdown(fromMarkdown(untrusted))).toBe(":party:")
	})
})

describe("hz:composer editor", () => {
	it("reports typing as revisioned changes and highlights markdown in the text", () => {
		const { view, fired, input } = mount({ placeholder: "Message #general" }, ["change"])
		expect(input.getAttribute("role")).toBe("textbox")
		expect(input.getAttribute("aria-label")).toBe("Message #general")
		expect(input.querySelector("[data-hz-part=placeholder]")?.textContent).toBe("Message #general")
		type(view, "so **bold** and `code`")
		expect(fired.at(-1)).toEqual(["change", { value: "so **bold** and `code`", rev: 22, edit: 0 }])
		expect(input.querySelector("[data-hz-part=placeholder]")).toBeNull()
		const styled = [...input.querySelectorAll<HTMLElement>("[data-hz-md]")].map(
			(leaf) => `${leaf.dataset.hzMd}:${leaf.textContent}`,
		)
		expect(styled).toEqual(["marker:**", "bold:bold", "marker:**", "marker:`", "code:code", "marker:`"])
	})

	it("turns a block prefix into its block and serializes it back", () => {
		const { view, fired } = mount({}, ["change"])
		type(view, "> hi")
		expect(view.state.doc.firstChild?.type.name).toBe("blockquote")
		expect(fired.at(-1)?.[1]).toMatchObject({ value: "> hi" })
	})

	it("opens each trigger where today's rules allow it, and closes it", () => {
		const { view, fired } = mount({}, ["trigger", "change"])
		const triggers = () => fired.filter(([event]) => event === "trigger").map(([, payload]) => payload)
		type(view, "mail@x")
		expect(triggers()).toEqual([])
		type(view, " @ma")
		expect(triggers()).toEqual([
			{ kind: "@", query: "" },
			{ kind: "@", query: "m" },
			{ kind: "@", query: "ma" },
		])
		type(view, " ")
		expect(triggers().at(-1)).toEqual({ kind: "@", query: null })
		type(view, "#gen :ta")
		expect(triggers().slice(-8)).toEqual([
			{ kind: "#", query: "" },
			{ kind: "#", query: "g" },
			{ kind: "#", query: "ge" },
			{ kind: "#", query: "gen" },
			{ kind: "#", query: null },
			{ kind: ":", query: "" },
			{ kind: ":", query: "t" },
			{ kind: ":", query: "ta" },
		])
		type(view, ":")
		expect(triggers().at(-1)).toEqual({ kind: ":", query: null })
		// A command is only at the start of its line.
		type(view, " /gif")
		expect(triggers().at(-1)).toEqual({ kind: ":", query: null })
	})

	it("opens `/` at the start of a line", () => {
		const { view, fired } = mount({}, ["trigger"])
		type(view, "/gi")
		expect(fired.at(-1)).toEqual(["trigger", { kind: "/", query: "gi" }])
	})

	it("routes keys to showing suggestions only, and sends on Enter when it can", () => {
		const { view, fired, set, input } = mount({}, ["trigger", "key", "submit", "change"])
		type(view, "hi @ma")
		// No suggestions showing: Enter does not go to them (and cannot send yet).
		expect(key(input, { key: "Enter" }).defaultPrevented).toBe(true)
		expect(fired.some(([event]) => event === "key" || event === "submit")).toBe(false)
		set("suggestions", [{ id: "u1", label: "Maya Chen" }])
		expect(key(input, { key: "ArrowDown" }).defaultPrevented).toBe(true)
		expect(fired.at(-1)).toEqual(["key", { key: "down" }])
		key(input, { key: "Escape" })
		expect(fired.at(-1)).toEqual(["trigger", { kind: "@", query: null }])
		set("suggestions", [])
		set("canSend", true)
		key(input, { key: "Enter" })
		expect(fired.at(-1)).toEqual(["submit", { value: "hi @ma", rev: 6, edit: 0 }])
		key(input, { key: "Enter", shiftKey: true })
		expect(toMarkdown(view.state.doc)).toBe("hi @ma\n")
	})

	it("applies a Model edit in place: the mention atom lands with its name and the caret after it", () => {
		const { view, fired, set, input } = mount({}, ["trigger", "change", "pressSuggestion"])
		type(view, "Thanks @ma")
		set("suggestions", [{ id: "u1", label: "Maya Chen", face: { name: "Maya Chen", initials: "MC" } }])
		// The screen answers the press with the trigger text replaced (a Model edit) and no suggestions.
		set("suggestions", [])
		set("value", { text: "Thanks @[userId:u1] ", rev: 10, edit: 1 })
		const mention = input.querySelector<HTMLElement>("[data-hz-part=mention]")!
		expect(mention.textContent).toBe("@Maya Chen")
		expect(mention.contentEditable).toBe("false")
		expect(fired.filter(([event]) => event === "trigger").at(-1)).toEqual([
			"trigger",
			{ kind: "@", query: null },
		])
		type(view, "hi")
		expect(fired.at(-1)).toEqual(["change", { value: "Thanks @[userId:u1] hi", rev: 12, edit: 1 }])
		// Backspace right after the atom removes it in one step (plain Backspace is the browser's).
		const after = view.state.doc.resolve(1).start() + "Thanks ".length + 1
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, after)))
		expect(key(input, { key: "Backspace" }).defaultPrevented).toBe(true)
		expect(toMarkdown(view.state.doc)).toBe("Thanks  hi")
	})

	it("draws a custom emoji atom from a Model edit", () => {
		const url = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'/%3E"
		const { set, input } = mount({}, ["change"])
		set("value", { text: `Ship it ![custom-emoji:tanuki](${url})`, rev: 0, edit: 1 })
		const image = input.querySelector<HTMLImageElement>("img[data-hz-part=customEmoji]")!
		expect(image.getAttribute("src")).toBe(url)
		expect(image.alt).toBe(":tanuki:")
	})

	it("does not reparse an echo, so empty lines being typed survive it", () => {
		const { view, set, fired, input } = mount({}, ["change"])
		type(view, "a")
		key(input, { key: "Enter", shiftKey: true })
		key(input, { key: "Enter", shiftKey: true })
		const change = fired.at(-1)![1] as { value: string; rev: number; edit: number }
		expect(change.value).toBe("a\n\n")
		set("value", { text: change.value, rev: change.rev, edit: change.edit })
		expect(view.state.doc.childCount).toBe(3)
		expect(view.state.selection.from).toBe(view.state.doc.content.size - 1)
	})

	it("disables the editor", () => {
		const { set, input } = mount({}, [])
		set("disabled", true)
		expect(input.getAttribute("contenteditable")).toBe("false")
		expect(input.getAttribute("aria-disabled")).toBe("true")
		set("disabled", false)
		expect(input.getAttribute("contenteditable")).toBe("true")
	})
})
