/**
 * Where `popover.anchorTo({key, run})` points on the web (lane A3). A leaf that draws runs (a message
 * body, rich text) marks each run's element `data-hz-run=<index>`; the host never sees view keys, so
 * the leaf is found by `data-hz-key=<key>` when one carries it, else as the leaf whose run was pressed
 * last (the press that raised `pressMention` with that `run`).
 */
// HAZEL-GAP(leaf-anchor-key): leaves (message, richText) mark runs `data-hz-run`; keys need host support.
import type { LeafAnchor } from "../../vocabulary/content.ts"

export const runAttribute = "data-hz-run"
export const keyAttribute = "data-hz-key"

interface Pressed {
	readonly element: WeakRef<Element>
	readonly run: number
}

const lastPress = new WeakMap<Document, Pressed>()
const watched = new WeakSet<Document>()

/** Records presses on run elements in `document`, once. */
export const watchRunPresses = (document: Document) => {
	if (watched.has(document)) return
	watched.add(document)
	document.addEventListener(
		"pointerdown",
		(event) => {
			const target = event.target instanceof Element ? event.target : null
			const run = target?.closest(`[${runAttribute}]`)
			if (run === null || run === undefined) return
			const index = Number(run.getAttribute(runAttribute))
			if (Number.isFinite(index)) lastPress.set(document, { element: new WeakRef(run), run: index })
		},
		true,
	)
	// A keyboard press on a focused run counts too.
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key !== "Enter" && event.key !== " ") return
			const run = event.target instanceof Element ? event.target.closest(`[${runAttribute}]`) : null
			if (run === null) return
			const index = Number(run.getAttribute(runAttribute))
			if (Number.isFinite(index)) lastPress.set(document, { element: new WeakRef(run), run: index })
		},
		true,
	)
}

/** The element `anchor` names, or undefined when the leaf or run is not drawn. */
export const resolveLeafAnchor = (document: Document, anchor: LeafAnchor): Element | undefined => {
	// A quoted attribute value only needs its quotes and backslashes escaped.
	const key = anchor.key.replaceAll(/["\\]/g, "\\$&")
	const keyed = document.querySelector(`[${keyAttribute}="${key}"]`)
	if (keyed !== null) return keyed.querySelector(`[${runAttribute}="${String(anchor.run)}"]`) ?? keyed
	const pressed = lastPress.get(document)
	const element = pressed?.element.deref()
	return pressed !== undefined && pressed.run === anchor.run && element?.isConnected === true
		? element
		: undefined
}

/** Whether a prop value is a `LeafAnchor`. */
export const isLeafAnchor = (value: unknown): value is LeafAnchor =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { key?: unknown }).key === "string" &&
	typeof (value as { run?: unknown }).run === "number"
