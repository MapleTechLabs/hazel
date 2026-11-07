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

/**
 * The native field's new text applied as the smallest edit: only the changed span is replaced,
 * typed text takes the marks around it, and a "\n" splits its block. Lists, quotes and
 * formatting the editor made elsewhere are kept. `undefined` when the text did not change.
 */
export const replaceFieldText = (state: EditorState, value: string): Transaction | undefined => {
	const doc = state.doc
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
	const [first = "", ...rest] = value.slice(start, newEnd).split("\n")
	const from = positionAt(doc, start)
	const tr = state.tr.insertText(first, from, positionAt(doc, oldEnd))
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
