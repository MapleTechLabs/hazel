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

// Renderer-owned CSS (C3 `rendererFeatures`): the top layer's reset, placement, the scrim,
// highlight and focus rings, and the in-place specimen layout. Looks (colour, type, radius, padding)
// and motion (`recipe.motion`, played by `motion.ts`) are the recipes'.
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
dialog[data-hz-layer]::backdrop { background: var(--hz-color-scrim); }
[data-hz-layer][data-scroll] { overflow: auto; overscroll-behavior: contain; }
[data-hz-part="item"] { cursor: default; outline: none; user-select: none; }
[data-hz-part="item"][data-highlighted] { background: var(--hz-color-wash-strong); }
[data-hz-part="item"][aria-disabled="true"] { opacity: 0.5; }
[data-hz-part="item"][data-destructive] { color: var(--hz-color-danger-subtle-fg); }
[data-hz-part="close"] { cursor: pointer; }
[data-hz-part="close"]:hover { background: var(--hz-color-wash-strong); }
:is([data-hz=menu], [data-hz=contextMenu], [data-hz=sheet], [data-hz=toast]) [data-hz-part] > svg {
	display: block;
	width: 100%;
	height: 100%;
}
/* The GIF picker is a web extension, not a recipe: it fades in as a popover does (\`fadeIn\`). */
[data-hz=ext] [data-hz-part="gifPanel"][data-motion~="enter"] {
	animation: hz-fade var(--hz-duration-fast) var(--hz-ease-out) 0s 1 both;
}
[data-hz-part="emoji"]:focus-visible,
[data-hz-part="close"]:focus-visible,
[data-hz-part="button"]:focus-visible,
[data-hz-part="search"]:focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}
/* The kit's modal layout: a bottom card on phones; from \`sm\` a column a quarter of the way down
   (\`grid-rows-[1fr_auto_3fr]\`, \`md:p-4\`), so its top is 25% of the room less a quarter of its height. */
[data-hz=dialog] > [data-hz-part="panel"] {
	inset: auto 0 0 0;
	width: 100%;
	max-height: calc(100dvh - var(--hz-space-4));
	overflow: auto;
	border-bottom-left-radius: 0;
	border-bottom-right-radius: 0;
}
@media (width >= 40rem) {
	[data-hz=dialog] > [data-hz-part="panel"] {
		--hz-dialog-pad: 0px;
		inset: calc(25dvh + var(--hz-dialog-pad) / 2) 0 auto 0;
		margin: 0 auto;
		transform: translateY(-25%);
		width: min(100% - 2 * var(--hz-dialog-pad), 28rem);
		max-height: calc(100dvh - var(--hz-space-8));
		border-radius: var(--hz-radius-xl);
	}
	[data-hz=dialog][data-size="large"] > [data-hz-part="panel"] { width: min(100% - 2 * var(--hz-dialog-pad), 32rem); }
	[data-hz=dialog][data-size="fullscreen"] > [data-hz-part="panel"] {
		inset: var(--hz-dialog-pad);
		transform: none;
		width: auto;
		max-height: none;
		border-radius: var(--hz-radius-md);
	}
}
@media (width >= 48rem) {
	[data-hz=dialog] > [data-hz-part="panel"] { --hz-dialog-pad: var(--hz-space-4); }
	[data-hz=dialog][data-size="fullscreen"] > [data-hz-part="panel"] { --hz-dialog-pad: var(--hz-space-3); }
}
[data-hz=dialog] [data-hz-part="close"] {
	position: absolute;
	top: var(--hz-space-1);
	right: var(--hz-space-1);
	appearance: none;
	border: 0;
	background: transparent;
	padding: 0;
}
@media (width >= 40rem) { [data-hz=dialog] [data-hz-part="close"] { top: var(--hz-space-2); right: var(--hz-space-2); } }
[data-hz=dialog] [data-hz-part="close"] > svg { display: block; width: 1rem; height: 1rem; }
[data-hz=dialog] [data-hz-part="close"]:hover { color: var(--hz-color-fg); }
[data-hz=dialog] [data-hz-part="icon"] > svg { display: block; width: 1.25rem; height: 1.25rem; }
[data-hz=dialog][data-icon-tone="danger"] [data-hz-part="icon"] > svg { width: 1.5rem; height: 1.5rem; }
[data-hz=dialog] [data-hz-part="heading"] { min-width: 0; }
[data-hz=sheet] > [data-hz-part="panel"] {
	inset: auto 0 0 0;
	width: 100%;
	max-height: 90%;
	overflow: auto;
}
@media (width >= 40rem) {
	[data-hz=sheet] > [data-hz-part="panel"] { inset: 0; margin: auto; width: min(100% - 2 * var(--hz-space-8), 34rem); max-height: 80%; }
}
[data-hz=sheet] [data-hz-part="close"] { appearance: none; border: 0; background: transparent; padding: 0; }
[data-hz=sheet] [data-hz-part="close"]:hover { color: var(--hz-color-fg); }
[data-hz=sheet] [data-hz-part="close"] > svg { width: 1rem; height: 1rem; }
/* \`card\`: today's floating sheet (\`inset-x-2\`, \`bottom-[max(0.5rem,env(safe-area-inset-bottom))]\`,
   \`max-h-[85dvh]\`), its close button at \`top-2.5 right-2.5\`, its title for assistive tech only. */
[data-hz=sheet][data-style="card"] > [data-hz-part="panel"] {
	inset: auto var(--hz-space-2) max(var(--hz-space-2), env(safe-area-inset-bottom)) var(--hz-space-2);
	width: auto;
	max-height: 85dvh;
}
[data-hz=sheet][data-style="card"] [data-hz-part="close"] { position: absolute; top: var(--hz-space-2_5); right: var(--hz-space-2_5); }
[data-hz=sheet][data-style="card"] [data-hz-part="title"] {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
[data-hz=sheet] [data-hz-part="content"] { display: flex; flex-direction: column; }
/* The footer (\`dialogFooterBase\`): stacked, primary first, on phones; from \`sm\` one row, the
   secondary actions at the start and the actions at the end. */
[data-hz=dialog] [data-hz-part="content"] { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: var(--hz-space-3); }
[data-hz=dialog] [data-hz-part="content"] > * { grid-column: 1 / -1; min-width: 0; }
[data-hz=dialog] [data-hz-part="content"] > :is([data-hz-slot="actions"], [data-hz-slot="secondaryActions"]) {
	order: 1;
	display: flex;
	flex-direction: column-reverse;
}
[data-hz=dialog] [data-hz-part="content"] > [data-hz-slot="secondaryActions"] { order: 2; }
@media (width >= 40rem) {
	[data-hz=dialog] [data-hz-part="content"] > :is([data-hz-slot="actions"], [data-hz-slot="secondaryActions"]) {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
	}
	[data-hz=dialog] [data-hz-part="content"] > [data-hz-slot="secondaryActions"] { order: 1; grid-column: 1; }
	[data-hz=dialog] [data-hz-part="content"] > [data-hz-slot="actions"] { order: 2; grid-column: 2; justify-content: flex-end; }
	[data-hz=dialog] [data-hz-part="content"]:not(:has(> [data-hz-slot="secondaryActions"])) > [data-hz-slot="actions"] { grid-column: 1 / -1; }
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
[data-hz=emojiPicker] [data-hz-part="grid"] { min-height: 0; }
[data-hz=menu] > [data-hz-part="panel"], [data-hz=contextMenu] > [data-hz-part="panel"] {
	min-width: 12rem;
	max-height: min(100vh - 2 * var(--hz-space-3), 28rem);
}
/* A header group (\`p4-menu-header\`, \`menuHeaderBase\`): the name \`px-2.5 pt-2 font-medium\` in full ink, the email under it. */
:is([data-hz=menu], [data-hz=contextMenu]) [data-hz-part="group"][data-header] > [data-hz-part="groupTitle"] {
	padding: var(--hz-space-2) var(--hz-space-2_5) 0; color: var(--hz-color-fg);
	font-size: var(--hz-text-body-size); line-height: var(--hz-text-body-leading);
}
:is([data-hz=menu], [data-hz=contextMenu]) [data-hz-part="group"][data-header] > [data-hz-part="groupSubtitle"] {
	padding-bottom: var(--hz-space-2);
}
[data-hz][data-specimen] [data-hz-layer][data-open] { position: relative; inset: auto; z-index: auto; max-height: none; }
/* A shown panel's display is its recipe's; this only beats the engine's hidden popover. */
:where([data-hz][data-specimen] [data-hz-layer][data-open]) { display: block; }
[data-hz=dialog][data-specimen], [data-hz=sheet][data-specimen] {
	display: grid;
	place-items: center;
	padding: var(--hz-space-6);
	background: var(--hz-color-scrim);
}
[data-hz=sheet][data-specimen] { place-items: end stretch; padding-bottom: 0; }
[data-hz=dialog][data-specimen] > [data-hz-part="panel"] { transform: none; width: min(100%, 28rem); }
[data-hz=dialog][data-specimen][data-size="large"] > [data-hz-part="panel"] { width: min(100%, 32rem); }
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
