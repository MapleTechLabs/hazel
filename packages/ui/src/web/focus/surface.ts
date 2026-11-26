/**
 * How an overlay's panel reaches the screen on the web (lane A3). A modal panel is a native `<dialog>`
 * shown with `showModal()`; every other panel is a `popover="manual"` element. Both live in the
 * browser's top layer, above the Foldkit app's portaled overlays (z-index 100000), in open order, so an
 * overlay opened from inside an app dialog stays above it and interactive. Inside a gallery frame
 * (`data-case`, `data-hz-specimen`) a panel draws in place instead, so a case shows its overlay.
 */

/** Above the app's overlays (`OVERLAY_Z_INDEX` in `ui/aria/overlay.ts`), where there is no top layer. */
export const OVERLAY_Z = 100001

/** Where an overlay draws in place: a conformance case or a gallery specimen. */
export const isSpecimen = (node: Element): boolean => node.closest("[data-hz-specimen], [data-case]") !== null

/**
 * Runs `present` once `node` is in the document: props arrive before a node is inserted, and
 * `showModal()` needs a connected node. Calls made before the first run collapse into one.
 */
export const whenConnected = (node: Node): ((present: () => void) => void) => {
	let pending: (() => void) | undefined
	let tries = 0
	const window = node.ownerDocument?.defaultView
	const attempt = () => {
		if (pending === undefined) return
		if (!node.isConnected) {
			tries += 1
			if (tries < 30 && window !== null && window !== undefined) window.requestAnimationFrame(attempt)
			else pending = undefined
			return
		}
		const run = pending
		pending = undefined
		tries = 0
		run()
	}
	return (present) => {
		const scheduled = pending !== undefined
		pending = present
		if (!scheduled) queueMicrotask(attempt)
	}
}

type Popoverable = HTMLElement & { showPopover?: () => void; hidePopover?: () => void }

/** Shows `panel` in the top layer (or, specimen, in place). */
export const showPanel = (
	panel: HTMLElement,
	options: { readonly modal: boolean; readonly inPlace: boolean },
) => {
	panel.dataset.open = ""
	if (options.inPlace) {
		if (panel instanceof HTMLDialogElement) panel.setAttribute("open", "")
		return
	}
	try {
		if (panel instanceof HTMLDialogElement) {
			if (!panel.open) {
				if (options.modal && typeof panel.showModal === "function") panel.showModal()
				else panel.setAttribute("open", "")
			}
		} else {
			const popover = panel as Popoverable
			if (typeof popover.showPopover === "function" && !panel.matches(":popover-open"))
				popover.showPopover()
		}
	} catch {
		// An engine without the top layer (happy-dom): the panel shows by `data-open` and z-index.
		if (panel instanceof HTMLDialogElement) panel.setAttribute("open", "")
	}
}

export const hidePanel = (panel: HTMLElement) => {
	delete panel.dataset.open
	try {
		if (panel instanceof HTMLDialogElement) {
			if (panel.open) panel.close()
		} else {
			const popover = panel as Popoverable
			if (typeof popover.hidePopover === "function" && panel.matches(":popover-open"))
				popover.hidePopover()
		}
	} catch {
		// Not in the top layer: `data-open` alone hid it.
	}
	if (panel instanceof HTMLDialogElement) panel.removeAttribute("open")
}

/** A non-modal panel: `popover="manual"`, so only the layer stack dismisses it. */
export const makePopoverPanel = (panel: HTMLElement) => {
	panel.setAttribute("popover", "manual")
	panel.dataset.hzLayer = ""
	return panel
}

// Renderer-owned CSS (C3 `rendererFeatures`): the top layer's reset, placement, the scrim, motion,
// highlight and focus rings, and the in-place specimen layout. Looks (colour, type, radius, padding)
// are the recipes'.
// HAZEL-GAP(overlay-tokens): a scrim colour and an overlay shadow token; the scrim mixes from fg for now.
const css = `
:where([data-hz-layer]) {
	position: fixed;
	inset: auto;
	margin: 0;
	padding: 0;
	border: 0;
	max-width: none;
	max-height: none;
	overflow: visible;
	background: transparent;
	color: inherit;
	font: inherit;
	z-index: ${OVERLAY_Z};
}
[data-hz-layer][data-hz-layer]:not([data-open]) { display: none; }
dialog[data-hz-layer]::backdrop { background: color-mix(in oklab, var(--hz-color-fg) 32%, transparent); }
[data-hz-layer][data-scroll] { overflow: auto; overscroll-behavior: contain; }
@media (prefers-reduced-motion: no-preference) {
	[data-hz-layer][data-open] { animation: hz-layer-in var(--hz-duration-fast) var(--hz-ease-out); }
}
@keyframes hz-layer-in { from { opacity: 0; } }
[data-hz-part="item"] { cursor: default; outline: none; user-select: none; }
[data-hz-part="item"][data-highlighted] { background: var(--hz-color-wash-strong); }
[data-hz-part="item"][aria-disabled="true"] { opacity: 0.5; }
[data-hz-part="item"][data-destructive] { color: var(--hz-color-danger-subtle-fg); }
[data-hz-part="emoji"], [data-hz-part="close"] { cursor: pointer; }
[data-hz-part="emoji"]:hover, [data-hz-part="close"]:hover { background: var(--hz-color-wash-strong); }
:is([data-hz=menu], [data-hz=contextMenu], [data-hz=sheet], [data-hz=toast]) [data-hz-part] > svg {
	display: block;
	width: 100%;
	height: 100%;
}
[data-hz=ext] [data-hz-part="gifPanel"] {
	box-sizing: border-box;
	padding: var(--hz-space-2);
	gap: var(--hz-space-2);
	border: 1px solid var(--hz-color-border);
	border-radius: var(--hz-radius-xl);
	background: var(--hz-color-bg);
	color: var(--hz-color-fg);
	box-shadow: var(--hz-shadow-xs);
}
[data-hz=ext] [data-hz-part="gifPanel"] > [data-hz-part="search"] {
	padding: var(--hz-space-2);
	border: 0;
	border-radius: var(--hz-radius-md);
	background: var(--hz-color-secondary);
	font: inherit;
}
[data-hz=ext] [data-hz-part="gifPanel"] > [data-hz-part="empty"] { color: var(--hz-color-muted-fg); text-align: center; }
[data-hz-part="emoji"]:focus-visible,
[data-hz-part="close"]:focus-visible,
[data-hz-part="button"]:focus-visible,
[data-hz-part="search"]:focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}
[data-hz=dialog] > [data-hz-part="panel"] {
	inset: 0;
	margin: auto;
	width: min(100% - 2 * var(--hz-space-4), 28rem);
	max-height: calc(100% - 2 * var(--hz-space-4));
	overflow: auto;
}
[data-hz=sheet] > [data-hz-part="panel"] {
	inset: auto 0 0 0;
	width: 100%;
	max-height: 90%;
	overflow: auto;
}
@media (width >= 40rem) {
	[data-hz=sheet] > [data-hz-part="panel"] { inset: 0; margin: auto; width: min(100% - 2 * var(--hz-space-8), 34rem); max-height: 80%; }
}
[data-hz=dialog] [data-hz-part="content"], [data-hz=sheet] [data-hz-part="content"] { display: flex; flex-direction: column; }
[data-hz=dialog] [data-hz-part="content"] > [data-hz-slot="actions"] {
	order: 1;
	display: flex;
	flex-wrap: wrap;
	justify-content: flex-end;
	gap: var(--hz-space-2);
}
[data-hz=popover] > [data-hz-part="panel"]:not([data-open]) { display: contents; }
[data-hz=popover] > [data-hz-part="panel"]:not([data-open]) > :not([data-hz-slot="anchor"]) { display: none; }
[data-hz=popover] > [data-hz-part="placeholder"] { display: inline-block; vertical-align: middle; }
[data-hz=popover] [data-hz-slot="anchor"][data-pinned] { position: fixed; display: block; }
[data-hz=popover] > [data-hz-part="panel"][data-open] { max-width: min(100vw - 2 * var(--hz-space-3), 24rem); }
[data-hz=toast] > [data-hz-part="panel"] {
	inset: auto var(--hz-space-4) calc(var(--hz-space-4) + var(--hz-toast-offset, 0px)) var(--hz-space-4);
	display: flex;
	align-items: flex-start;
}
@media (width >= 40rem) {
	[data-hz=toast] > [data-hz-part="panel"] { left: auto; width: 22rem; }
}
[data-hz=toast] [data-hz-part="body"] { flex: 1; min-width: 0; }
[data-hz=tooltip], [data-hz=tooltip] > [data-hz-part="content"] { display: contents; }
[data-hz=tooltip] > [data-hz-part="bubble"] { pointer-events: none; white-space: nowrap; }
[data-hz=emojiPicker] > [data-hz-part="panel"], [data-hz=ext] [data-hz-part="gifPanel"] {
	width: min(100vw - 2 * var(--hz-space-3), 22rem);
	max-height: min(100vh - 2 * var(--hz-space-3), 24rem);
	display: flex;
	flex-direction: column;
}
[data-hz=emojiPicker] [data-hz-part="grid"], [data-hz=ext] [data-hz-part="gifs"] { flex: 1; min-height: 0; overflow: auto; }
[data-hz=emojiPicker] [data-hz-part="emojis"] { display: grid; grid-template-columns: repeat(8, 1fr); }
[data-hz=ext] [data-hz-part="gifs"] { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--hz-space-1); }
[data-hz=ext] [data-hz-part="gif"] { padding: 0; border: 0; background: none; border-radius: var(--hz-radius-md); overflow: hidden; }
[data-hz=ext] [data-hz-part="gif"] img { display: block; width: 100%; height: auto; }
[data-hz=menu] > [data-hz-part="panel"], [data-hz=contextMenu] > [data-hz-part="panel"] {
	min-width: 12rem;
	max-height: min(100vh - 2 * var(--hz-space-3), 28rem);
}
[data-hz][data-specimen] [data-hz-layer][data-open] { position: relative; inset: auto; z-index: auto; max-height: none; }
/* A shown panel's display is its recipe's; this only beats the engine's hidden popover. */
:where([data-hz][data-specimen] [data-hz-layer][data-open]) { display: block; }
[data-hz=dialog][data-specimen], [data-hz=sheet][data-specimen] {
	display: grid;
	place-items: center;
	padding: var(--hz-space-6);
	background: color-mix(in oklab, var(--hz-color-fg) 32%, transparent);
}
[data-hz=sheet][data-specimen] { place-items: end stretch; padding-bottom: 0; }
[data-hz=popover][data-specimen], [data-hz=menu][data-specimen], [data-hz=contextMenu][data-specimen],
[data-hz=emojiPicker][data-specimen], [data-hz=tooltip][data-specimen] {
	display: inline-flex;
	flex-direction: column;
	align-items: flex-start;
	gap: var(--hz-space-1);
}
[data-hz=toast][data-specimen] { display: block; }
`

const installed = new WeakSet<Document>()

/** Adds the overlay CSS to `document` once (the island's document or the gallery's). */
export const installOverlayStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzOverlays = ""
	style.textContent = css
	;(document.head ?? document.documentElement).append(style)
}
