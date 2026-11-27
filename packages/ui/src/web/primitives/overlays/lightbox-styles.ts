/**
 * `hz:lightbox`'s renderer-owned CSS (lane A3, C3 `rendererFeatures`): the full-screen placement, the
 * native scroll-snap track, the pull and zoom states, the step buttons' breakpoints, the morph's View
 * Transition and the in-place specimen. Spacing, type and the menu are the recipe's (`lightbox.ts`).
 */

// The morph's timings are motion tokens (`duration.morph`, `easing.morph` and `morphRoot`); the View
// Transition's pseudo-elements stay renderer CSS.
const morph = `
:root[data-hz-lightbox-morph]::view-transition-old(root),
:root[data-hz-lightbox-morph]::view-transition-new(root) {
	animation-duration: var(--hz-duration-slow);
	animation-timing-function: var(--hz-ease-morphRoot);
}
:root[data-hz-lightbox-morph]::view-transition-group(hz-lightbox-media) {
	overflow: hidden;
	border-radius: var(--hz-radius-md);
	animation-duration: var(--hz-duration-morph);
	animation-timing-function: var(--hz-ease-morph);
}
/* No crossfade: only the viewer's image is drawn, stretched between the two boxes. */
:root[data-hz-lightbox-morph]::view-transition-old(hz-lightbox-media),
:root[data-hz-lightbox-morph]::view-transition-new(hz-lightbox-media) {
	width: 100%;
	height: 100%;
	object-fit: cover;
	animation: none;
	mix-blend-mode: normal;
}
:root[data-hz-lightbox-morph="open"]::view-transition-old(hz-lightbox-media) { opacity: 0; }
:root[data-hz-lightbox-morph="close"]::view-transition-new(hz-lightbox-media) { opacity: 0; }
/* The image on the page that the viewer shows is in the viewer while it is open. */
:root:has([data-hz=lightbox][data-open]:not([data-specimen])) [data-hz-lightbox-plate] { opacity: 0; }
`

const layout = `
[data-hz=lightbox] [hidden] { display: none !important; }
[data-hz=lightbox] > [data-hz-part="stage"] {
	inset: 0;
	width: 100%;
	height: 100%;
	overflow: hidden;
	isolation: isolate;
	--hz-lightbox-inset-top: calc(4.75rem + env(safe-area-inset-top, 0px));
	--hz-lightbox-inset-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));
	--hz-lightbox-inset-inline: 0.75rem;
}
[data-hz=lightbox] > dialog[data-hz-part="stage"]::backdrop { background: transparent; }
[data-hz=lightbox] > [data-hz-part="stage"][data-many] {
	--hz-lightbox-inset-bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
}
@media (width >= 48rem) {
	[data-hz=lightbox] > [data-hz-part="stage"] {
		--hz-lightbox-inset-bottom: calc(2.5rem + env(safe-area-inset-bottom, 0px));
		--hz-lightbox-inset-inline: 2.5rem;
	}
	[data-hz=lightbox] > [data-hz-part="stage"][data-many] {
		--hz-lightbox-inset-bottom: calc(7rem + env(safe-area-inset-bottom, 0px));
		--hz-lightbox-inset-inline: 5.5rem;
	}
}
[data-hz=lightbox] [data-hz-part="backdrop"] {
	position: absolute;
	inset: 0;
	/* Thinned by a pull, then back on the snap's own clock. */
	opacity: calc(1 - var(--hz-lightbox-pull-progress, 0) * 0.6);
	transition: opacity var(--hz-lightbox-pull-snap-duration, 0s) var(--hz-lightbox-pull-snap-easing, linear);
}
[data-hz=lightbox] [data-hz-part="stage"][data-pulling] [data-hz-part="backdrop"] { transition: none; }
[data-hz=lightbox] [data-hz-part="viewport"] {
	position: absolute;
	inset: 0;
	overflow: hidden;
	outline: none;
	overscroll-behavior: contain;
	user-select: none;
	-webkit-user-select: none;
	touch-action: pan-x;
}
/* The carousel is a native scroller: swiping, momentum and snapping are the browser's. */
[data-hz=lightbox] [data-hz-part="slides"] {
	position: relative;
	display: flex;
	width: 100%;
	height: 100%;
	overflow-x: auto;
	overflow-y: hidden;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scroll-behavior: auto;
	scrollbar-width: none;
	overflow-anchor: none;
	touch-action: pan-x;
}
[data-hz=lightbox] [data-hz-part="slides"]::-webkit-scrollbar { display: none; }
[data-hz=lightbox] [data-hz-part="slide"] {
	position: relative;
	box-sizing: border-box;
	display: flex;
	flex: 0 0 100%;
	flex-direction: column;
	align-items: center;
	min-width: 100%;
	height: 100%;
	padding: var(--hz-lightbox-inset-top) var(--hz-lightbox-inset-inline) var(--hz-lightbox-inset-bottom);
	scroll-snap-align: center;
	scroll-snap-stop: always;
}
[data-hz=lightbox] [data-hz-part="zoom"] {
	display: flex;
	flex: 1;
	align-items: center;
	justify-content: center;
	width: 100%;
	min-height: 0;
	transform-origin: center center;
	touch-action: pan-x;
}
[data-hz=lightbox] [data-hz-part="slide"][data-active] [data-hz-part="zoom"] { will-change: transform; }
[data-hz=lightbox] [data-hz-part="media"] {
	display: block;
	width: auto;
	height: auto;
	min-width: 0;
	max-width: 100%;
	max-height: 100%;
	object-fit: contain;
	user-select: none;
	-webkit-user-drag: none;
}
[data-hz=lightbox] img[data-hz-part="media"] { cursor: zoom-in; }
[data-hz=lightbox] [data-hz-part="stage"][data-zoomed] img[data-hz-part="media"] { cursor: grab; }
[data-hz=lightbox] [data-hz-part="stage"][data-zoomed] img[data-hz-part="media"]:active { cursor: grabbing; }
[data-hz=lightbox] [data-hz-part="live"] {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
[data-hz=lightbox] [data-hz-part="counter"] {
	position: absolute;
	top: var(--hz-space-5);
	left: 50%;
	translate: -50% 0;
}
[data-hz=lightbox] [data-hz-part="toolbar"] {
	position: absolute;
	top: var(--hz-space-5);
	right: var(--hz-space-5);
	border-style: solid;
}
@media (width < 48rem) {
	[data-hz=lightbox] [data-hz-part="counter"] {
		top: calc(env(safe-area-inset-top, 0px) + 4rem);
		right: var(--hz-space-3);
		left: auto;
		translate: none;
	}
	[data-hz=lightbox] [data-hz-part="toolbar"] {
		top: calc(env(safe-area-inset-top, 0px) + 0.75rem);
		right: var(--hz-space-3);
	}
}
[data-hz=lightbox] :is([data-hz-part="tool"], [data-hz-part="step"], [data-hz-part="thumb"]) {
	margin: 0;
	border: 0;
	font: inherit;
	cursor: pointer;
	outline: none;
	-webkit-tap-highlight-color: transparent;
}
[data-hz=lightbox] [data-hz-part="tool"] { background: transparent; color: inherit; }
[data-hz=lightbox] [data-hz-part="tool"]:is(:hover, :active):not([aria-disabled="true"]) { background: var(--hz-color-lightbox-press); }
[data-hz=lightbox] :is([data-hz-part="tool"], [data-hz-part="step"]):focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 1px;
}
[data-hz=lightbox] [data-hz-part="tool"][aria-disabled="true"] { opacity: 0.4; cursor: default; }
[data-hz=lightbox] :is([data-hz-part="toolIcon"], [data-hz-part="stepIcon"], [data-hz-part="thumbIcon"]) > svg {
	display: block;
	width: 100%;
	height: 100%;
}
[data-hz=lightbox] [data-hz-part="step"] {
	position: absolute;
	top: 50%;
	translate: 0 -50%;
	color: inherit;
	transition: opacity var(--hz-duration-fast) var(--hz-ease-out), background-color var(--hz-duration-fast) var(--hz-ease-out);
}
[data-hz=lightbox] [data-hz-part="step"]:hover { background: var(--hz-color-lightbox-chrome-hover); }
[data-hz=lightbox] [data-hz-part="step"][data-side="previous"] { left: var(--hz-space-4); }
[data-hz=lightbox] [data-hz-part="step"][data-side="next"] { right: var(--hz-space-4); }
[data-hz=lightbox] [data-hz-part="step"][aria-disabled="true"] { opacity: 0.4; cursor: default; }
/* A finger swipes; the step buttons are for a pointer. */
@media (hover: none), (width < 48rem) {
	[data-hz=lightbox] > [data-hz-part="stage"] > [data-hz-part="step"] { display: none; }
}
[data-hz=lightbox] [data-hz-part="strip"] {
	position: absolute;
	right: 0;
	bottom: var(--hz-space-5);
	left: 0;
	display: flex;
	justify-content: center;
	padding-inline: var(--hz-space-8);
	pointer-events: none;
}
@media (width < 48rem) {
	[data-hz=lightbox] [data-hz-part="strip"] {
		bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
		padding-inline: var(--hz-space-3);
	}
}
[data-hz=lightbox] [data-hz-part="thumbs"] {
	max-width: 42rem;
	pointer-events: auto;
	scrollbar-width: none;
	overscroll-behavior-x: contain;
}
[data-hz=lightbox] [data-hz-part="thumbs"]::-webkit-scrollbar { display: none; }
/* The ring is drawn inside the thumbnail, so the strip's overflow never clips it. */
[data-hz=lightbox] [data-hz-part="thumb"] {
	position: relative;
	flex: 0 0 5rem;
	padding: 0;
	overflow: hidden;
	background: transparent;
	opacity: 0.5;
	user-select: none;
	transition: opacity var(--hz-duration-fast) var(--hz-ease-out);
}
[data-hz=lightbox] [data-hz-part="thumb"]:hover { opacity: 0.8; }
[data-hz=lightbox] [data-hz-part="thumb"][aria-current="true"] { opacity: 1; }
[data-hz=lightbox] [data-hz-part="thumb"]::after {
	content: "";
	position: absolute;
	inset: 0;
	border-radius: inherit;
	pointer-events: none;
}
[data-hz=lightbox] [data-hz-part="thumb"][aria-current="true"]::after { box-shadow: inset 0 0 0 2px var(--hz-color-lightbox-fg); }
[data-hz=lightbox] [data-hz-part="thumb"]:focus-visible::after { box-shadow: inset 0 0 0 2px var(--hz-color-ring); }
[data-hz=lightbox] [data-hz-part="thumbMedia"] {
	display: block;
	width: 5rem;
	height: 4rem;
	object-fit: cover;
	user-select: none;
	-webkit-user-drag: none;
	pointer-events: none;
}
[data-hz=lightbox] [data-hz-part="thumbIcon"] {
	position: absolute;
	inset: 0;
	margin: auto;
	filter: drop-shadow(0 1px 0 oklch(0 0 0 / 0.25));
}
[data-hz=lightbox] [data-hz-part="file"] { color: inherit; }
/* Today's author block (\`absolute top-5 left-5\`, below the bar on a phone). */
[data-hz=lightbox] [data-hz-part="author"] {
	position: absolute;
	top: var(--hz-space-5);
	left: var(--hz-space-5);
}
@media (width < 48rem) {
	[data-hz=lightbox] [data-hz-part="author"] {
		top: calc(env(safe-area-inset-top, 0px) + 4rem);
		left: var(--hz-space-3);
	}
}
[data-hz=lightbox] [data-hz-part="authorAvatar"] { position: relative; overflow: hidden; corner-shape: squircle; }
[data-hz=lightbox] [data-hz-part="authorAvatar"][data-seeded] { container-type: size; overflow: visible; }
[data-hz=lightbox] [data-hz-part="authorImage"] { width: 100%; height: 100%; object-fit: cover; }
[data-hz=lightbox] [data-hz-part="authorAvatar"] > [data-hz-part="dither"] { corner-shape: squircle; }
[data-hz=lightbox] [data-hz-part="authorInitial"] {
	position: relative;
	display: flex;
	height: 100%;
	align-items: center;
	justify-content: center;
	color: var(--hz-color-lightbox-fg);
	font-weight: var(--hz-weight-semibold);
	font-size: 46cqw;
	line-height: 1;
}
/* The caption under the image (\`mt-3 max-h-[12vh] max-w-xl overflow-y-auto\`); a long one scrolls. */
[data-hz=lightbox] [data-hz-part="caption"] {
	flex-shrink: 0;
	max-width: 36rem;
	max-height: 12vh;
	margin-top: var(--hz-space-3);
	overflow-y: auto;
}
[data-hz=lightbox] [data-hz-part="captionTitle"], [data-hz=lightbox] [data-hz-part="captionDescription"] { margin: 0; }
[data-hz=lightbox] [data-hz-part="captionDescription"] { margin-top: var(--hz-space-0_5); }
[data-hz=lightbox] [data-hz-part="menu"] { display: contents; color: var(--hz-color-fg); }
/* The recipe gives the menu's panel a display; closed, it stays hidden. */
[data-hz=lightbox] > [data-hz-part="stage"] > [data-hz-part="menu"] > [data-hz-part="panel"]:not([data-open]) { display: none; }
/* Everything but the image steps back while it is pulled away, and what a zoomed image would run
   under steps back while it is zoomed. */
[data-hz=lightbox] [data-chrome] {
	transition: opacity var(--hz-duration-normal) ease, visibility 0s linear 0s;
}
[data-hz=lightbox] [data-hz-part="stage"]:is([data-pulling], [data-pull-dismissing]) [data-chrome],
[data-hz=lightbox] [data-hz-part="stage"][data-zoomed] :is([data-hz-part="step"], [data-hz-part="strip"]) {
	visibility: hidden;
	opacity: 0;
	transition: opacity var(--hz-duration-normal) ease, visibility 0s linear var(--hz-duration-normal);
}
[data-hz=lightbox][data-specimen] > [data-hz-part="stage"][data-open] {
	position: relative;
	display: block;
	width: 100%;
	height: 32rem;
}
`

const installed = new WeakSet<Document>()

/** Adds the lightbox CSS to `document` once (the island's document or the gallery's). */
export const installLightboxStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzLightbox = ""
	style.textContent = layout + morph
	;(document.head ?? document.documentElement).append(style)
}
