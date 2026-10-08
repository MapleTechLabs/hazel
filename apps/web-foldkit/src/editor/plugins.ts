import type { Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, Plugin, PluginKey, type Transaction } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import { leafClassName, markdownLeaves } from "./decorations"

/** Markdown highlighting: one inline decoration per Slate leaf, so leaf spans match legacy. */
const decorateTextblock = (block: ProseMirrorNode, blockStart: number): Array<Decoration> => {
	const decorations: Array<Decoration> = []
	block.forEach((child, offset) => {
		if (!child.isText || !child.text) return
		const from = blockStart + 1 + offset
		for (const leaf of markdownLeaves(child.text)) {
			const className = leafClassName(leaf)
			const attrs: Record<string, string> =
				leaf.type === "link" || leaf.type === "url"
					? { nodeName: "a", href: leaf.url ?? "", target: "_blank", rel: "noopener noreferrer", class: className }
					: { class: className }
			decorations.push(Decoration.inline(from + leaf.start, from + leaf.end, attrs))
		}
	})
	return decorations
}

/** Legacy blockquote accent bar (`<span aria-hidden>` before the quote text). */
const blockquoteBar = () => {
	const bar = document.createElement("span")
	bar.className = "absolute top-0 left-0 h-full w-1 rounded-xs bg-primary"
	bar.setAttribute("aria-hidden", "true")
	bar.contentEditable = "false"
	return bar
}

export const markdownDecorationsPlugin = new Plugin({
	props: {
		decorations: (state) => {
			const decorations: Array<Decoration> = []
			state.doc.descendants((node, pos) => {
				if (!node.isTextblock) return true
				if (node.type.name === "blockquote") {
					decorations.push(Decoration.widget(pos + 1, blockquoteBar, { side: -1, ignoreSelection: true }))
				}
				// Code blocks get Prism tokens in legacy, not markdown leaves (Phase 4).
				if (node.type.name !== "code-block") decorations.push(...decorateTextblock(node, pos))
				return false
			})
			return DecorationSet.create(state.doc, decorations)
		},
	},
})

// PLACEHOLDER

const composingKey = new PluginKey<boolean>("composing")

/** Slate's rule: one block, one empty text, not composing; legacy also hides it in quotes and code. */
export const showsPlaceholder = (state: EditorState) => {
	const first = state.doc.firstChild
	return (
		state.doc.childCount === 1 &&
		first !== null &&
		first.isTextblock &&
		first.childCount === 0 &&
		first.type.name !== "blockquote" &&
		first.type.name !== "code-block" &&
		composingKey.getState(state) !== true
	)
}

const placeholderElement = (text: string) => () => {
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

/** Placeholder span plus Slate's `min-height` (the measured placeholder height) on the editable. */
export const placeholderPlugin = (text: string) =>
	new Plugin<boolean>({
		key: composingKey,
		state: {
			init: () => false,
			apply: (tr, composing) => tr.getMeta(composingKey) ?? composing,
		},
		props: {
			decorations: (state) =>
				showsPlaceholder(state)
					? DecorationSet.create(state.doc, [
							Decoration.widget(1, placeholderElement(text), { side: 1, key: "placeholder" }),
						])
					: DecorationSet.empty,
			handleDOMEvents: {
				compositionstart: (view) => {
					view.dispatch(view.state.tr.setMeta(composingKey, true))
					return false
				},
				compositionend: (view) => {
					view.dispatch(view.state.tr.setMeta(composingKey, false))
					return false
				},
			},
		},
		view: (view) => {
			const syncMinHeight = () => {
				const placeholder = view.dom.querySelector<HTMLElement>("[data-slate-placeholder]")
				const editable = view.dom as HTMLElement
				editable.style.minHeight = placeholder ? `${placeholder.getBoundingClientRect().height}px` : ""
			}
			syncMinHeight()
			return { update: syncMinHeight }
		},
	})

// AUTOCOMPLETE

export type TriggerId = "mention" | "command" | "emoji"

export interface Trigger {
	readonly id: TriggerId
	readonly char: string
	readonly requireStartOfLine: boolean
	readonly cancelChars: ReadonlyArray<string>
}

/** Legacy `DEFAULT_TRIGGERS`. */
export const DEFAULT_TRIGGERS: ReadonlyArray<Trigger> = [
	{ id: "mention", char: "@", requireStartOfLine: false, cancelChars: [" ", "\n"] },
	{ id: "command", char: "/", requireStartOfLine: true, cancelChars: [" ", "\n"] },
	{ id: "emoji", char: ":", requireStartOfLine: false, cancelChars: [" ", "\n", ":"] },
]

export interface AutocompleteState {
	readonly trigger: Trigger | null
	readonly search: string
	/** Position of the trigger character. */
	readonly from: number
	/** Options the host currently shows; keys are only captured when there are some. */
	readonly optionCount: number
}

export const closedAutocomplete: AutocompleteState = { trigger: null, search: "", from: 0, optionCount: 0 }

export const autocompleteKey = new PluginKey<AutocompleteState>("autocomplete")

export const isAutocompleteOpen = (state: EditorState) => autocompleteKey.getState(state)?.trigger != null

/** Re-derive the search from the document, closing when the trigger text is gone. */
const deriveAutocomplete = (tr: Transaction, previous: AutocompleteState, state: EditorState): AutocompleteState => {
	if (!previous.trigger) return previous
	const from = tr.mapping.map(previous.from)
	const { $head } = state.selection
	if ($head.pos < from + 1 || state.doc.resolve(from).parent !== $head.parent) return closedAutocomplete
	const text = state.doc.textBetween(from, $head.pos, "\n", "￼")
	if (!text.startsWith(previous.trigger.char)) return closedAutocomplete
	const search = text.slice(previous.trigger.char.length)
	if (previous.trigger.cancelChars.some((char) => search.includes(char))) return closedAutocomplete
	return { ...previous, from, search }
}

export const autocompletePlugin = new Plugin<AutocompleteState>({
	key: autocompleteKey,
	state: {
		init: () => closedAutocomplete,
		apply: (tr, previous, _old, state) => {
			const meta: Partial<AutocompleteState> | undefined = tr.getMeta(autocompleteKey)
			return meta ? { ...previous, ...meta } : deriveAutocomplete(tr, previous, state)
		},
	},
	props: {
		handleDOMEvents: {
			// Legacy `onBlur`: closing the popover when focus leaves.
			blur: (view) => {
				if (isAutocompleteOpen(view.state)) view.dispatch(view.state.tr.setMeta(autocompleteKey, closedAutocomplete))
				return false
			},
		},
	},
})

/** Legacy `checkTriggerConditions`. */
export const canActivateTrigger = (state: EditorState, trigger: Trigger, at: number) => {
	const $at = state.doc.resolve(at)
	if (trigger.requireStartOfLine) {
		const before = state.doc.textBetween($at.start(), at, "\n", "")
		return before.length === 0 || /^\s*$/.test(before)
	}
	const before = at > $at.start() ? state.doc.textBetween(at - 1, at, "\n", "") : ""
	return !before || /[\s"'([{]/.test(before)
}

/** Replace the trigger text with an inline node or text and close (legacy `insertAutocompleteResult`). */
export const insertAutocompleteResult = (view: EditorView, content: ProseMirrorNode | string) => {
	const { trigger, from } = autocompleteKey.getState(view.state) ?? closedAutocomplete
	if (!trigger) return
	const to = view.state.selection.head
	const tr =
		typeof content === "string"
			? view.state.tr.insertText(content, from, to)
			: view.state.tr.replaceWith(from, to, content)
	view.dispatch(tr.setMeta(autocompleteKey, closedAutocomplete).scrollIntoView())
}
