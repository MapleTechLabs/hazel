/**
 * The composer's editor (W12b): vanilla ProseMirror over markdown text, framework-free. The composer
 * primitive owns it, runs the revision rule over `markdown()` and hands Model edits to `receive`.
 */
import { history } from "prosemirror-history"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { EditorState, PluginKey, TextSelection, type Transaction } from "prosemirror-state"
import { EditorView, type NodeView } from "prosemirror-view"
import { carriesFiles, transferFiles } from "./files.ts"
import { type KeyHost, keysPlugin, pastePlainText } from "./keys.ts"
import { fromMarkdown, isEmpty, toMarkdown } from "./markdown.ts"
import { highlightPlugin, placeholderPlugin, type Trigger, triggerKey, triggerPlugin } from "./plugins.ts"

export type { Trigger } from "./plugins.ts"

export interface EditorHost extends KeyHost {
	readonly placeholder: () => string
	/** A mention's name (the `@` suggestion's label); the id when it is not known. */
	readonly nameOf: (id: string) => string
	/** The user edited the document. */
	readonly changed: (markdown: string) => void
	/** The trigger at the caret opened, moved on or closed (`next` null). */
	readonly triggered: (next: Trigger | null, previous: Trigger | null) => void
	/** Pasted files; false when the screen does not take files (the text pastes instead). */
	readonly files: (files: ReadonlyArray<File>) => boolean
}

export interface ComposerEditor {
	readonly markdown: () => string
	readonly isEmpty: () => boolean
	/** A Model edit: replaces only what changed, the caret after it when it was inside. */
	readonly receive: (markdown: string) => void
	readonly setEditable: (editable: boolean) => void
	/** Redraws what reads the host (the placeholder). */
	readonly refresh: () => void
}

/** Marks a transaction the Model made, so it is not reported back as an edit. */
const modelKey = new PluginKey("hz-model-edit")

const mentionView =
	(host: EditorHost) =>
	(node: ProseMirrorNode, view: EditorView): NodeView => {
		const dom = view.dom.ownerDocument.createElement("span")
		dom.dataset.hzPart = "mention"
		dom.dataset.kind = node.attrs.kind
		dom.contentEditable = "false"
		dom.textContent = `@${host.nameOf(node.attrs.id)}`
		return {
			dom,
			selectNode: () => dom.setAttribute("data-selected", ""),
			deselectNode: () => dom.removeAttribute("data-selected"),
			ignoreMutation: () => true,
		}
	}

/** The smallest replace from `doc` to `next` (ProseMirror's own diff), or the whole document. */
const replaceTo = (state: EditorState, next: ProseMirrorNode): Transaction | undefined => {
	const { doc, selection } = state
	const start = doc.content.findDiffStart(next.content)
	if (start === null) return undefined
	const ends = doc.content.findDiffEnd(next.content)
	let endA = ends?.a ?? doc.content.size
	let endB = ends?.b ?? next.content.size
	const overlap = start - Math.min(endA, endB)
	if (overlap > 0) {
		endA += overlap
		endB += overlap
	}
	let tr = state.tr.replace(start, endA, next.slice(start, endB))
	if (!tr.doc.eq(next)) {
		tr = state.tr.replaceWith(0, doc.content.size, next.content)
		return tr.setSelection(TextSelection.atEnd(tr.doc))
	}
	if (selection.head >= start && selection.head <= endA)
		tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(endB, tr.doc.content.size))))
	return tr
}

const views = new WeakMap<Element, EditorView>()

/** The editor whose editable element this is (today's `composerEditorOf`, for harnesses that type). */
export const editorOf = (element: Element): EditorView | undefined => views.get(element)

const sameTrigger = (a: Trigger | null, b: Trigger | null) => a?.kind === b?.kind && a?.query === b?.query

export const createEditor = (mount: HTMLElement, host: EditorHost): ComposerEditor => {
	let editable = true
	const state = EditorState.create({
		doc: fromMarkdown(""),
		plugins: [
			keysPlugin(host),
			triggerPlugin,
			placeholderPlugin(host.placeholder),
			highlightPlugin,
			history(),
		],
	})
	const view: EditorView = new EditorView(
		{ mount },
		{
			state,
			editable: () => editable,
			nodeViews: { mention: mentionView(host) },
			handlePaste: (current, event) => {
				const data = event.clipboardData
				if (data === null) return false
				const files = transferFiles(data)
				if (files.length > 0 && host.files(files)) return true
				const text = data.getData("text/plain")
				if (text === "") return false
				pastePlainText(current, text)
				return true
			},
			// Files dropped on the text are the composer's (its drop listener takes them), never text.
			handleDrop: (_current, event) => carriesFiles(event.dataTransfer),
			dispatchTransaction: (tr) => {
				const before = triggerKey.getState(view.state) ?? null
				view.updateState(view.state.apply(tr))
				if (tr.docChanged && tr.getMeta(modelKey) !== true) host.changed(toMarkdown(view.state.doc))
				const after = triggerKey.getState(view.state) ?? null
				if (!sameTrigger(before, after)) host.triggered(after, before)
			},
		},
	)
	views.set(view.dom, view)
	return {
		markdown: () => toMarkdown(view.state.doc),
		isEmpty: () => isEmpty(view.state.doc),
		receive: (markdown) => {
			if (markdown === toMarkdown(view.state.doc)) return
			const tr = replaceTo(view.state, fromMarkdown(markdown))
			if (tr !== undefined) view.dispatch(tr.setMeta(modelKey, true))
		},
		setEditable: (next) => {
			editable = next
			view.setProps({})
		},
		refresh: () => view.dispatch(view.state.tr),
	}
}
