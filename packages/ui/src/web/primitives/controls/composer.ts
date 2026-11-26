/**
 * `hz:composer` (phase 2 leaf; the rich editor is phase 3): a growing `textarea` with the G5 revision
 * pair, a send button, and the `above` and `actions` slots placed by grid (`styles.ts`). Enter sends,
 * Shift+Enter is a new line. `@ # / :` at a word start opens a trigger (`trigger {kind, query}`); while
 * one is open, arrows, Enter, Tab and Escape raise `key` instead. Dropped or pasted files raise `files`.
 * Phase 4 (W12a): the screen's `suggestions` as a listbox over the field (`activeSuggestion` marked,
 * pressing one raises `pressSuggestion`), the reply or edit bar from `context` (its close and Escape
 * raise `cancelContext`), and Up in an empty composer raises `editLast`.
 */
// Owned by lane A2.
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import type { ComposerContext, Face, Suggestion } from "../../../vocabulary/content.ts"
import type { ComposerKey } from "../../../vocabulary/options.ts"
import { glyph, svg } from "../../icons.ts"
import { ditherLayer } from "../content/dither.ts"
import { ensureStyles as ensureContentStyles } from "../content/styles.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { primitive as buttonRenderer } from "./button.ts"
import { ensureComposerStyles } from "./composer-styles.ts"
import { fire, focusEvents, handles, revisioned, uniqueId } from "./field.ts"
import { ensureStyles } from "./styles.ts"

type TriggerKind = "@" | "#" | "/" | ":"
interface Trigger {
	readonly kind: TriggerKind
	readonly query: string
}

/** The trigger the caret is in: a trigger character at a word start, then no whitespace. */
export const triggerAt = (text: string, caret: number): Trigger | undefined => {
	const before = text.slice(0, caret)
	const match = /(?:^|\s)([@#/:])([^\s@#/:]*)$/.exec(before)
	if (match === null) return undefined
	const kind = match[1] as TriggerKind
	// A command is the message's first word only.
	if (kind === "/" && before.trimStart().indexOf("/") !== 0) return undefined
	return { kind, query: match[2] ?? "" }
}

const keys: ReadonlyMap<string, ComposerKey> = new Map([
	["ArrowUp", "up"],
	["ArrowDown", "down"],
	["Enter", "enter"],
	["Tab", "tab"],
	["Escape", "escape"],
])

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

export const primitive = definePrimitive("composer", ({ document, tag, outer }) => {
	ensureStyles(document)
	ensureContentStyles(document)
	ensureComposerStyles(document)
	const node = outer("div")
	const content = part(document, "div", "content")
	const area = part(document, "textarea", "input") as HTMLTextAreaElement
	area.rows = 1
	area.dataset.hzFocus = ""
	area.setAttribute("aria-label", "Message")
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
	node.append(bar, content, area, send, panel)

	const events = () => primitive.events
	let suggestions: ReadonlyArray<Suggestion> = []
	let active: string | undefined
	let context: ComposerContext | undefined
	/** The last trigger opened: the `/` list draws today's bot command rows. */
	let lastKind: TriggerKind | undefined
	const rows = new Map<string, HTMLElement>()

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
		const anchor = Math.max(0, area.offsetTop - padding)
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
		if (current === undefined || panel.hidden) area.removeAttribute("aria-activedescendant")
		else {
			area.setAttribute("aria-activedescendant", current.id)
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
			area.setAttribute("aria-controls", panel.id)
			area.setAttribute("aria-expanded", "true")
		} else {
			area.removeAttribute("aria-controls")
			area.removeAttribute("aria-expanded")
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
			const row = suggestionRow(document, suggestion, `${panel.id}-${index}`, command)
			rows.set(suggestion.id, row)
			children.push(row)
		}
		panel.replaceChildren(...children)
		if (open) place()
		markActive()
	}
	let trigger: Trigger | undefined
	let canSend = false
	let disabled = false
	const syncTrigger = () => {
		const next =
			area.selectionStart === area.selectionEnd ? triggerAt(area.value, area.selectionStart) : undefined
		if (next?.kind === trigger?.kind && next?.query === trigger?.query) return
		const closed = trigger
		trigger = next
		if (next !== undefined && next.kind !== lastKind) {
			lastKind = next.kind
			option(panel, "trigger", lastKind)
		}
		if (next !== undefined) fire(events(), "trigger", { kind: next.kind, query: next.query })
		else if (closed !== undefined) fire(events(), "trigger", { kind: closed.kind, query: null })
	}
	const text = revisioned(area, (change) => {
		fire(events(), "change", { ...change })
	})
	area.addEventListener("input", syncTrigger)
	area.addEventListener("click", syncTrigger)
	area.addEventListener("keyup", (event) => {
		if (event.key.startsWith("Arrow") && trigger === undefined) syncTrigger()
	})
	focusEvents(area, events)
	const submit = () => {
		if (disabled) return
		fire(events(), "submit", { ...text.current() })
	}
	area.addEventListener("keydown", (event) => {
		if (event.isComposing) return
		const key = keys.get(event.key)
		if (trigger !== undefined && key !== undefined && handles(events(), "key") && !event.shiftKey) {
			event.preventDefault()
			fire(events(), "key", { key })
			if (key === "escape") trigger = undefined
			return
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault()
			if (canSend) submit()
			return
		}
		const bare = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
		// Up in an empty composer edits the last message (today's `write.ts` ArrowUp-to-edit).
		if (event.key === "ArrowUp" && bare && area.value === "" && fire(events(), "editLast", {}))
			event.preventDefault()
		else if (event.key === "Escape" && context !== undefined && fire(events(), "cancelContext", {}))
			event.preventDefault()
	})
	send.addEventListener("click", submit)

	const takeFiles = (files: FileList | null | undefined, event: Event) => {
		if (files === null || files === undefined || files.length === 0 || !handles(events(), "files")) return
		event.preventDefault()
		dropped = [...files]
		fire(events(), "files", { count: files.length })
	}
	area.addEventListener("paste", (event) => takeFiles(event.clipboardData?.files, event))
	node.addEventListener("dragover", (event) => {
		if (event.dataTransfer?.types.includes("Files") === true) event.preventDefault()
	})
	node.addEventListener("drop", (event) => takeFiles(event.dataTransfer?.files, event))

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "placeholder") {
				area.placeholder = typeof value === "string" ? value : ""
				area.setAttribute("aria-label", typeof value === "string" ? value : "Message")
			} else if (name === "value") {
				text.receive(value)
				syncTrigger()
			} else if (name === "disabled") {
				disabled = value === true
				area.disabled = disabled
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
