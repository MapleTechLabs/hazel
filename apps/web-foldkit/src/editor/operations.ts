import type { Node as ProseMirrorNode } from "prosemirror-model"
import { Selection, TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createEmptyValue, deserializeFromMarkdown } from "./markdown"
import { autocompleteKey, closedAutocomplete, insertAutocompleteResult } from "./plugins"
import { schema } from "./schema"

/**
 * The legacy `SlateMessageEditorRef` methods (`setContent`, `clearContent`, `focus`,
 * `focusAndInsertText`, `insertCustomEmoji`) plus the autocomplete inserts, on a live view.
 */

/** Legacy skips focusing when a dialog (an emoji picker, a modal) holds the focus. */
const isDialogFocused = () => {
	const dialog = document.querySelector('[role="dialog"]')
	const active = document.activeElement
	return dialog !== null && active !== null && dialog.contains(active)
}

const replaceDoc = (view: EditorView, blocks: ReadonlyArray<ProseMirrorNode>) => {
	const { state } = view
	const tr = state.tr.replaceWith(0, state.doc.content.size, [...blocks]).setMeta(autocompleteKey, closedAutocomplete)
	view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)))
}

const selectEnd = (view: EditorView) => view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))

/** `setContent(markdown)`: replace the document with the parsed markdown. */
export const setContent = (view: EditorView, markdown: string) => replaceDoc(view, deserializeFromMarkdown(markdown))

/** `resetAndFocus`: empty document, autocomplete closed, caret at the start. */
export const clearContent = (view: EditorView) => {
	replaceDoc(view, createEmptyValue())
	if (isDialogFocused()) return
	view.focus()
	view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
}

/** `focus()`: focus with the caret at the end. */
export const focusAtEnd = (view: EditorView) => {
	view.focus()
	selectEnd(view)
}

/** `focusAndInsertText`: text goes through the same input path as typing, so triggers open. */
export const focusAndInsertText = (view: EditorView, text: string) => {
	if (isDialogFocused()) return
	focusAtEnd(view)
	const { from, to } = view.state.selection
	const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, text, () => view.state.tr))
	if (!handled) view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
}

/** `insertCustomEmoji`: an inline emoji atom at the end, caret after it. */
export const insertCustomEmoji = (view: EditorView, name: string, imageUrl: string) => {
	focusAtEnd(view)
	const node = schema.nodes["custom-emoji"].create({ name, imageUrl })
	const tr = view.state.tr.replaceSelectionWith(node)
	view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(tr.selection.to))).scrollIntoView())
}

/** An emoji option from the `:` trigger: unicode text, or an inline custom emoji. */
export const insertEmojiResult = (view: EditorView, emoji: string, custom: { name: string; imageUrl: string } | null) => {
	insertAutocompleteResult(view, custom ? schema.nodes["custom-emoji"].create(custom) : emoji)
	view.focus()
}

/** A command option from the `/` trigger: delete the trigger text and close (command input mode). */
export const removeTriggerText = (view: EditorView) => {
	const { trigger, from } = autocompleteKey.getState(view.state) ?? closedAutocomplete
	if (!trigger) return
	view.dispatch(view.state.tr.delete(from, view.state.selection.head).setMeta(autocompleteKey, closedAutocomplete))
}
