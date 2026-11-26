/**
 * `hz:composer` (phase 2 leaf; the rich editor is phase 3): a growing `textarea` with the G5 revision
 * pair, a send button, and the `above` and `actions` slots placed by grid (`styles.ts`). Enter sends,
 * Shift+Enter is a new line. `@ # / :` at a word start opens a trigger (`trigger {kind, query}`); while
 * one is open, arrows, Enter, Tab and Escape raise `key` instead. Dropped or pasted files raise `files`.
 */
// Owned by lane A2.
import type { ComposerKey } from "../../../vocabulary/options.ts"
import { svg } from "../../icons.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { fire, focusEvents, handles, revisioned } from "./field.ts"
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

export const primitive = definePrimitive("composer", ({ document, tag, outer }) => {
	ensureStyles(document)
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
	node.append(content, area, send)

	const events = () => primitive.events
	let trigger: Trigger | undefined
	let canSend = false
	let disabled = false
	const syncTrigger = () => {
		const next =
			area.selectionStart === area.selectionEnd ? triggerAt(area.value, area.selectionStart) : undefined
		if (next?.kind === trigger?.kind && next?.query === trigger?.query) return
		const closed = trigger
		trigger = next
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
		}
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
