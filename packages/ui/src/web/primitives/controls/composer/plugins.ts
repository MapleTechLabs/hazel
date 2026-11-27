/**
 * The composer editor's plugins (W12b), ported from `apps/web-foldkit/src/editor/plugins.ts`: the
 * trigger at the caret (`@ # / :`), the placeholder, and markdown-in-text highlighting.
 */
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, Plugin, PluginKey, type Transaction } from "prosemirror-state"
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view"
import { markdownLeaves } from "./decorations.ts"

export type TriggerKind = "@" | "#" | "/" | ":"

/** An open trigger: its character's position and the query typed after it. */
export interface Trigger {
	readonly kind: TriggerKind
	readonly from: number
	readonly query: string
}

/** Today's `DEFAULT_TRIGGERS`, plus `#` for channels (the contract's fourth trigger). */
const RULES = {
	"@": { lineStart: false, cancel: " \n\uFFFC" },
	"#": { lineStart: false, cancel: " \n\uFFFC" },
	"/": { lineStart: true, cancel: " \n\uFFFC" },
	":": { lineStart: false, cancel: " \n:\uFFFC" },
} satisfies Record<TriggerKind, { readonly lineStart: boolean; readonly cancel: string }>

export const isTriggerKind = (text: string): text is TriggerKind => Object.hasOwn(RULES, text)

export const triggerKey = new PluginKey<Trigger | null>("hz-trigger")

/** Today's `checkTriggerConditions`: `/` starts its line; the others follow a space, quote or bracket. */
export const canOpen = (state: EditorState, kind: TriggerKind, at: number) => {
	const $at = state.doc.resolve(at)
	if (!$at.parent.isTextblock || $at.parent.type.spec.code === true) return false
	if (RULES[kind].lineStart) return /^\s*$/.test(state.doc.textBetween($at.start(), at, "\n", "\uFFFC"))
	const before = at > $at.start() ? state.doc.textBetween(at - 1, at, "\n", "\uFFFC") : ""
	return before === "" || /[\s"'([{]/.test(before)
}

/** Re-reads the query from the document; closes when the caret leaves it or a cancel character lands. */
const derive = (tr: Transaction, previous: Trigger | null, state: EditorState): Trigger | null => {
	if (previous === null) return null
	const from = tr.mapping.map(previous.from)
	const { $head } = state.selection
	if (!state.selection.empty || $head.pos < from + 1 || state.doc.resolve(from).parent !== $head.parent)
		return null
	const text = state.doc.textBetween(from, $head.pos, "\n", "\uFFFC")
	if (!text.startsWith(previous.kind)) return null
	const query = text.slice(previous.kind.length)
	if ([...RULES[previous.kind].cancel].some((character) => query.includes(character))) return null
	return { kind: previous.kind, from, query }
}

export const triggerPlugin = new Plugin<Trigger | null>({
	key: triggerKey,
	state: {
		init: () => null,
		apply: (tr, previous, _old, state) => {
			const meta: Trigger | null | undefined = tr.getMeta(triggerKey)
			return meta === undefined ? derive(tr, previous, state) : meta
		},
	},
	props: {
		handleDOMEvents: {
			// Today's `onBlur`: the suggestions close when the focus leaves.
			blur: (view) => {
				if (triggerKey.getState(view.state) != null)
					view.dispatch(view.state.tr.setMeta(triggerKey, null))
				return false
			},
		},
	},
})

/** The text runs of one textblock as highlight decorations (`data-hz-md`, markers dimmed). */
const highlight = (block: ProseMirrorNode, start: number, into: Array<Decoration>) => {
	block.forEach((child, offset) => {
		if (!child.isText || child.text === undefined) return
		const from = start + 1 + offset
		for (const leaf of markdownLeaves(child.text)) {
			const attrs: Record<string, string> =
				leaf.marker === true ? { "data-hz-md": "marker" } : { "data-hz-md": leaf.style ?? "" }
			into.push(Decoration.inline(from + leaf.start, from + leaf.end, attrs))
		}
	})
}

export const highlightPlugin = new Plugin({
	props: {
		decorations: (state) => {
			const decorations: Array<Decoration> = []
			state.doc.descendants((node, pos) => {
				if (!node.isTextblock) return true
				if (node.type.spec.code !== true) highlight(node, pos, decorations)
				return false
			})
			return DecorationSet.create(state.doc, decorations)
		},
	},
})

const composingKey = new PluginKey<boolean>("hz-composing")

/** One empty paragraph, not composing: today's rule for showing the placeholder. */
const showsPlaceholder = (state: EditorState) => {
	const first = state.doc.firstChild
	return (
		state.doc.childCount === 1 &&
		first !== null &&
		first.type.name === "paragraph" &&
		first.childCount === 0 &&
		composingKey.getState(state) !== true
	)
}

/** The placeholder before the empty paragraph (in it, iOS WebKit would not type past the widget). */
export const placeholderPlugin = (text: () => string) =>
	new Plugin<boolean>({
		key: composingKey,
		state: {
			init: () => false,
			apply: (tr, composing) => tr.getMeta(composingKey) ?? composing,
		},
		props: {
			decorations: (state) => {
				const label = text()
				if (!showsPlaceholder(state) || label === "") return DecorationSet.empty
				const draw = (view: EditorView) => {
					const span = view.dom.ownerDocument.createElement("span")
					span.dataset.hzPart = "placeholder"
					span.contentEditable = "false"
					span.setAttribute("aria-hidden", "true")
					span.textContent = label
					return span
				}
				return DecorationSet.create(state.doc, [Decoration.widget(0, draw, { side: 1, key: label })])
			},
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
	})
