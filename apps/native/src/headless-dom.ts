/**
 * The headless DOM the composer's ProseMirror editor runs on: linkedom, plain JavaScript that
 * loads in Bun and in iOS's Web Worker alike, plus the few pieces of a browser's DOM the editor
 * reaches for that linkedom leaves out. The editor is never focused in this DOM (the native field
 * drawn over it is), so its selection stays a stand-in.
 */
import { parseHTML } from "linkedom"

export type HeadlessDom = {
	readonly document: Document
	readonly Element: typeof Element
	readonly HTMLElement: typeof HTMLElement
	/** A keydown for the editor's key handlers, which read only `key` and the modifiers. */
	readonly keydown: (key: string) => KeyboardEvent
}

/** A selection with no ranges, which is what a document nothing has focused reports. */
const emptySelection = () => ({
	rangeCount: 0,
	anchorNode: null,
	anchorOffset: 0,
	focusNode: null,
	focusOffset: 0,
	isCollapsed: true,
	type: "None",
	getRangeAt: () => {
		throw new RangeError("the headless selection has no ranges")
	},
	addRange: () => {},
	removeAllRanges: () => {},
	collapse: () => {},
	extend: () => {},
	empty: () => {},
	containsNode: () => false,
	toString: () => "",
})

export const makeHeadlessDom = (): HeadlessDom => {
	const { window, document } = parseHTML("<!doctype html><html><body></body></html>")
	// ProseMirror reads the selection from the document it is attached to (`view.root`).
	const selection = emptySelection()
	Object.assign(document, { getSelection: () => selection })
	Object.assign(window, { getSelection: () => selection })
	const { Event } = window
	// SAFETY: linkedom implements the DOM interfaces ProseMirror and the editor Mount use.
	const dom = { document, Element: window.Element, HTMLElement: window.HTMLElement } as unknown as Pick<
		HeadlessDom,
		"document" | "Element" | "HTMLElement"
	>
	return {
		...dom,
		keydown: (key) =>
			// SAFETY: the editor's handlers read only these fields of the event.
			Object.assign(new Event("keydown", { bubbles: true, cancelable: true }), {
				key,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				shiftKey: false,
				isComposing: false,
			}) as unknown as KeyboardEvent,
	}
}
