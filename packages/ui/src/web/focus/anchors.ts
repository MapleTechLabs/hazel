/**
 * Where `popover.anchorTo({key, run})` points on the web (lane A3): the element keyed `key` (the host
 * marks every keyed element `data-hz-key`, `row-key`), at its run `run` (leaves mark each run's
 * element `data-hz-run=<index>`), else the keyed element itself.
 */
import type { LeafAnchor } from "../../vocabulary/content.ts"

export const runAttribute = "data-hz-run"
export const keyAttribute = "data-hz-key"

/** The element `anchor` names, or undefined when the leaf or run is not drawn. */
export const resolveLeafAnchor = (document: Document, anchor: LeafAnchor): Element | undefined => {
	// A quoted attribute value only needs its quotes and backslashes escaped.
	const key = anchor.key.replaceAll(/["\\]/g, "\\$&")
	const keyed = document.querySelector(`[${keyAttribute}="${key}"]`)
	if (keyed === null) return undefined
	return keyed.querySelector(`[${runAttribute}="${String(anchor.run)}"]`) ?? keyed
}

/** Whether a prop value is a `LeafAnchor`. */
export const isLeafAnchor = (value: unknown): value is LeafAnchor =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { key?: unknown }).key === "string" &&
	typeof (value as { run?: unknown }).run === "number"
