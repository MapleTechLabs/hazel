/**
 * `hz:composer`: a ProseMirror editor over markdown text (W12b, `composer/editor.ts`) with the G5
 * revision pair, a send button, and the `above` and `actions` slots placed by grid (`styles.ts`). Enter
 * sends, Shift+Enter is a new line; markdown stays in the text, highlighted, and `@[userId:...]` and
 * `![custom-emoji:...](...)` draw as atoms. `@ # / :` typed at a word start opens a trigger (`trigger
 * {kind, query}`); while its suggestions show, arrows, Enter, Tab and Escape raise `key`. Dropped or
 * pasted files raise `files`. W12a: the `suggestions` listbox (`pressSuggestion`), the `context` bar
 * (`cancelContext`), and Up in an empty composer (`editLast`).
 */
// Owned by lane A2.
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import type { ComposerContext, Face, Suggestion } from "../../../vocabulary/content.ts"
import { glyph, svg } from "../../icons.ts"
import { ditherLayer } from "../content/dither.ts"
import { ensureStyles as ensureContentStyles } from "../content/styles.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { primitive as buttonRenderer } from "./button.ts"
import { ensureComposerStyles } from "./composer-styles.ts"
import * as Revisions from "../../../native/revisions.ts"
import { createEditor, type Trigger } from "./composer/editor.ts"
import { carriesFiles, transferFiles } from "./composer/files.ts"
import { fire, handles, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

let dropped: ReadonlyArray<File> = []
/** The files of the last `files` event, for the web's `Files.dropped` (lane F); taking clears them. */
export const takeDropped = (): ReadonlyArray<File> => {
	const files = dropped
	dropped = []
	return files
}

const isSuggestions = (value: unknown): value is ReadonlyArray<Suggestion> => Array.isArray(value)
const isContext = (value: unknown): value is ComposerContext =>
	typeof value === "object" && value !== null && "kind" in value && "text" in value

const textPart = (document: Document, tagName: string, name: string, content: string) => {
	const node = part(document, tagName, name)
	node.textContent = content
	return node
}

/** Today's `avatar` `xs`: the picture, else the dither seeded by the name under one initial. */
const faceOf = (document: Document, face: Face, mark: string | undefined, px: number) => {
	const box = part(document, "span", "suggestionFace")
	box.setAttribute("aria-hidden", "true")
	if (face.src !== undefined) {
		const image = document.createElement("img")
		image.src = face.src
		image.alt = ""
		box.append(image)
	} else if (face.name.trim() !== "") {
		const dither = ditherLayer(document)
		dither.seed(face.name, px)
		box.dataset.seeded = ""
		box.append(dither.layer, textPart(document, "span", "initials", ditherInitial(face.name)))
	} else box.textContent = face.initials
	// A platform mark wins over presence, as today (`providerBadge`).
	if (mark !== undefined) {
		const badge = part(document, "span", "suggestionMark")
		option(badge, "mark", mark)
		glyph(badge, mark)
		box.append(badge)
	} else if (face.presence !== undefined && face.presence !== "none") {
		const dot = part(document, "span", "suggestionPresence")
		option(dot, "presence", face.presence)
		box.append(dot)
	}
	return box
}

/** One option row: the face, icon tile or emoji, then the label and description. */
const suggestionRow = (document: Document, suggestion: Suggestion, id: string, command: boolean) => {
	const row = part(document, "div", "suggestion")
	row.id = id
	row.setAttribute("role", "option")
	row.setAttribute("aria-selected", "false")
	row.dataset.id = suggestion.id
	if (suggestion.emoji !== undefined) {
		row.dataset.emoji = ""
		// A custom emoji is its image's url; a standard one is the glyph.
		if (/^(?:https?:|data:|blob:|\/)/.test(suggestion.emoji)) {
			const image = part(document, "img", "suggestionEmoji") as HTMLImageElement
			image.src = suggestion.emoji
			image.alt = ""
			row.append(image)
		} else {
			const glyphText = textPart(document, "span", "suggestionEmoji", suggestion.emoji)
			glyphText.setAttribute("aria-hidden", "true")
			row.append(glyphText)
		}
	} else if (suggestion.face !== undefined) {
		row.append(faceOf(document, suggestion.face, suggestion.mark, command ? 20 : 24))
	} else if (suggestion.icon !== undefined) {
		const tile = part(document, "span", "suggestionIcon")
		tile.setAttribute("aria-hidden", "true")
		tile.innerHTML = svg(suggestion.icon)
		row.append(tile)
	}
	const body = part(document, "div", "suggestionText")
	body.append(textPart(document, "div", "suggestionLabel", suggestion.label))
	if (suggestion.description !== undefined && suggestion.description !== "")
		body.append(textPart(document, "div", "suggestionDescription", suggestion.description))
	row.append(body)
	return row
}

/** A mention's name from its `@` suggestion: the label without a leading `@` (`@here` is `here`). */
const mentionName = (suggestion: Suggestion) => suggestion.label.replace(/^@/, "")

export const primitive = definePrimitive("composer", ({ document, tag, outer }) => {
	ensureStyles(document)
	ensureContentStyles(document)
	ensureComposerStyles(document)
	const node = outer("div")
	const content = part(document, "div", "content")
	const input = part(document, "div", "input")
	const send = part(document, "button", "send") as HTMLButtonElement
	send.type = "button"
	send.disabled = true
	send.setAttribute("aria-label", "Send")
	send.innerHTML = svg("arrow-up")
	send.firstElementChild?.setAttribute("aria-hidden", "true")
	send.firstElementChild?.setAttribute("data-hz-part", "sendIcon")
	// The reply or edit bar over the field, and the open trigger's suggestions anchored above it.
	const bar = part(document, "div", "context")
	bar.hidden = true
	const barLabel = part(document, "div", "contextLabel")
	const close = buttonRenderer.create({
		document,
		tag: "hz:button",
		outer: (tagName) => {
			const button = document.createElement(tagName)
			button.dataset.hz = "button"
			return button
		},
		self: (button, set) => ({ tag: "hz:button", outer: button, content: button, set, events: undefined }),
	})
	for (const [name, value] of [
		["label", "Cancel reply"],
		["icon", "close"],
		["variant", "ghost"],
		["size", "xsmall"],
		["iconOnly", true],
	] as const)
		close.set(name, value)
	close.outer.addEventListener("click", () => fire(events(), "cancelContext", {}))
	bar.append(barLabel, close.outer)
	const panel = part(document, "div", "suggestions")
	panel.id = uniqueId("suggestions")
	panel.setAttribute("role", "listbox")
	panel.setAttribute("aria-label", "Suggestions")
	panel.hidden = true
	// Pressing in the list keeps the focus and the caret in the field.
	panel.addEventListener("mousedown", (event) => event.preventDefault())
	panel.addEventListener("click", (event) => {
		const row = event.target instanceof Element ? event.target.closest("[data-hz-part=suggestion]") : null
		if (!(row instanceof HTMLElement) || row.dataset.id === undefined) return
		fire(events(), "pressSuggestion", { id: row.dataset.id })
	})

	const events = () => primitive.events
	let suggestions: ReadonlyArray<Suggestion> = []
	let active: string | undefined
	let context: ComposerContext | undefined
	/** The last trigger opened: the `/` list draws today's bot command rows. */
	let lastKind: Trigger["kind"] | undefined
	let placeholder = ""
	let field = Revisions.initial
	let canSend = false
	let disabled = false
	const rows = new Map<string, HTMLElement>()
	// HAZEL-GAP(composer-mention-names): a mention's name is its `@` suggestion's label, kept once seen;
	// a draft loaded with mentions the composer never suggested shows their ids.
	const names = new Map<string, string>()

	const editor = createEditor(input, {
		placeholder: () => placeholder,
		nameOf: (id) => names.get(id) ?? id,
		changed: (markdown) => {
			const next = Revisions.edit(field, markdown)
			field = next.field
			if (next.change !== undefined) fire(events(), "change", { ...next.change })
		},
		triggered: (next, previous) => {
			if (next !== null && next.kind !== lastKind) {
				lastKind = next.kind
				option(panel, "trigger", lastKind)
			}
			if (next !== null) fire(events(), "trigger", { kind: next.kind, query: next.query })
			else if (previous !== null) fire(events(), "trigger", { kind: previous.kind, query: null })
		},
		// Today's rule: the keys go to the suggestions only while some show.
		suggestionKey: (key) =>
			suggestions.length > 0 && handles(events(), "key") && fire(events(), "key", { key }),
		editLast: () => fire(events(), "editLast", {}),
		escape: () => context !== undefined && fire(events(), "cancelContext", {}),
		submit: () => {
			if (canSend && !disabled) fire(events(), "submit", { ...Revisions.current(field) })
		},
		files: (files) => takeFiles(files),
	})
	input.dataset.hzFocus = ""
	input.setAttribute("role", "textbox")
	input.setAttribute("aria-multiline", "true")
	input.setAttribute("aria-label", "Message")
	input.addEventListener("focus", () => fire(events(), "focus", {}))
	input.addEventListener("blur", () => fire(events(), "blur", {}))
	// HAZEL-GAP(composer-editor-teardown): the web host has no removal hook for a primitive, so the
	// editor's view is never destroyed; ProseMirror's document listeners outlive a removed composer.
	node.append(bar, content, input, send, panel)

	const drawContext = () => {
		bar.hidden = context === undefined
		flag(node, "context", context !== undefined)
		if (context === undefined) return barLabel.replaceChildren()
		const editing = context.kind === "edit"
		close.set("label", editing ? "Cancel editing" : "Cancel reply")
		if (editing) {
			// Today's edit bar names no text: an icon and "Editing message".
			const icon = part(document, "span", "contextIcon")
			icon.setAttribute("aria-hidden", "true")
			icon.innerHTML = svg("edit")
			barLabel.replaceChildren(icon, textPart(document, "span", "contextTitle", "Editing message"))
		} else
			barLabel.replaceChildren(
				textPart(document, "span", "contextPrefix", "Replying to"),
				...(context.author === undefined
					? []
					: [textPart(document, "span", "contextAuthor", context.author)]),
				textPart(document, "span", "contextText", context.text),
			)
	}

	/** Today's `FitAutocompleteHeight`: the room above the field less 16px, between 150 and 400. */
	const place = () => {
		const padding = Number.parseFloat(document.defaultView?.getComputedStyle(node).paddingTop ?? "") || 0
		const anchor = Math.max(0, input.offsetTop - padding)
		panel.style.top = `${anchor}px`
		const top = node.getBoundingClientRect().top + node.clientTop + anchor
		panel.style.maxHeight = `${Math.min(Math.max(top - 16, 150), 400)}px`
	}

	const markActive = () => {
		let current: HTMLElement | undefined
		for (const [id, row] of rows) {
			const on = id === active
			row.setAttribute("aria-selected", on ? "true" : "false")
			if (on) current = row
		}
		if (current === undefined || panel.hidden) input.removeAttribute("aria-activedescendant")
		else {
			input.setAttribute("aria-activedescendant", current.id)
			if (typeof current.scrollIntoView === "function") current.scrollIntoView({ block: "nearest" })
		}
	}

	const drawSuggestions = () => {
		rows.clear()
		// HAZEL-GAP(composer-suggestions-empty): today an open trigger with nothing found says so ("No
		// users found"); the contract has no empty text, so an empty list draws nothing.
		const open = suggestions.length > 0
		panel.hidden = !open
		option(panel, "trigger", lastKind)
		if (open) {
			input.setAttribute("aria-controls", panel.id)
			input.setAttribute("aria-expanded", "true")
		} else {
			input.removeAttribute("aria-controls")
			input.removeAttribute("aria-expanded")
		}
		// HAZEL-GAP(composer-command-args): today's `/` rows chip each argument; `Suggestion` has none.
		// HAZEL-GAP(composer-suggestion-hover): hover tints a row but cannot move `activeSuggestion`.
		// HAZEL-GAP(composer-suggestions-motion): today's panel slides in; the recipe has no motion yet.
		const command = lastKind === "/"
		const children: Array<HTMLElement> = []
		let group: string | undefined
		for (const [index, suggestion] of suggestions.entries()) {
			if (suggestion.group !== undefined && suggestion.group !== group) {
				const heading = textPart(document, "div", "suggestionGroup", suggestion.group)
				heading.setAttribute("role", "presentation")
				children.push(heading)
			}
			group = suggestion.group
			if (suggestion.emoji === undefined) names.set(suggestion.id, mentionName(suggestion))
			const row = suggestionRow(document, suggestion, `${panel.id}-${index}`, command)
			rows.set(suggestion.id, row)
			children.push(row)
		}
		panel.replaceChildren(...children)
		if (open) place()
		markActive()
	}
	send.addEventListener("click", () => {
		if (!disabled) fire(events(), "submit", { ...Revisions.current(field) })
	})

	/** Hands files to `Files.dropped` and reports them; false when the screen takes no files. */
	const takeFiles = (files: ReadonlyArray<File>) => {
		if (files.length === 0 || disabled || !handles(events(), "files")) return false
		dropped = files
		return fire(events(), "files", { count: files.length })
	}
	node.addEventListener("dragover", (event) => {
		if (carriesFiles(event.dataTransfer)) event.preventDefault()
	})
	node.addEventListener("drop", (event) => {
		if (event.dataTransfer === null || !carriesFiles(event.dataTransfer)) return
		// Taken or not, a file dropped here never opens in the tab.
		event.preventDefault()
		takeFiles(transferFiles(event.dataTransfer))
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "placeholder") {
				placeholder = typeof value === "string" ? value : ""
				input.setAttribute("aria-label", placeholder === "" ? "Message" : placeholder)
				editor.refresh()
			} else if (name === "value") {
				const incoming = Revisions.decode(value)
				if (incoming === undefined) return
				const next = Revisions.receive(field, incoming)
				field = next.field
				editor.receive(field.text)
				if (next.change !== undefined) fire(events(), "change", { ...next.change })
			} else if (name === "disabled") {
				disabled = value === true
				editor.setEditable(!disabled)
				if (disabled) input.setAttribute("aria-disabled", "true")
				else input.removeAttribute("aria-disabled")
				send.disabled = disabled || !canSend
				flag(node, "disabled", value)
			} else if (name === "suggestions") {
				suggestions = isSuggestions(value) ? value : []
				drawSuggestions()
			} else if (name === "activeSuggestion") {
				active = typeof value === "string" ? value : undefined
				markActive()
			} else if (name === "context") {
				context = isContext(value) ? value : undefined
				drawContext()
				if (!panel.hidden) place()
			} else if (name === "canSend") {
				canSend = value === true
				send.disabled = disabled || !canSend
				flag(node, "can-send", value)
			}
		},
		events: undefined,
	}
	return primitive
})
