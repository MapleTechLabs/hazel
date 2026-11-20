/**
 * The keyboard of the Customers worklists (Needs attention, the Support inbox): which keydown is
 * one of the page's keys. Typing in a field, a modifier, or a dialog or open menu holding the
 * keyboard means none; Enter and Space keep activating a focused button or link.
 */

/** The event's element; none for a key on the document itself (or outside a DOM). */
const elementOf = (target: EventTarget | null): HTMLElement | null =>
	typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null

const isEditable = (target: EventTarget | null): boolean => {
	const element = elementOf(target)
	return (
		element !== null &&
		(element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
	)
}

/** A dialog or an open menu has the keyboard (its own focus and keys). */
const isInOverlay = (target: EventTarget | null): boolean =>
	elementOf(target)?.closest("dialog, [role=dialog], [role=menu]") != null

/** Enter and Space keep activating a focused button or link. */
const isPressable = (target: EventTarget | null): boolean =>
	elementOf(target)?.closest("button, a, [role=menuitem]") != null

/** The arrows walk the list from a row or with nothing focused; anywhere else they scroll. */
const isArrowForQueue = (target: EventTarget | null): boolean => {
	const element = elementOf(target)
	return element === null || element.tagName === "BODY" || element.closest("[role=table]") !== null
}

export interface QueueKeyEvent {
	readonly key: string
	readonly target: EventTarget | null
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
	readonly shiftKey: boolean
	readonly repeat: boolean
}

/**
 * A page's key reader: `keys` maps `KeyboardEvent.key` (letters lower-cased) to the page's key;
 * only `repeatable` ones act while held; `pressable` ones (Enter, Space) yield to a focused control.
 */
export const queueKeyFilter =
	<K extends string>(
		keys: ReadonlyMap<string, K>,
		repeatable: ReadonlySet<K>,
		pressable: ReadonlySet<K>,
	) =>
	(event: QueueKeyEvent): K | null => {
		if (
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			// Some layouts need Shift for "/".
			(event.shiftKey && event.key !== "/") ||
			isEditable(event.target) ||
			isInOverlay(event.target)
		)
			return null
		const key = keys.get(event.key.length === 1 ? event.key.toLowerCase() : event.key)
		if (key === undefined) return null
		if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !isArrowForQueue(event.target)) return null
		if (event.repeat && !repeatable.has(key)) return null
		if (pressable.has(key) && isPressable(event.target)) return null
		return key
	}
