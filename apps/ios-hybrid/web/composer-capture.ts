/**
 * The message composer for the native composer (`HazelHybrid/NativeComposer.swift`): how the web
 * draws it (its box, type, placeholder, buttons), and the two things the native one asks of it.
 * Typing goes into the web's editor (`setDraft`), so drafts, typing indicators and sending stay the
 * app's own; `send` presses the web's own send.
 *
 * The web's composer stays laid out, unseen: the web view never resizes for this keyboard, so
 * WebKit never makes the shell wait on a page layout while the keyboard moves.
 */
import { composerEditorOf, replaceDraft } from "../../web-foldkit/src/editor/editor-view"
import { hex, iconKey } from "./look"

type Text = { color: string; size: number; weight: number }

export type ComposerLook = {
	/** The composer box: its fill, border and corners, and where it sits in the page. */
	box: {
		x: number
		y: number
		w: number
		h: number
		bg: string
		border: string
		bw: number
		radius: number
	}
	font: Text
	placeholder: { text: string; color: string }
	/** Attach, GIF, Emoji: what each is called, its icon, and the element a press clicks. */
	actions: Array<{ id: string; label: string; icon?: string; font: Text }>
	send: { id: string; icon?: string; bg: string; color: string; size: number }
	hasContent: boolean
	/** Below the box to the page's bottom edge (its padding, the home indicator's room). */
	bottom: number
}

const px = (value: string) => Number.parseFloat(value) || 0

const textOf = (element: Element): Text => {
	const style = getComputedStyle(element)
	return { color: hex(style.color), size: px(style.fontSize), weight: Number(style.fontWeight) || 400 }
}

/** A button's own words: its text outside icons (an icon may draw letters of its own). */
const labelOf = (button: Element): string =>
	Array.from(button.childNodes)
		.map((node) => (node instanceof SVGElement ? "" : (node.textContent ?? "")))
		.join("")
		.trim()

/** A colour as drawn: its alpha times the element's opacity (a placeholder fades by opacity). */
const drawnColor = (element: Element): string => {
	const style = getComputedStyle(element)
	const color = hex(style.color)
	const alpha = Math.round(Number.parseInt(color.slice(7), 16) * (Number.parseFloat(style.opacity) || 1))
	return `${color.slice(0, 7)}${alpha.toString(16).padStart(2, "0")}`
}

const ids = new WeakMap<Element, string>()
const elements = new Map<string, WeakRef<HTMLElement>>()
let nextId = 0
const idOf = (element: HTMLElement) => {
	let id = ids.get(element)
	if (id === undefined) {
		id = `c${nextId++}`
		ids.set(element, id)
	}
	elements.set(id, new WeakRef(element))
	return id
}

const composer = () =>
	Array.from(document.querySelectorAll<HTMLElement>('[data-ui="composer"]')).find((element) =>
		element.checkVisibility({ checkVisibilityCSS: false }),
	)

const editorOf = (root: HTMLElement) => root.querySelector<HTMLElement>(".ProseMirror")

export const readComposer = (): ComposerLook | null => {
	const root = composer()
	const editor = root === undefined ? null : editorOf(root)
	if (root === undefined || editor === null) return null
	// The box is the editor's nearest bordered ancestor.
	let box: HTMLElement = editor
	while (box.parentElement !== null && px(getComputedStyle(box).borderTopWidth) === 0 && box !== root) {
		box = box.parentElement
	}
	const boxStyle = getComputedStyle(box)
	const rect = box.getBoundingClientRect()
	const props = JSON.parse(root.getAttribute("data-ui-props") ?? "{}")
	const placeholder =
		editor.querySelector("[data-slate-placeholder]") ?? root.querySelector("[data-slate-placeholder]")
	const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
	const send = buttons.find((button) => button.getAttribute("aria-label") === "Send message")
	const sendStyle = send === undefined ? null : getComputedStyle(send)
	const sendIcon = send?.querySelector("svg")
	const sendLook: ComposerLook["send"] = {
		id: send === undefined ? "" : idOf(send),
		bg: sendStyle === null ? "#00000000" : hex(sendStyle.backgroundColor),
		color: sendStyle === null ? "#ffffffff" : hex(sendStyle.color),
		size: send?.getBoundingClientRect().width ?? 28,
	}
	const sendKey = sendIcon === null || sendIcon === undefined ? undefined : iconKey(sendIcon)
	if (sendKey !== undefined) sendLook.icon = sendKey
	return {
		box: {
			x: rect.left,
			y: rect.top,
			w: rect.width,
			h: rect.height,
			bg: hex(boxStyle.backgroundColor),
			border: hex(boxStyle.borderTopColor),
			bw: px(boxStyle.borderTopWidth),
			radius: px(boxStyle.borderTopLeftRadius),
		},
		font: textOf(editor),
		placeholder: {
			text: typeof props.placeholder === "string" ? props.placeholder : "",
			color: placeholder === null ? hex("gray") : drawnColor(placeholder),
		},
		actions: buttons
			.filter((button) => button !== send && labelOf(button).length > 0)
			.map((button) => {
				const icon = button.querySelector("svg")
				const action: ComposerLook["actions"][number] = {
					id: idOf(button),
					label: labelOf(button),
					font: textOf(button),
				}
				const key = icon === null ? undefined : iconKey(icon)
				if (key !== undefined) action.icon = key
				return action
			}),
		send: sendLook,
		hasContent: props.hasContent === true,
		bottom: window.innerHeight - rect.bottom,
	}
}

/** The draft is `text`: the web's editor gets it as typed text (its own input path). */
export const setDraft = (text: string) => {
	const root = composer()
	const editor = root === undefined ? null : editorOf(root)
	const view = editor === null ? undefined : composerEditorOf(editor)
	// Through the editor's own transactions, never focusing it: a focused web field would start
	// WebKit's text input on the shell's main thread, under the native composer's keyboard.
	if (view !== undefined) replaceDraft(view, text)
}

/**
 * Presses the web's own send once the draft above has reached the app: the composer says so itself
 * (`hasContent` in its semantic props, from its Model), a few frames later. Gives up after a second.
 */
export const send = (text: string) => {
	setDraft(text)
	const startedAt = performance.now()
	const tryPress = () => {
		const root = composer()
		const props = JSON.parse(root?.getAttribute("data-ui-props") ?? "{}")
		if (props.hasContent === true) {
			root?.querySelector<HTMLElement>('button[aria-label="Send message"]')?.click()
			return
		}
		if (performance.now() - startedAt < 1000) requestAnimationFrame(tryPress)
	}
	requestAnimationFrame(tryPress)
}

/** A press on one of the composer's buttons (Attach opens the system's file picker). */
export const pressAction = (id: string) => elements.get(id)?.deref()?.click()
