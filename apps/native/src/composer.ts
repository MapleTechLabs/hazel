/**
 * The composer on Rune: Hazel's real ProseMirror editor (its keymaps, autocomplete and markdown)
 * runs on a headless DOM inside the runtime, and the host draws a native text field over it.
 * Edits arrive as whole-text replacements and keys go through the editor's own key handlers.
 */
import { Effect, Option } from "effect"
import { TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { editorRegistry } from "../../web-foldkit/src/editor/registry"
import { type HeadlessDom, makeHeadlessDom } from "./headless-dom"
import type { EditableEvent } from "./pending-edits"
import {
	caretOf,
	type FieldChange,
	fieldTextChange,
	isTyping,
	rebaseFieldEdit,
	replaceFieldText,
} from "./text-edit"

let dom: HeadlessDom | undefined
/** Each editor element's Mount path: the host keys the editor's native field by it. */
const editorPaths = new WeakMap<object, string>()

/**
 * Starts the headless DOM and routes element creation and `instanceof Element` to it; `onReady`
 * re-commits so the editor Mount can start.
 */
export const loadHeadlessDom = (
	globals: Readonly<{ document: object; shims: ReadonlyArray<unknown> }>,
	onReady: () => void,
	onEditorFocus: (path: string) => void,
) => {
	const loaded = makeHeadlessDom()
	dom = loaded
	const headless = loaded.document
	Object.assign(globals.document, {
		createElement: headless.createElement.bind(headless),
		createElementNS: headless.createElementNS.bind(headless),
		createTextNode: headless.createTextNode.bind(headless),
		createDocumentFragment: headless.createDocumentFragment.bind(headless),
	})
	// Foldkit's Mount hooks check `instanceof Element`: accept the headless DOM's elements too.
	const DomElement = loaded.Element
	for (const shim of new Set(globals.shims)) {
		if (typeof shim !== "function") continue
		Object.defineProperty(shim, Symbol.hasInstance, {
			value: (value: unknown) =>
				Function.prototype[Symbol.hasInstance].call(shim, value) || value instanceof DomElement,
		})
	}
	// An editor focusing itself (`view.focus()`: the composer opening, a key typed outside it) takes
	// the keyboard as in a browser, so the native field drawn over it must. The headless DOM neither
	// focuses a contenteditable nor fires an event for it, so the call itself is the signal.
	const HTMLElement = loaded.HTMLElement
	const focus = HTMLElement.prototype.focus
	HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
		focus.call(this, options)
		for (let node: Node | null = this; node !== null; node = node.parentNode) {
			const path = editorPaths.get(node)
			if (path !== undefined) return onEditorFocus(path)
		}
	}
	onReady()
}

/** The element the editor Mount attaches ProseMirror to, once the headless DOM has loaded. */
export const makeEditorElement = (path: string) => {
	if (dom === undefined) return undefined
	const element = dom.document.createElement("div")
	dom.document.body.appendChild(element)
	editorPaths.set(element, path)
	return element
}

/** The mounted editor, if any: `get` waits for one otherwise, so only a synchronous answer counts. */
const editorAt = (editorId: unknown): Option.Option<EditorView> => {
	if (typeof editorId !== "string") return Option.none()
	const exit = Effect.runSyncExit(editorRegistry.get(editorId))
	return exit._tag === "Success" ? Option.some(exit.value) : Option.none()
}

const textOf = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, "\n")

export const editorText = (args: Record<string, unknown>): string | undefined =>
	Option.match(editorAt(args.editorId), { onNone: () => undefined, onSome: textOf })

/** The editor's caret as an offset in `editorText` (UTF-16 code units), when its selection is one. */
export const editorCaret = (args: Record<string, unknown>): number | undefined =>
	Option.match(editorAt(args.editorId), {
		onNone: () => undefined,
		onSome: (view) => {
			const caret = caretOf(view.state)
			return caret === undefined ? undefined : view.state.doc.textBetween(0, caret, "\n").length
		},
	})

/**
 * Typing goes through the editor's own input path first, as a browser's does: `@`, `#` and `:`
 * open their autocomplete there, and `1. ` or `> ` turn the line into a list or a quote.
 * Whether the editor took it.
 */
const typeIntoEditor = (view: EditorView, change: FieldChange) => {
	if (!isTyping(change)) return false
	const { selection } = view.state
	if (!selection.empty || selection.from !== change.from)
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, change.from)))
	return (
		view.someProp("handleTextInput", (handle) =>
			handle(view, change.from, change.to, change.text, () => view.state.tr),
		) ?? false
	)
}

export const applyEditorEvent = (args: Record<string, unknown>, event: EditableEvent) =>
	Option.map(editorAt(args.editorId), (view) => {
		const before = view.state.doc
		if (event.value != null) {
			// The field's own change, made on the editor's text when the editor moved on from what
			// the field showed (it had not taken a list or a mention yet when the user typed on).
			const value =
				event.before == null
					? event.value
					: (rebaseFieldEdit(event.before, event.value, textOf(view)) ?? event.value)
			const change = fieldTextChange(view.state.doc, value, caretOf(view.state))
			if (change !== undefined && !typeIntoEditor(view, change)) {
				const edit = replaceFieldText(view.state, value)
				if (edit !== undefined) view.dispatch(edit)
			}
		}
		if (event.key != null && dom !== undefined) {
			const keydown = dom.keydown(event.key)
			view.someProp("handleKeyDown", (handle) => handle(view, keydown))
		}
		/**
		 * Whether the native field must take the editor's text again: a key changed it, or the
		 * editor's input path made it other than the field's (a list marker it turned into a list).
		 */
		return event.key != null
			? !view.state.doc.eq(before)
			: event.value != null && textOf(view) !== event.value
	})
