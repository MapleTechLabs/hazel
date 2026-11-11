/**
 * The composer on Rune: Hazel's real ProseMirror editor (its keymaps, autocomplete and markdown)
 * runs on a headless DOM inside the runtime, and the host draws a native text field over it.
 * Edits arrive as whole-text replacements and keys go through the editor's own key handlers.
 */
import type { JSDOM } from "jsdom"
import { Effect, Option } from "effect"
import type { EditorView } from "prosemirror-view"
import { editorRegistry } from "../../web-foldkit/src/editor/registry"
import { replaceFieldText } from "./text-edit"

let dom: JSDOM | undefined
/** Each editor element's Mount path: the host keys the editor's native field by it. */
const editorPaths = new WeakMap<object, string>()

/**
 * Loads the headless DOM off the boot path (it costs ~130 ms) and routes element creation and
 * `instanceof Element` to it; `onReady` re-commits so the editor Mount can start.
 */
export const loadHeadlessDom = async (
	jsdom: () => Promise<typeof import("jsdom")>,
	globals: Readonly<{ document: object; shims: ReadonlyArray<unknown> }>,
	onReady: () => void,
	onEditorFocus: (path: string) => void,
) => {
	const { JSDOM } = await jsdom()
	const loaded = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true })
	dom = loaded
	const headless = loaded.window.document
	Object.assign(globals.document, {
		createElement: headless.createElement.bind(headless),
		createElementNS: headless.createElementNS.bind(headless),
		createTextNode: headless.createTextNode.bind(headless),
		createDocumentFragment: headless.createDocumentFragment.bind(headless),
	})
	// Foldkit's Mount hooks check `instanceof Element`: accept the headless DOM's elements too.
	const DomElement = loaded.window.Element
	for (const shim of new Set(globals.shims)) {
		if (typeof shim !== "function") continue
		Object.defineProperty(shim, Symbol.hasInstance, {
			value: (value: unknown) =>
				Function.prototype[Symbol.hasInstance].call(shim, value) || value instanceof DomElement,
		})
	}
	// An editor focusing itself (`view.focus()`: the composer opening, a key typed outside it) takes
	// the keyboard as in a browser, so the native field drawn over it must. jsdom neither focuses a
	// contenteditable nor fires an event for it, so the call itself is the signal.
	const HTMLElement = loaded.window.HTMLElement
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
	const element = dom.window.document.createElement("div")
	dom.window.document.body.appendChild(element)
	editorPaths.set(element, path)
	return element
}

/** The mounted editor, if any: `get` waits for one otherwise, so only a synchronous answer counts. */
const editorAt = (editorId: unknown): Option.Option<EditorView> => {
	if (typeof editorId !== "string") return Option.none()
	const exit = Effect.runSyncExit(editorRegistry.get(editorId))
	return exit._tag === "Success" ? Option.some(exit.value) : Option.none()
}

export const editorText = (args: Record<string, unknown>): string | undefined =>
	Option.match(editorAt(args.editorId), {
		onNone: () => undefined,
		onSome: (view) => view.state.doc.textBetween(0, view.state.doc.content.size, "\n"),
	})

export const applyEditorEvent = (
	args: Record<string, unknown>,
	event: { readonly value?: string | null; readonly key?: string | null },
) =>
	Option.map(editorAt(args.editorId), (view) => {
		const { state } = view
		const before = state.doc
		if (event.value != null) {
			const edit = replaceFieldText(state, event.value)
			if (edit !== undefined) view.dispatch(edit)
		}
		if (event.key != null && dom !== undefined) {
			const keydown = new dom.window.KeyboardEvent("keydown", {
				key: event.key,
				bubbles: true,
				cancelable: true,
			})
			view.someProp("handleKeyDown", (handle) => handle(view, keydown))
		}
		/** Whether the editor's document changed, so the native field must take its text again. */
		return event.key != null && !view.state.doc.eq(before)
	})
