import { Schema as ProseMirrorSchema } from "prosemirror-model"
import { EditorState, Plugin, PluginKey, TextSelection } from "prosemirror-state"
import { Decoration, DecorationSet, EditorView } from "prosemirror-view"
import { cx } from "~/utils/cx"

/**
 * `SearchSlateEditor` as vanilla ProseMirror: one line of plain text, filter syntax highlighting
 * and the `from:` / `in:` / `has:` autocomplete trigger. Framework-free; `search-mount.ts` owns it.
 */

const schema = new ProseMirrorSchema({
	nodes: {
		doc: { content: "paragraph" },
		paragraph: {
			content: "text*",
			marks: "",
			toDOM: () => ["div", { "data-slate-node": "element", style: "position: relative;" }, 0],
		},
		text: {},
	},
})

/** Legacy `Editable` className, through the same `cn` arguments. */
const EDITABLE_CLASS = cx(
	"w-full truncate bg-transparent py-2 text-base text-fg outline-none sm:py-1.5 sm:text-sm [&_[data-slate-placeholder]]:truncate [&_[data-slate-placeholder]]:!opacity-100 [&_[data-slate-placeholder]]:text-muted-fg [&_[data-slate-placeholder]]:text-xs [&_[data-slate-placeholder]]:!top-1/2 [&_[data-slate-placeholder]]:!-translate-y-1/2",
)

const FILTER_PATTERN = /\b(from|in|has|before|after)(:)("([^"]+)"|(\S*))/gi
const TRIGGER_PATTERN = /\b(from|in|has|before|after):([^:\s]*)$/i

/** `decorateSearchFilters` + `SearchFilterLeaf`: keywords in primary, values in fg. */
const filterDecorations = new Plugin({
	props: {
		decorations: (state) => {
			const text = state.doc.textContent
			const decorations: Array<Decoration> = []
			for (const match of text.matchAll(FILTER_PATTERN)) {
				const keyword = match[1] ?? ""
				const value = match[3] ?? ""
				const start = 1 + (match.index ?? 0)
				const keywordEnd = start + keyword.length + 1
				decorations.push(Decoration.inline(start, keywordEnd, { class: "text-primary font-medium" }))
				if (value) decorations.push(Decoration.inline(keywordEnd, keywordEnd + value.length, { class: "text-fg" }))
			}
			return DecorationSet.create(state.doc, decorations)
		},
	},
})

/** Slate's placeholder (absolute span, `min-height` of its height); the text can change. */
const placeholderKey = new PluginKey<string>("searchPlaceholder")
const placeholderSpan = (text: string) => () => {
	const span = document.createElement("span")
	span.setAttribute("contenteditable", "false")
	span.setAttribute("data-slate-placeholder", "true")
	span.setAttribute(
		"style",
		"position: absolute; top: 0px; pointer-events: none; width: 100%; max-width: 100%; display: block; opacity: 0.333; user-select: none; text-decoration: none;",
	)
	span.textContent = text
	return span
}
const placeholderPlugin = (initial: string) =>
	new Plugin<string>({
		key: placeholderKey,
		state: { init: () => initial, apply: (tr, text) => tr.getMeta(placeholderKey) ?? text },
		props: {
			decorations: (state) => {
				const text = placeholderKey.getState(state) ?? ""
				return state.doc.textContent === ""
					? DecorationSet.create(state.doc, [
							Decoration.widget(1, placeholderSpan(text), { side: 1, key: `placeholder:${text}` }),
						])
					: DecorationSet.empty
			},
		},
		view: (view) => {
			const sync = () => {
				const placeholder = view.dom.querySelector<HTMLElement>("[data-slate-placeholder]")
				view.dom.style.minHeight = placeholder ? `${placeholder.getBoundingClientRect().height}px` : ""
			}
			sync()
			return { update: sync }
		},
	})

export const setPlaceholder = (view: EditorView, text: string) => {
	if (placeholderKey.getState(view.state) !== text) view.dispatch(view.state.tr.setMeta(placeholderKey, text))
}

export interface Autocomplete {
	readonly filterType: "from" | "in" | "has"
	readonly search: string
	readonly filterStartOffset: number
}

export type SearchEditorEvent =
	| { readonly _tag: "ChangedText"; readonly text: string; readonly autocomplete: Autocomplete | null }
	| { readonly _tag: "PressedKey"; readonly key: "ArrowDown" | "ArrowUp" | "Enter" | "BackspaceAtStart" }
	| { readonly _tag: "PressedAutocompleteKey"; readonly key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape" }

/** How many suggestions the host shows: keys go to the autocomplete only while there are some. */
const optionCountKey = new PluginKey<number>("searchOptionCount")
const optionCountPlugin = new Plugin<number>({
	key: optionCountKey,
	state: { init: () => 0, apply: (tr, count) => tr.getMeta(optionCountKey) ?? count },
})

const autocompleteAt = (state: EditorState): Autocomplete | null => {
	const before = state.doc.textBetween(1, state.selection.head, "", "")
	const match = TRIGGER_PATTERN.exec(before)
	const filterType = match?.[1]?.toLowerCase()
	return match && (filterType === "from" || filterType === "in" || filterType === "has")
		? { filterType, search: match[2] ?? "", filterStartOffset: before.length - match[0].length }
		: null
}

export const createSearchEditor = (
	element: HTMLElement,
	options: { readonly placeholder: string; readonly emit: (event: SearchEditorEvent) => void },
): EditorView => {
	const keyHandler = new Plugin({
		props: {
			handleKeyDown: (view, event) => {
				const isOpen = autocompleteAt(view.state) !== null && (optionCountKey.getState(view.state) ?? 0) > 0
				const key = event.key
				if (isOpen && (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === "Tab")) {
					options.emit({ _tag: "PressedAutocompleteKey", key })
					return true
				}
				// Legacy only prevents default here; Escape also reaches the palette (go back).
				if (isOpen && key === "Escape") {
					options.emit({ _tag: "PressedAutocompleteKey", key })
					return false
				}
				if (key === "Backspace" && view.state.selection.empty && view.state.selection.head === 1) {
					options.emit({ _tag: "PressedKey", key: "BackspaceAtStart" })
					return false
				}
				if (!isOpen && (key === "ArrowDown" || key === "ArrowUp" || key === "Enter")) {
					options.emit({ _tag: "PressedKey", key })
					return true
				}
				return false
			},
		},
	})
	const view: EditorView = new EditorView(
		{ mount: element },
		{
			state: EditorState.create({
				schema,
				plugins: [keyHandler, optionCountPlugin, placeholderPlugin(options.placeholder), filterDecorations],
			}),
			attributes: {
				class: EDITABLE_CLASS,
				role: "textbox",
				"aria-multiline": "true",
				"data-slate-editor": "true",
				"data-slate-node": "value",
				zindex: "-1",
				style: "position: relative; white-space: pre-wrap; overflow-wrap: break-word;",
			},
			dispatchTransaction: (tr) => {
				view.updateState(view.state.apply(tr))
				if (tr.docChanged || tr.selectionSet)
					options.emit({ _tag: "ChangedText", text: view.state.doc.textContent, autocomplete: autocompleteAt(view.state) })
			},
		},
	)
	return view
}

/** Replace the whole line and put the cursor at its end (clear, load a recent search). */
export const setText = (view: EditorView, text: string) => {
	const tr = view.state.tr.replaceWith(1, view.state.doc.content.size - 1, text ? schema.text(text) : [])
	view.dispatch(tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1)))
	view.focus()
}

/** `selectOption`: delete the typed `filter:partial` before the cursor. */
export const deleteFilterText = (view: EditorView, filterStartOffset: number) => {
	view.dispatch(view.state.tr.delete(1 + filterStartOffset, view.state.selection.head))
	view.focus()
}

export const syncOptionCount = (view: EditorView, count: number) => {
	if ((optionCountKey.getState(view.state) ?? 0) !== count) view.dispatch(view.state.tr.setMeta(optionCountKey, count))
}

const editors = new Map<string, EditorView>()
export const registerSearchEditor = (id: string, view: EditorView) => editors.set(id, view)
export const unregisterSearchEditor = (id: string, view: EditorView) => {
	if (editors.get(id) === view) editors.delete(id)
}
export const searchEditorById = (id: string) => editors.get(id)
