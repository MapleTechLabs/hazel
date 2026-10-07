import { history } from "prosemirror-history"
import { DOMSerializer, type Node as ProseMirrorNode } from "prosemirror-model"
import { EditorState } from "prosemirror-state"
import { EditorView } from "prosemirror-view"
import { cx } from "~/utils/cx"
import { type BehaviorEvent, behaviorPlugin } from "./behavior"
import { blocksOf, isValueEmpty, serializeToMarkdown, toDoc, createEmptyValue } from "./markdown"
import {
	type AutocompleteState,
	autocompleteKey,
	autocompletePlugin,
	closedAutocomplete,
	insertAutocompleteResult,
	markdownDecorationsPlugin,
	placeholderPlugin,
	type TriggerId,
} from "./plugins"
import { schema } from "./schema"

/**
 * A vanilla ProseMirror editor configured as the legacy composer. Framework-free: the
 * Foldkit Mount (`composer/mount.ts`) owns its lifetime and turns `EditorEvent`s into
 * Messages. Commands reach a live editor through `editorById`.
 */

export type EditorEvent =
	| BehaviorEvent
	| { readonly _tag: "ChangedDoc"; readonly markdown: string; readonly isEmpty: boolean }
	| {
			readonly _tag: "ChangedAutocomplete"
			readonly autocomplete: { readonly trigger: TriggerId; readonly search: string } | null
	  }

export interface EditorOptions {
	readonly placeholder: string
	readonly emit: (event: EditorEvent) => void
	readonly isUploading?: () => boolean
}

/** Legacy `Editable` className, composed with the same `cx` (tailwind-merge) arguments. */
const EDITABLE_CLASS = cx(
	"w-full whitespace-pre-wrap break-all px-3 py-2 text-base md:text-sm",
	"rounded-xl bg-transparent",
	"focus:border-primary focus:outline-hidden",
	"caret-primary",
	"placeholder:text-muted-fg",
	"min-h-10",
	"leading-normal",
	"**:data-slate-placeholder:top-2!",
	"**:data-slate-placeholder:translate-y-0!",
)

/** Slate's `selected && focused` ring on an inline void. */
const SELECTED_RING = ["ring-2", "ring-primary", "ring-offset-1"]

const atomView = (node: ProseMirrorNode) => {
	const toDOM = node.type.spec.toDOM
	const { dom } = DOMSerializer.renderSpec(document, toDOM ? toDOM(node) : ["span"])
	const element = dom as HTMLElement
	return {
		dom: element,
		selectNode: () => element.classList.add(...SELECTED_RING),
		deselectNode: () => element.classList.remove(...SELECTED_RING),
		ignoreMutation: () => true,
	}
}

const sameAutocomplete = (a: AutocompleteState, b: AutocompleteState) =>
	a.trigger?.id === b.trigger?.id && a.search === b.search

export const createComposerEditor = (element: HTMLElement, options: EditorOptions): EditorView => {
	const state = EditorState.create({
		doc: toDoc(createEmptyValue()),
		plugins: [
			behaviorPlugin(options.emit, options.isUploading ?? (() => false)),
			autocompletePlugin,
			placeholderPlugin(options.placeholder),
			markdownDecorationsPlugin,
			history(),
		],
	})
	const view: EditorView = new EditorView(
		{ mount: element },
		{
			state,
			nodeViews: { mention: atomView, "custom-emoji": atomView },
			attributes: (current) => {
				const autocomplete = autocompleteKey.getState(current) ?? closedAutocomplete
				return {
					class: EDITABLE_CLASS,
					role: "combobox",
					"aria-autocomplete": "list",
					"aria-expanded": String(autocomplete.trigger !== null && autocomplete.optionCount > 0),
					"aria-haspopup": "listbox",
					"aria-multiline": "true",
					style: "position: relative; white-space: pre-wrap; overflow-wrap: break-word;",
				}
			},
			dispatchTransaction: (tr) => {
				const previous = autocompleteKey.getState(view.state) ?? closedAutocomplete
				view.updateState(view.state.apply(tr))
				if (tr.docChanged) {
					const blocks = blocksOf(view.state.doc)
					options.emit({ _tag: "ChangedDoc", markdown: serializeToMarkdown(blocks), isEmpty: isValueEmpty(blocks) })
				}
				const next = autocompleteKey.getState(view.state) ?? closedAutocomplete
				if (!sameAutocomplete(previous, next)) {
					options.emit({
						_tag: "ChangedAutocomplete",
						autocomplete: next.trigger ? { trigger: next.trigger.id, search: next.search } : null,
					})
				}
			},
		},
	)
	return view
}

const editors = new Map<string, EditorView>()

export const registerEditor = (editorId: string, view: EditorView) => editors.set(editorId, view)
export const unregisterEditor = (editorId: string, view: EditorView) => {
	if (editors.get(editorId) === view) editors.delete(editorId)
}
export const editorById = (editorId: string) => editors.get(editorId)

/** Legacy `handleSelectByIndex` for a mention option. */
export const insertMention = (view: EditorView, userId: string, displayName: string) => {
	insertAutocompleteResult(view, schema.nodes.mention.create({ userId, displayName }))
	view.focus()
}

/** Tell the editor how many options the popover shows, so it only captures keys when there are some. */
export const syncAutocompleteOptionCount = (view: EditorView, optionCount: number) => {
	const current = autocompleteKey.getState(view.state) ?? closedAutocomplete
	if (current.optionCount !== optionCount) view.dispatch(view.state.tr.setMeta(autocompleteKey, { optionCount }))
}

export const closeAutocomplete = (view: EditorView) =>
	view.dispatch(view.state.tr.setMeta(autocompleteKey, closedAutocomplete))
