import { Schema } from "prosemirror-model"
import { EditorState, TextSelection } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { afterEach, describe, expect, it, vi } from "vitest"
import { makeHeadlessDom } from "./headless-dom"

const schema = new Schema({
	nodes: {
		doc: { content: "paragraph+" },
		paragraph: { content: "text*", toDOM: () => ["p", 0] },
		text: {},
	},
})

afterEach(() => vi.unstubAllGlobals())

const mount = () => {
	const dom = makeHeadlessDom()
	// The runtime's shims define a global `window` and `document`, which ProseMirror reads in places.
	vi.stubGlobal("window", globalThis)
	vi.stubGlobal("document", dom.document)
	const element = dom.document.createElement("div")
	dom.document.body.appendChild(element)
	const keys: Array<string> = []
	const view = new EditorView(element, {
		state: EditorState.create({ schema }),
		handleKeyDown: (_, event) => {
			keys.push(event.key)
			return event.key === "Enter"
		},
	})
	return { dom, element, view, keys }
}

describe("the headless DOM", () => {
	it("runs ProseMirror's view: edits render into it and clearing selects the empty document", () => {
		const { element, view } = mount()
		view.dispatch(view.state.tr.insertText("Sent from iOS"))
		expect(element.textContent).toBe("Sent from iOS")
		// The composer clears the editor after a send, selection and all.
		const cleared = view.state.tr.delete(0, view.state.doc.content.size)
		view.dispatch(cleared.setSelection(TextSelection.create(cleared.doc, 1)))
		expect(view.state.doc.textContent).toBe("")
		view.focus()
		view.destroy()
	})

	it("hands a keydown to the editor's key handlers", () => {
		const { dom, view, keys } = mount()
		const handled = view.someProp("handleKeyDown", (handle) => handle(view, dom.keydown("Enter")))
		expect(handled).toBe(true)
		expect(keys).toEqual(["Enter"])
	})
})
