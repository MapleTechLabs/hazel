import type { Node } from "prosemirror-model"
import type { EditorState, Transaction } from "prosemirror-state"

/**
 * The document position of offset `target` in `doc.textBetween(0, size, "\n")`: the text the
 * native field holds. Textblocks are separated by one "\n"; inline atoms (mentions) take a
 * position but no text.
 */
const positionAt = (doc: Node, target: number): number => {
	let text = 0
	let isFirst = true
	let found: number | undefined
	doc.descendants((node, pos) => {
		if (found !== undefined) return false
		if (!node.isTextblock) return true
		if (!isFirst) text += 1
		isFirst = false
		const length = node.textContent.length
		if (target <= text + length) {
			let remaining = target - text
			let at = pos + 1
			node.forEach((child) => {
				if (found !== undefined) return
				const chars = child.isText ? (child.text?.length ?? 0) : 0
				if (remaining <= chars) {
					found = at + remaining
					return
				}
				remaining -= chars
				at += child.nodeSize
			})
			found ??= at
		}
		text += length
		return false
	})
	return found ?? Math.max(0, doc.content.size - 1)
}

/** What the native field's new text changed: the document span it replaces, and the new text. */
export type FieldChange = { readonly from: number; readonly to: number; readonly text: string }

/**
 * The smallest change from the editor's text to `value`; `undefined` when it is the same. An
 * inline atom (a mention) has no text, so one text offset can be either side of it: text inserted
 * there goes where the editor's caret is, as typing in the editor would put it.
 */
export const fieldTextChange = (doc: Node, value: string, caret?: number): FieldChange | undefined => {
	const old = doc.textBetween(0, doc.content.size, "\n")
	if (old === value) return undefined
	let start = 0
	while (start < old.length && start < value.length && old[start] === value[start]) start++
	let oldEnd = old.length
	let newEnd = value.length
	while (oldEnd > start && newEnd > start && old[oldEnd - 1] === value[newEnd - 1]) {
		oldEnd--
		newEnd--
	}
	const text = value.slice(start, newEnd)
	const atCaret =
		caret !== undefined && start === oldEnd && doc.textBetween(0, caret, "\n").length === start
	if (atCaret) return { from: caret, to: caret, text }
	return { from: positionAt(doc, start), to: positionAt(doc, oldEnd), text }
}

/** The editor's caret, when its selection is one. */
export const caretOf = (state: EditorState) => (state.selection.empty ? state.selection.from : undefined)

/** Typing: text inserted at one place, on one line, which the editor hears as `handleTextInput`. */
export const isTyping = (change: FieldChange) =>
	change.from === change.to && change.text !== "" && !change.text.includes("\n")

/**
 * The native field's new text applied as the smallest edit: only the changed span is replaced,
 * typed text takes the marks around it, and a "\n" splits its block. Lists, quotes and
 * formatting the editor made elsewhere are kept. `undefined` when the text did not change.
 */
export const replaceFieldText = (state: EditorState, value: string): Transaction | undefined => {
	const change = fieldTextChange(state.doc, value, caretOf(state))
	if (change === undefined) return undefined
	const [first = "", ...rest] = change.text.split("\n")
	const { from } = change
	const tr = state.tr.insertText(first, from, change.to)
	let at = from + first.length
	for (const line of rest) {
		tr.split(at)
		// `at` is already in the current document: map it through the split step alone.
		at = tr.mapping.maps[tr.mapping.maps.length - 1]?.map(at, 1) ?? at
		if (line !== "") tr.insertText(line, at)
		at += line.length
	}
	return tr
}

/** The one span two texts differ in: where it starts, where it ends in `a`, and `b`'s text for it. */
const textDiff = (a: string, b: string) => {
	let start = 0
	while (start < a.length && start < b.length && a[start] === b[start]) start++
	let aEnd = a.length
	let bEnd = b.length
	while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
		aEnd--
		bEnd--
	}
	return { start, end: aEnd, text: b.slice(start, bEnd) }
}

/**
 * The field's edit from `before` to `after`, made on the editor's text instead: the field had not
 * yet taken a change the editor made (a list marker it turned into a list, a picked mention) when
 * the user typed on. `undefined` when the two changes touch the same text.
 */
export const rebaseFieldEdit = (before: string, after: string, editor: string): string | undefined => {
	if (before === editor) return after
	const typed = textDiff(before, after)
	const made = textDiff(before, editor)
	if (typed.end <= made.start && !(typed.end === made.start && typed.start === made.start))
		return editor.slice(0, typed.start) + typed.text + editor.slice(typed.end)
	if (typed.start >= made.end) {
		const shift = made.text.length - (made.end - made.start)
		return editor.slice(0, typed.start + shift) + typed.text + editor.slice(typed.end + shift)
	}
	return undefined
}
