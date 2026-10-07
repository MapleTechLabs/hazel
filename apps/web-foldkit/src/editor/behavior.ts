import { detectLanguage } from "~/components/chat/slate-editor/detect-language"
import { joinBackward, joinForward } from "prosemirror-commands"
import { redo, undo } from "prosemirror-history"
import type { Node as ProseMirrorNode } from "prosemirror-model"
import { AllSelection, type EditorState, Plugin, TextSelection, type Transaction } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { blocksOf, isValueEmpty, serializeToMarkdown } from "./markdown"
import { autocompleteKey, canActivateTrigger, DEFAULT_TRIGGERS, isAutocompleteOpen } from "./plugins"
import { schema } from "./schema"

/**
 * Keyboard and text-input behavior of the legacy `SlateMessageEditor`: `withAutoformat`,
 * `withAutocomplete`'s trigger activation and the `handleKeyDown` branches, in the same
 * order. Host-facing results (submit, escape, autocomplete keys) go out through `emit`.
 */

export type AutocompleteKey = "ArrowDown" | "ArrowUp" | "Enter" | "Tab" | "Escape"

export type BehaviorEvent =
	| { readonly _tag: "Submitted"; readonly markdown: string }
	| { readonly _tag: "PressedAutocompleteKey"; readonly key: AutocompleteKey }
	| { readonly _tag: "PressedEscape" }
	| { readonly _tag: "PressedArrowUpInEmpty" }
	| { readonly _tag: "PastedFiles"; readonly files: ReadonlyArray<File> }

const currentBlock = (state: EditorState) => {
	const { $from } = state.selection
	return { node: $from.parent, start: $from.start(), end: $from.end(), pos: $from.before() }
}

const setBlockType = (tr: Transaction, pos: number, type: string, attrs: Record<string, unknown> | null = null) =>
	tr.setNodeMarkup(pos, schema.nodes[type], attrs)

/** `maybeDetectLanguage`: set a code block's language from its content if unset. */
const withDetectedLanguage = (tr: Transaction, node: ProseMirrorNode, pos: number) => {
	if (node.type.name !== "code-block" || node.attrs.language || !node.textContent.trim()) return tr
	const language = detectLanguage(node.textContent)
	return language ? tr.setNodeMarkup(pos, undefined, { ...node.attrs, language }) : tr
}

/** `withAutoformat`: a space after a block prefix converts the block. */
const AUTOFORMAT: ReadonlyArray<{ match: (before: string) => boolean; type: string; attrs: (before: string) => Record<string, unknown> | null }> = [
	{ match: (before) => before === ">" || before === ">>>", type: "blockquote", attrs: () => null },
	{ match: (before) => before === "```", type: "code-block", attrs: () => ({ language: null }) },
	{ match: (before) => /^```(\w+)$/.test(before), type: "code-block", attrs: (before) => ({ language: before.slice(3) }) },
	{ match: (before) => before === "-#", type: "subtext", attrs: () => null },
	{ match: (before) => before === "-" || before === "*", type: "list-item", attrs: () => ({ ordered: false }) },
	{ match: (before) => /^(\d+)\.$/.test(before), type: "list-item", attrs: () => ({ ordered: true }) },
]

const handleTextInput = (view: EditorView, from: number, to: number, text: string): boolean => {
	const { state } = view
	if (view.composing || from !== to || !state.selection.empty) return false
	const block = currentBlock(state)

	if (text === " ") {
		const before = state.doc.textBetween(block.start, from, "\n", "")
		const rule = AUTOFORMAT.find((candidate) => candidate.match(before))
		if (rule) {
			view.dispatch(setBlockType(state.tr.delete(block.start, from), block.pos, rule.type, rule.attrs(before)))
			return true
		}
	}

	const trigger = DEFAULT_TRIGGERS.find((candidate) => candidate.char === text)
	if (trigger && !isAutocompleteOpen(state) && canActivateTrigger(state, trigger, from)) {
		view.dispatch(
			state.tr.insertText(text, from, to).setMeta(autocompleteKey, { trigger, search: "", from, optionCount: 0 }),
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

/** `withFilePaste`'s accepted types (`ACCEPTED_FILE_TYPES`). */
const ACCEPTED_FILE_TYPES = [
	"image/*",
	"video/*",
	"audio/*",
	"application/pdf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.ms-excel",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"text/plain",
	"text/csv",
]

const isFileTypeAccepted = (type: string) =>
	ACCEPTED_FILE_TYPES.some((accepted) =>
		accepted.endsWith("/*") ? type.startsWith(accepted.slice(0, -1)) : type === accepted,
	)

/** `withFilePaste`: copied files first, else image items (screenshots). */
const pastedFiles = (data: DataTransfer): ReadonlyArray<File> => {
	const files = Array.from(data.files).filter((file) => isFileTypeAccepted(file.type))
	if (files.length > 0) return files
	return Array.from(data.items).flatMap((item) => {
		const file = item.kind === "file" && isFileTypeAccepted(item.type) ? item.getAsFile() : null
		return file ? [file] : []
	})
}

const AUTOCOMPLETE_KEYS: ReadonlyArray<string> = ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]

export const behaviorPlugin = (emit: (event: BehaviorEvent) => void, isUploading: () => boolean) => {
	const submit = (view: EditorView) => {
		if (isUploading()) return
		// Legacy detects languages for unlabeled code blocks on submit.
		let tr = view.state.tr
		view.state.doc.forEach((node, offset) => {
			tr = withDetectedLanguage(tr, node, offset)
		})
		if (tr.docChanged) view.dispatch(tr)
		// The host decides about empty drafts: legacy allows them when attachments are pending.
		emit({ _tag: "Submitted", markdown: serializeToMarkdown(blocksOf(view.state.doc)).trim() })
	}

	const handleKeyDown = (view: EditorView, event: KeyboardEvent): boolean => {
		if (event.isComposing) return false
		const { state } = view
		const autocomplete = autocompleteKey.getState(state)
		if (autocomplete?.trigger && autocomplete.optionCount > 0 && AUTOCOMPLETE_KEYS.includes(event.key)) {
			emit({ _tag: "PressedAutocompleteKey", key: event.key as AutocompleteKey })
			return true
		}
		const block = currentBlock(state)
		const type = block.node.type.name
		const mod = event.metaKey || event.ctrlKey

		if (event.key === "ArrowUp" && isValueEmpty(blocksOf(state.doc))) {
			emit({ _tag: "PressedArrowUpInEmpty" })
			return true
		}
		if (event.key === "Escape") {
			emit({ _tag: "PressedEscape" })
			return true
		}
		if (mod && event.key === "a") {
			view.dispatch(
				state.tr.setSelection(
					type === "code-block" || type === "blockquote"
						? TextSelection.create(state.doc, block.start, block.end)
						: new AllSelection(state.doc),
				),
			)
			return true
		}
		if (mod && !event.shiftKey && event.key === "z") return undo(state, view.dispatch)
		if (mod && ((event.shiftKey && event.key === "z") || event.key === "y")) return redo(state, view.dispatch)

		if (event.key === "Backspace" && state.selection.empty) {
			if (isAtStart(state) && ["blockquote", "code-block", "list-item", "subtext"].includes(type)) {
				view.dispatch(setBlockType(state.tr, block.pos, "paragraph"))
				return true
			}
			// Slate deletes an inline void in one step.
			const before = state.selection.$from.nodeBefore
			if (before?.isAtom) {
				view.dispatch(state.tr.delete(state.selection.from - before.nodeSize, state.selection.from))
				return true
			}
			return joinBackward(state, view.dispatch, view)
		}
		if (event.key === "Delete" && state.selection.empty) {
			const after = state.selection.$from.nodeAfter
			if (after?.isAtom) {
				view.dispatch(state.tr.delete(state.selection.from, state.selection.from + after.nodeSize))
				return true
			}
			return joinForward(state, view.dispatch, view)
		}

		if ((type === "code-block" || type === "blockquote") && event.key === "ArrowDown" && isAtEnd(state)) {
			const tr = withDetectedLanguage(state.tr, block.node, block.pos)
			view.dispatch(insertParagraphAt(state.apply(tr), block.pos + block.node.nodeSize))
			return true
		}
		if ((type === "code-block" || type === "blockquote") && event.key === "ArrowUp" && isAtStart(state)) {
			const tr = withDetectedLanguage(state.tr, block.node, block.pos)
			view.dispatch(insertParagraphAt(state.apply(tr), block.pos))
			return true
		}

		if (event.key === "Enter" && event.shiftKey) {
			if (type === "code-block") {
				view.dispatch(state.tr.insertText("\n").scrollIntoView())
				return true
			}
			if (type === "blockquote") {
				const isLineEmpty = block.node.textContent.trim() === ""
				view.dispatch(
					isLineEmpty
						? insertParagraphAt(state, block.pos + block.node.nodeSize)
						: state.tr.insertText("\n").scrollIntoView(),
				)
				return true
			}
			view.dispatch(splitKeepingType(state.tr))
			return true
		}

		if (event.key === "Enter") {
			if (type === "code-block") {
				view.dispatch(
					block.node.textContent.trim() === ""
						? setBlockType(state.tr, block.pos, "paragraph")
						: state.tr.insertText("\n").scrollIntoView(),
				)
				return true
			}
			if (["paragraph", "blockquote", "list-item", "subtext"].includes(type)) submit(view)
			return true
		}
		return false
	}

	return new Plugin({
		props: {
			handleKeyDown,
			handleTextInput,
			// Legacy pastes plain text: inside code blocks verbatim, elsewhere one block per line.
			handlePaste: (view, event) => {
				const files = event.clipboardData ? pastedFiles(event.clipboardData) : []
				if (files.length > 0) {
					emit({ _tag: "PastedFiles", files })
					return true
				}
				const text = event.clipboardData?.getData("text/plain")
				if (!text) return false
				const lines = text.replace(/\r\n?/g, "\n").split("\n")
				if (currentBlock(view.state).node.type.name === "code-block" || lines.length === 1) {
					view.dispatch(view.state.tr.insertText(text.replace(/\r\n?/g, "\n")).scrollIntoView())
					return true
				}
				const tr = view.state.tr
				lines.forEach((line, index) => {
					if (index > 0) splitKeepingType(tr)
					if (line) tr.insertText(line)
				})
				view.dispatch(tr.scrollIntoView())
				return true
			},
		},
	})
}
