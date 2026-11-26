/**
 * The web's overlay stack (lane A3): every open `hazel` overlay is a layer, topmost last. The top layer
 * takes Escape, an outside press and (when modal) traps Tab; closing it returns focus to where it came
 * from. The Foldkit app's own overlays (`apps/web-foldkit/src/ui/aria/overlay.ts`: the portal root,
 * `data-overlay-root`, native dialogs) form a separate stack: a key or press inside one that does not
 * hold the hazel layer belongs to the app, so the two never dismiss each other's overlays.
 */
import { focusElement, focusFirst, tabbables } from "./focusable.ts"

/** Why a layer asks to close. `parent`: an overlay holding it closed, so it hides at once. */
export type DismissReason = "escape" | "outside" | "tab" | "parent"

export interface LayerOptions {
	/** The overlay's own box: focus stays in it while it is the modal top. */
	readonly panel: HTMLElement
	/** Traps Tab inside the panel and pulls stray focus back (dialog, sheet). */
	readonly modal: boolean
	/** Where focus goes on open; a function returns the element (null falls back to the first stop). */
	readonly initialFocus?: "first" | "none" | (() => HTMLElement | null)
	/** Elements outside the panel that count as inside: the trigger, a submenu. */
	readonly inside?: () => ReadonlyArray<Element | null | undefined>
	/** A press outside every inside element asks to close (popovers, menus). */
	readonly dismissOnOutside?: boolean
	/** Tab leaving the panel closes it (menus). */
	readonly dismissOnTab?: boolean
	/** Where focus returns on close; the focused element at open by default. */
	readonly returnFocus?: Element | null
	readonly onDismiss: (reason: DismissReason) => void
}

export interface Layer {
	/** Leaves the stack; focus goes back when it was inside the panel or nowhere. */
	readonly close: (options?: { readonly restoreFocus?: boolean }) => void
	readonly isOpen: () => boolean
	readonly isTop: () => boolean
}

interface Entry {
	readonly options: LayerOptions
	readonly returnTo: Element | null
	closed: boolean
}

interface State {
	readonly stack: Array<Entry>
	readonly stop: () => void
}

const states = new WeakMap<Document, State>()

/** Roots of the app's overlays. A hazel layer's own elements carry `data-hz-layer` and are skipped. */
const foreignRoots = "#foldkit-portal-root, [data-foldkit-portal-root], [data-overlay-root], dialog[open]"

const elementOf = (target: EventTarget | null): Element | null =>
	target instanceof Element ? target : target instanceof Node ? target.parentElement : null

/** The app overlay `target` sits in, when it does not hold `panel` (so it is beside or above it). */
const foreignOverlayAt = (target: EventTarget | null, panel: HTMLElement): boolean => {
	let node = elementOf(target)
	while (node !== null) {
		const root: Element | null = node.closest(foreignRoots)
		if (root === null) return false
		if (!root.hasAttribute("data-hz-layer")) return !root.contains(panel)
		node = root.parentElement
	}
	return false
}

const within = (entry: Entry, target: EventTarget | null): boolean => {
	const node = target instanceof Node ? target : null
	if (node === null) return false
	if (entry.options.panel.contains(node)) return true
	return (entry.options.inside?.() ?? []).some((element) => element?.contains(node) === true)
}

const topOf = (state: State): Entry | undefined => {
	for (const entry of [...state.stack]) if (!entry.options.panel.isConnected) drop(state, entry, true)
	return state.stack.at(-1)
}

const restore = (entry: Entry) => {
	const document = entry.options.panel.ownerDocument
	const active = document.activeElement
	const lost =
		active === null ||
		active === document.body ||
		!active.isConnected ||
		entry.options.panel.contains(active)
	if (lost && entry.returnTo instanceof HTMLElement) focusElement(entry.returnTo)
}

const drop = (state: State, entry: Entry, restoreFocus: boolean) => {
	if (entry.closed) return
	entry.closed = true
	const at = state.stack.indexOf(entry)
	if (at < 0) return
	// Layers opened inside this one (a popover in a dialog) go with it.
	for (const above of state.stack.slice(at + 1).reverse())
		if (entry.options.panel.contains(above.options.panel)) {
			drop(state, above, false)
			above.options.onDismiss("parent")
		}
	state.stack.splice(state.stack.indexOf(entry), 1)
	if (restoreFocus) restore(entry)
	if (state.stack.length === 0) {
		state.stop()
		states.delete(entry.options.panel.ownerDocument)
	}
}

const trapTab = (event: KeyboardEvent, entry: Entry) => {
	const panel = entry.options.panel
	const stops = tabbables(panel)
	const first = stops[0]
	const last = stops.at(-1)
	const active = panel.ownerDocument.activeElement
	if (first === undefined || last === undefined) {
		event.preventDefault()
		focusFirst(panel)
		return
	}
	const inside = active !== null && panel.contains(active)
	if (!inside || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
		event.preventDefault()
		focusElement(event.shiftKey ? last : first)
	}
}

const install = (document: Document): State => {
	const existing = states.get(document)
	if (existing !== undefined) return existing
	// Bubble phase: a control inside the overlay that takes Escape itself (an open autocomplete, a
	// submenu) prevents it, and the layer leaves it alone.
	const onKeyDown = (event: KeyboardEvent) => {
		const top = topOf(state)
		if (top === undefined || event.defaultPrevented || event.isComposing) return
		if (foreignOverlayAt(event.target, top.options.panel)) return
		if (event.key === "Escape") {
			event.preventDefault()
			event.stopPropagation()
			top.options.onDismiss("escape")
		} else if (event.key === "Tab") {
			if (top.options.modal) trapTab(event, top)
			else if (top.options.dismissOnTab === true && within(top, event.target)) {
				// Focus goes back to the trigger first, so the default Tab moves on from there.
				drop(state, top, true)
				top.options.onDismiss("tab")
			}
		}
	}
	const onPointerDown = (event: PointerEvent) => {
		const top = topOf(state)
		if (top === undefined || top.options.dismissOnOutside !== true) return
		if (within(top, event.target) || foreignOverlayAt(event.target, top.options.panel)) return
		top.options.onDismiss("outside")
	}
	const onFocusIn = (event: FocusEvent) => {
		const top = topOf(state)
		if (top === undefined || !top.options.modal || within(top, event.target)) return
		if (foreignOverlayAt(event.target, top.options.panel)) return
		focusFirst(top.options.panel)
	}
	// A layer whose node left the document (its view removed it while open) is dropped.
	const observer =
		typeof MutationObserver === "function" ? new MutationObserver(() => void topOf(state)) : undefined
	observer?.observe(document.body ?? document.documentElement, { childList: true, subtree: true })
	document.addEventListener("keydown", onKeyDown)
	document.addEventListener("pointerdown", onPointerDown, true)
	document.addEventListener("focusin", onFocusIn, true)
	const state: State = {
		stack: [],
		stop: () => {
			observer?.disconnect()
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("pointerdown", onPointerDown, true)
			document.removeEventListener("focusin", onFocusIn, true)
		},
	}
	states.set(document, state)
	return state
}

/** Puts an overlay on the stack; call once its panel is shown. */
export const openLayer = (options: LayerOptions): Layer => {
	const document = options.panel.ownerDocument
	const state = install(document)
	const entry: Entry = {
		options,
		returnTo: options.returnFocus === undefined ? document.activeElement : options.returnFocus,
		closed: false,
	}
	state.stack.push(entry)
	const initial = options.initialFocus ?? "first"
	if (initial === "first") focusFirst(options.panel)
	else if (typeof initial === "function") {
		const target = initial()
		if (target === null || !focusElement(target)) focusFirst(options.panel)
	}
	return {
		close: (close) => {
			const current = states.get(document)
			if (current !== undefined) drop(current, entry, close?.restoreFocus ?? true)
			else entry.closed = true
		},
		isOpen: () => !entry.closed,
		isTop: () => states.get(document)?.stack.at(-1) === entry,
	}
}

/** The open layers' panels, bottom first (tests and the gallery). */
export const openPanels = (document: Document): ReadonlyArray<HTMLElement> =>
	(states.get(document)?.stack ?? []).map((entry) => entry.options.panel)
