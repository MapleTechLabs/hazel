import { Slice } from "prosemirror-model"
import { Selection, TextSelection } from "prosemirror-state"
import type { EditorView } from "prosemirror-view"
import { createComposerEditor, type EditorEvent } from "../editor/editor-view"
import { blocksOf, serializeToMarkdown } from "../editor/markdown"
import { schema } from "../editor/schema"

/**
 * The real composer editor (every plugin `createComposerEditor` installs) on a jsdom element, for
 * keyboard tests. Keys go through ProseMirror's own `keydown` listener, so a test sees what the
 * editor does with them; `handled: false` means the browser's default action would run, which
 * jsdom does not perform (those cases live in `*.browser.test.ts`).
 */

// jsdom has no layout: ProseMirror's `scrollIntoView` and caret checks measure ranges.
const emptyRect = {
	x: 0,
	y: 0,
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	width: 0,
	height: 0,
	toJSON: () => ({}),
}
if (typeof Range !== "undefined" && !Range.prototype.getClientRects) {
	Range.prototype.getClientRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
	Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect
}

export interface Modifiers {
	readonly shift?: boolean
	readonly mod?: boolean
	readonly alt?: boolean
	readonly composing?: boolean
}

export interface EditorHarness {
	readonly view: EditorView
	/** The draft as the composer would send it. */
	readonly markdown: () => string
	/** The block types, top to bottom. */
	readonly blocks: () => ReadonlyArray<string>
	/** The selected text (empty for a caret). */
	readonly selectedText: () => string
	readonly isAllSelected: () => boolean
	/** Events the editor emitted, oldest first; `ChangedDoc`/`ChangedAutocomplete` are left out. */
	readonly events: () => ReadonlyArray<EditorEvent>
	readonly autocomplete: () => EditorEvent | undefined
	/** Press a key; returns whether the editor took it (prevented the default). */
	readonly press: (key: string, modifiers?: Modifiers) => boolean
	/** Type text one character at a time through the editor's text-input hook. */
	readonly type: (text: string) => void
	readonly paste: (text: string, files?: ReadonlyArray<File>) => boolean
	/** Put the caret after the first occurrence of `text`, or at a block boundary. */
	readonly caretAfter: (text: string) => void
	readonly caretBefore: (text: string) => void
	readonly caretAtStart: () => void
	readonly caretAtEnd: () => void
	readonly select: (text: string) => void
	readonly insertMention: (displayName: string) => void
	readonly destroy: () => void
}

const isHousekeeping = (event: EditorEvent) =>
	event._tag === "ChangedDoc" || event._tag === "ChangedAutocomplete"

export const makeEditor = (initialMarkdown = ""): EditorHarness => {
	const element = document.createElement("div")
	document.body.append(element)
	const emitted: Array<EditorEvent> = []
	const view = createComposerEditor(element, {
		placeholder: "Type a message...",
		initialMarkdown,
		listboxId: "composer-autocomplete",
		emit: (event) => emitted.push(event),
	})

	const find = (text: string) => {
		let found: { from: number; to: number } | null = null
		view.state.doc.descendants((node, pos) => {
			if (found || !node.isText) return !found
			const index = node.text?.indexOf(text) ?? -1
			if (index >= 0) found = { from: pos + index, to: pos + index + text.length }
			return false
		})
		if (!found)
			throw new Error(`"${text}" is not in the editor: ${JSON.stringify(view.state.doc.textContent)}`)
		return found as { from: number; to: number }
	}
	const setSelection = (from: number, to = from) =>
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))

	const press = (key: string, modifiers: Modifiers = {}) => {
		const isMac = /Mac/.test(navigator.platform)
		const event = new KeyboardEvent("keydown", {
			key,
			shiftKey: modifiers.shift ?? false,
			altKey: modifiers.alt ?? false,
			metaKey: (modifiers.mod ?? false) && isMac,
			ctrlKey: (modifiers.mod ?? false) && !isMac,
			isComposing: modifiers.composing ?? false,
			bubbles: true,
			cancelable: true,
		})
		view.dom.dispatchEvent(event)
		return event.defaultPrevented
	}

	const type = (text: string) => {
		for (const char of text) {
			const { from, to } = view.state.selection
			const handled = view.someProp("handleTextInput", (handle) =>
				handle(view, from, to, char, () => view.state.tr.insertText(char, from, to)),
			)
			if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
		}
	}

	const paste = (text: string, files: ReadonlyArray<File> = []) => {
		const clipboardData = {
			files: files as unknown as FileList,
			items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
			getData: (format: string) => (format === "text/plain" ? text : ""),
		}
		const event = Object.assign(new Event("paste", { cancelable: true }), {
			clipboardData,
		}) as unknown as ClipboardEvent
		return view.someProp("handlePaste", (handle) => handle(view, event, Slice.empty)) ?? false
	}

	return {
		view,
		markdown: () => serializeToMarkdown(blocksOf(view.state.doc)),
		blocks: () => blocksOf(view.state.doc).map((node) => node.type.name),
		selectedText: () =>
			view.state.doc.textBetween(view.state.selection.from, view.state.selection.to, "\n"),
		isAllSelected: () =>
			view.state.selection.from === Selection.atStart(view.state.doc).from &&
			view.state.selection.to === Selection.atEnd(view.state.doc).to &&
			!view.state.selection.empty,
		events: () => emitted.filter((event) => !isHousekeeping(event)),
		autocomplete: () => emitted.findLast((event) => event._tag === "ChangedAutocomplete"),
		press,
		type,
		paste,
		caretAfter: (text) => setSelection(find(text).to),
		caretBefore: (text) => setSelection(find(text).from),
		caretAtStart: () => setSelection(1),
		caretAtEnd: () => setSelection(TextSelection.atEnd(view.state.doc).from),
		select: (text) => {
			const { from, to } = find(text)
			setSelection(from, to)
		},
		insertMention: (displayName) =>
			view.dispatch(
				view.state.tr.replaceSelectionWith(
					schema.nodes.mention.create({ userId: `user-${displayName}`, displayName }),
				),
			),
		destroy: () => {
			view.destroy()
			element.remove()
		},
	}
}
