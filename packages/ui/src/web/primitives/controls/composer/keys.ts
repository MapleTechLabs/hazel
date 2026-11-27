/**
 * The composer editor's keys and typed text (W12b), ported from `apps/web-foldkit/src/editor/behavior.ts`
 * in the same order: block autoformat, trigger opening, formatting shortcuts, Enter and Shift+Enter.
 */
import { joinBackward, joinForward } from "prosemirror-commands"
import { redo, undo } from "prosemirror-history"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { type EditorState, Plugin, Selection, TextSelection, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import type { ComposerKey } from "../../../../vocabulary/options.ts"
import { detectLanguage } from "./detect-language.ts"
import { isEmpty } from "./markdown.ts"
import { canOpen, isTriggerKind, triggerKey } from "./plugins.ts"
import { schema } from "./schema.ts"

/** What the keys report to the composer. Each returns whether it took the key. */
export interface KeyHost {
	/** An open trigger's suggestions take the key (they are showing and the screen handles `key`). */
	readonly suggestionKey: (key: ComposerKey) => boolean
	readonly editLast: () => boolean
	readonly escape: () => boolean
	readonly submit: () => void
}

const SUGGESTION_KEYS: ReadonlyMap<string, ComposerKey> = new Map([
	["ArrowUp", "up"],
	["ArrowDown", "down"],
	["Enter", "enter"],
	["Tab", "tab"],
	["Escape", "escape"],
])

/** The block the selection starts in; a whole-document selection starts in the first one. */
const currentBlock = (state: EditorState) => {
	const $from =
		state.selection.$from.depth > 0
			? state.selection.$from
			: (Selection.findFrom(state.doc.resolve(0), 1, true)?.$from ?? state.selection.$from)
	return { node: $from.parent, start: $from.start(), end: $from.end(), pos: $from.before() }
}

const setBlockType = (
	tr: Transaction,
	pos: number,
	type: string,
	attrs: Record<string, unknown> | null = null,
) => tr.setNodeMarkup(pos, schema.nodes[type], attrs)

/** A code block with no language gets one from its content (today, on send). */
const withLanguage = (tr: Transaction, node: ProseMirrorNode, pos: number) => {
	if (node.type.name !== "code-block" || node.attrs.language !== null || node.textContent.trim() === "")
		return tr
	const language = detectLanguage(node.textContent)
	return language === undefined ? tr : tr.setNodeMarkup(pos, undefined, { ...node.attrs, language })
}

/** Today's `withAutoformat`: a space after a block prefix converts the block. */
const AUTOFORMAT: ReadonlyArray<{
	readonly match: (before: string) => boolean
	readonly type: string
	readonly attrs: (before: string) => Record<string, unknown> | null
}> = [
	{ match: (before) => before === ">" || before === ">>>", type: "blockquote", attrs: () => null },
	{ match: (before) => before === "```", type: "code-block", attrs: () => ({ language: null }) },
	{
		match: (before) => /^```(\w+)$/.test(before),
		type: "code-block",
		attrs: (before) => ({ language: before.slice(3) }),
	},
	{ match: (before) => before === "-#", type: "subtext", attrs: () => null },
	{
		match: (before) => before === "-" || before === "*",
		type: "list-item",
		attrs: () => ({ ordered: false }),
	},
	{
		match: (before) => /^(\d+)\.$/.test(before),
		type: "list-item",
		attrs: (before) => ({ ordered: true, number: Number(before.slice(0, -1)) }),
	},
]

const handleTextInput = (view: EditorView, from: number, to: number, text: string): boolean => {
	const { state } = view
	if (view.composing || from !== to || !state.selection.empty) return false
	const block = currentBlock(state)
	if (text === " " && block.node.type.spec.code !== true) {
		const before = state.doc.textBetween(block.start, from, "\n", "￼")
		const rule = AUTOFORMAT.find((candidate) => candidate.match(before))
		if (rule !== undefined) {
			view.dispatch(
				setBlockType(state.tr.delete(block.start, from), block.pos, rule.type, rule.attrs(before)),
			)
			return true
		}
	}
	if (isTriggerKind(text) && triggerKey.getState(state) == null && canOpen(state, text, from)) {
		view.dispatch(
			state.tr.insertText(text, from, to).setMeta(triggerKey, { kind: text, from, query: "" }),
		)
		return true
	}
	return false
}

/** Slate's `splitNodes({ always: true })`: the new block keeps the type and attrs. */
const splitKeepingType = (tr: Transaction) => {
	const { parent } = tr.deleteSelection().selection.$from
	return tr.split(tr.selection.from, 1, [{ type: parent.type, attrs: parent.attrs }]).scrollIntoView()
}

const insertParagraphAt = (state: EditorState, pos: number) => {
	const tr = state.tr.insert(pos, schema.nodes.paragraph.create())
	return tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView()
}

const isAtStart = (state: EditorState) => state.selection.empty && state.selection.$from.parentOffset === 0
const isAtEnd = (state: EditorState) =>
	state.selection.empty && state.selection.$from.parentOffset === state.selection.$from.parent.content.size

/** Today's paste: plain text, verbatim in a code block, elsewhere one block per line. */
export const pastePlainText = (view: EditorView, text: string) => {
	const normalized = text.replace(/\r\n?/g, "\n")
	const lines = normalized.split("\n")
	if (currentBlock(view.state).node.type.spec.code === true || lines.length === 1) {
		view.dispatch(view.state.tr.insertText(normalized).scrollIntoView())
		return
	}
	const tr = view.state.tr
	lines.forEach((line, index) => {
		if (index > 0) splitKeepingType(tr)
		if (line !== "") tr.insertText(line)
	})
	view.dispatch(tr.scrollIntoView())
}

/** Deleting everything leaves an empty paragraph (not an empty quote), so the placeholder returns. */
const deleteSelection = (state: EditorState) => {
	const { from, to } = state.selection
	if (from > Selection.atStart(state.doc).from || to < Selection.atEnd(state.doc).to)
		return state.tr.deleteSelection()
	const tr = state.tr.replaceWith(0, state.doc.content.size, schema.nodes.paragraph.create())
	return tr.setSelection(TextSelection.create(tr.doc, 1))
}

const isInlineAtom = (node: ProseMirrorNode | null | undefined): node is ProseMirrorNode =>
	node != null && node.isInline && !node.isText && node.isAtom

/** `Mod+B` and the like: wrap the selection in a marker, or unwrap it when the marker surrounds it. */
const toggleMarker = (state: EditorState, marker: string): Transaction | null => {
	const { from, to, $from, $to } = state.selection
	if ($from.depth === 0 || $from.parent !== $to.parent || $from.parent.type.spec.code === true) return null
	const length = marker.length
	const before = state.doc.textBetween(Math.max($from.start(), from - length), from)
	const after = state.doc.textBetween(to, Math.min($to.end(), to + length))
	if (before === marker && after === marker)
		return state.tr.delete(to, to + length).delete(from - length, from)
	const tr = state.tr.insertText(marker, to).insertText(marker, from)
	return tr.setSelection(TextSelection.create(tr.doc, from + length, to + length))
}

/** Discord's and Slack's formatting shortcuts. */
const markerFor = (event: KeyboardEvent): string | null => {
	const key = event.key.toLowerCase()
	if (event.altKey) return null
	if (!event.shiftKey && key === "b") return "**"
	if (!event.shiftKey && key === "i") return "*"
	if (!event.shiftKey && key === "u") return "__"
	if (event.shiftKey && key === "x") return "~~"
	return null
}

const QUOTE_LIKE = ["blockquote", "code-block", "list-item", "subtext"]

export const keysPlugin = (host: KeyHost) => {
	const submit = (view: EditorView) => {
		let tr = view.state.tr
		view.state.doc.forEach((node, offset) => {
			tr = withLanguage(tr, node, offset)
		})
		if (tr.docChanged) view.dispatch(tr)
		host.submit()
	}

	const handleKeyDown = (view: EditorView, event: KeyboardEvent): boolean => {
		if (event.isComposing) return false
		const { state } = view
		const suggestionKey = SUGGESTION_KEYS.get(event.key)
		if (suggestionKey !== undefined && !event.shiftKey && triggerKey.getState(state) != null) {
			if (host.suggestionKey(suggestionKey)) {
				if (suggestionKey === "escape") view.dispatch(state.tr.setMeta(triggerKey, null))
				return true
			}
		}
		const block = currentBlock(state)
		const type = block.node.type.name
		const mod = event.metaKey || event.ctrlKey
		const modified = mod || event.altKey || event.shiftKey
		// Up in an empty composer edits the last message (today's `write.ts`).
		if (event.key === "ArrowUp" && !modified && isEmpty(state.doc) && host.editLast()) return true
		if (event.key === "Escape" && !modified) return host.escape()
		if (mod && event.key === "a") {
			// In a code block or quote the first press selects the block, a second one everything.
			const selectsBlock =
				(type === "code-block" || type === "blockquote") &&
				!(state.selection.from === block.start && state.selection.to === block.end)
			view.dispatch(
				state.tr.setSelection(
					selectsBlock
						? TextSelection.create(state.doc, block.start, block.end)
						: TextSelection.between(
								Selection.atStart(state.doc).$from,
								Selection.atEnd(state.doc).$to,
							),
				),
			)
			return true
		}
		const marker = mod ? markerFor(event) : null
		if (marker !== null) {
			// Taken either way: the browser's own `Mod+B` would insert a `<b>`.
			const tr = toggleMarker(state, marker)
			if (tr !== null) view.dispatch(tr.scrollIntoView())
			return true
		}
		if (mod && !event.shiftKey && event.key === "z") return undo(state, view.dispatch)
		if (mod && ((event.shiftKey && event.key === "z") || event.key === "y"))
			return redo(state, view.dispatch)
		if ((event.key === "Backspace" || event.key === "Delete") && !state.selection.empty) {
			view.dispatch(deleteSelection(state).scrollIntoView())
			return true
		}
		if (event.key === "Backspace" && state.selection.empty) {
			if (isAtStart(state) && QUOTE_LIKE.includes(type)) {
				view.dispatch(setBlockType(state.tr, block.pos, "paragraph"))
				return true
			}
			// A mention or custom emoji goes in one step.
			const before = state.selection.$from.nodeBefore
			if (isInlineAtom(before)) {
				view.dispatch(state.tr.delete(state.selection.from - before.nodeSize, state.selection.from))
				return true
			}
			return joinBackward(state, view.dispatch, view)
		}
		if (event.key === "Delete" && state.selection.empty) {
			const after = state.selection.$from.nodeAfter
			if (isInlineAtom(after)) {
				view.dispatch(state.tr.delete(state.selection.from, state.selection.from + after.nodeSize))
				return true
			}
			return joinForward(state, view.dispatch, view)
		}
		if ((type === "code-block" || type === "blockquote") && event.key === "ArrowDown" && isAtEnd(state)) {
			const tr = withLanguage(state.tr, block.node, block.pos)
			view.dispatch(insertParagraphAt(state.apply(tr), block.pos + block.node.nodeSize))
			return true
		}
		if ((type === "code-block" || type === "blockquote") && event.key === "ArrowUp" && isAtStart(state)) {
			const tr = withLanguage(state.tr, block.node, block.pos)
			view.dispatch(insertParagraphAt(state.apply(tr), block.pos))
			return true
		}
		if (event.key === "Enter" && event.shiftKey) {
			if (type === "code-block") view.dispatch(state.tr.insertText("\n").scrollIntoView())
			else if (type === "blockquote")
				view.dispatch(
					block.node.textContent.trim() === ""
						? insertParagraphAt(state, block.pos + block.node.nodeSize)
						: state.tr.insertText("\n").scrollIntoView(),
				)
			// An empty list item ends the list, as in Discord and Slack.
			else if (type === "list-item" && block.node.content.size === 0)
				view.dispatch(setBlockType(state.tr, block.pos, "paragraph"))
			else view.dispatch(splitKeepingType(state.tr))
			return true
		}
		if (event.key === "Enter") {
			if (type === "code-block")
				view.dispatch(
					block.node.textContent.trim() === ""
						? setBlockType(state.tr, block.pos, "paragraph")
						: state.tr.insertText("\n").scrollIntoView(),
				)
			else submit(view)
			return true
		}
		return false
	}

	return new Plugin({ props: { handleKeyDown, handleTextInput } })
}
