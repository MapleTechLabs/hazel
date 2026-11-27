// Owned by lane A4. Helpers the structure and list renderers share; not a primitive (no `primitive`
// export, so the glob registry skips it).
import type { Plain, Primitive } from "../define.ts"

/**
 * Raises `event` on `primitive` when the view listens for it, with a plain-data payload. Returns
 * whether a handler took it.
 */
export const fire = (primitive: Primitive, event: string, payload: Plain = {}): boolean => {
	const events = primitive.events
	const handler = events?.handlers[event]
	return handler !== undefined && events !== undefined && events.dispatch(event, handler, payload)
}

/** Whether the view listens for `event` on `primitive`. */
export const listens = (primitive: Primitive, event: string): boolean =>
	primitive.events?.handlers[event] !== undefined

const sheets = new WeakMap<Document, Set<string>>()

/**
 * Installs a renderer-owned stylesheet once per document: what a recipe cannot say by design (C3
 * `rendererFeatures`: positioning, virtualization, hit areas, animations). Every value is a token.
 */
export const ensureSheet = (document: Document, id: string, css: string) => {
	const done = sheets.get(document) ?? new Set<string>()
	sheets.set(document, done)
	if (done.has(id)) return
	done.add(id)
	const style = document.createElement("style")
	style.dataset.hzSheet = id
	style.textContent = css
	// The head may belong to the Foldkit app (islands mount with `head: false`); a style element in
	// it is inert to Foldkit's head diff, which only owns the nodes it wrote.
	;(document.head ?? document.documentElement).append(style)
}

/**
 * A row's id for `move` and `scrollTo({key})`.
 * HAZEL-GAP(row-key): a row's `.key()` never reaches a host (Effect UI keeps keys in the kernel and
 * wire v2 has no key), so the id is the row's position unless a host sets `data-hz-key`.
 */
export const rowId = (row: Element, index: number): string =>
	row instanceof HTMLElement && row.dataset.hzKey !== undefined ? row.dataset.hzKey : String(index)

/** The rows of a content parent: its renderer children other than slots and header actions. */
export const rowsOf = (content: Element): ReadonlyArray<HTMLElement> =>
	[...content.children].filter(
		(child): child is HTMLElement =>
			child instanceof HTMLElement &&
			child.dataset.hz !== undefined &&
			child.dataset.hz !== "slot" &&
			child.dataset.hz !== "action",
	)

/** A plain primary click: no modifier, the main button. */
export const isPlainClick = (event: MouseEvent) =>
	event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

/** The text of a text prop, or empty. */
export const textOf = (value: Plain) => (typeof value === "string" ? value : "")
