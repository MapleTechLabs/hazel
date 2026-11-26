/**
 * What the controls' web renderers own and a recipe cannot say (C3 `rendererFeatures`): focus rings,
 * the composer's slot placement (a grid over a `display: contents` content parent) and its growing
 * textarea, and the toggle track and thumb slide. One stylesheet per document, tokens only; recipes style everything else.
 */
const css = `
:where([data-hz=button], [data-hz=link] > [data-hz-part=control], [data-hz=toggle] > [data-hz-part=control],
	[data-hz=composer] > [data-hz-part=send]):focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 2px;
}
:where([data-hz=textArea], [data-hz=searchField], [data-hz=composer]) :is(input, textarea):focus-visible {
	outline: 2px solid color-mix(in oklab, var(--hz-color-ring) 70%, transparent);
	outline-offset: 0;
}
/* The field's box shows focus (the kit's \`focus:border-ring/70 focus:ring-3 ring-ring/20\`), not the input. */
:is([data-hz=textField], [data-hz=select]) [data-hz-part=control] > :is(input, select) {
	min-width: 0;
	outline: none;
}
:is([data-hz=textField], [data-hz=select]) input::placeholder { color: var(--hz-color-muted-fg); opacity: 1; }
:is([data-hz=textField], [data-hz=select]) [data-hz-part=control]:has(> :is(input, select):focus) {
	border-color: var(--hz-color-focus-ring);
	box-shadow: 0 0 0 3px var(--hz-color-focus-halo);
}
:is([data-hz=textField], [data-hz=select])[data-invalid] [data-hz-part=control]:has(> input:focus) {
	border-color: var(--hz-color-invalid-border);
	box-shadow: 0 0 0 3px var(--hz-color-invalid-halo);
}
[data-hz=textField] [data-hz-part=input]::-ms-reveal { display: none; }
[data-hz=textField] :is([data-hz-part=reveal], [data-hz-part=copy]),
[data-hz=select][data-searchable] [data-hz-part=button] {
	display: grid;
	place-items: center;
	cursor: pointer;
}
[data-hz=textField] :is([data-hz-part=reveal], [data-hz-part=copy]):is(:hover, :focus-visible):not(:disabled) {
	color: var(--hz-color-fg);
}
:is([data-hz=textField] :is([data-hz-part=reveal], [data-hz-part=copy]), [data-hz=dropZone]):focus-visible {
	outline: 2px solid var(--hz-color-ring);
	outline-offset: 2px;
}
[data-hz=select][data-searchable] [data-hz-part=button] { cursor: default; }
[data-hz=select] > [data-hz-part=status] {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
[data-hz=select] [data-hz-part=listbox] { max-height: 24rem; overscroll-behavior: contain; }
[data-hz=select] [data-hz-part=group] + [data-hz-part=group] { margin-top: var(--hz-space-4); }
[data-hz=select] [data-hz-part=option] { cursor: default; user-select: none; }
[data-hz=select] [data-hz-part=option]:is([data-highlighted], :hover):not([data-disabled]) {
	background: var(--hz-color-wash-strong);
}
[data-hz=select] [data-hz-part=option][data-disabled] { opacity: 0.5; }
[data-hz=select] [data-hz-part=content]:empty { display: none; }
/* HAZEL-GAP(drop-zone-dashed-edge): Declarations have no border style or 2px width; the colour is the recipe's. */
[data-hz=dropZone] { border-width: 2px; border-style: dashed; cursor: pointer; }
[data-hz=dropZone]:is(:disabled, [data-loading]) { cursor: default; }
[data-hz=toggle] > [data-hz-part=control] { inline-size: var(--hz-space-10); align-self: start; }
[data-hz=toggle] > [data-hz-part=control] > [data-hz-part=thumb] {
	transition: translate var(--hz-duration-normal) var(--hz-ease-inOut);
}
[data-hz=toggle][data-selected] > [data-hz-part=control] > [data-hz-part=thumb] { translate: var(--hz-space-4) 0; }
@media (width >= 40rem) {
	[data-hz=toggle] > [data-hz-part=control] { inline-size: var(--hz-space-8); }
	[data-hz=toggle][data-selected] > [data-hz-part=control] > [data-hz-part=thumb] { translate: var(--hz-space-3) 0; }
}
@media (prefers-reduced-motion: reduce) {
	[data-hz=toggle] > [data-hz-part=control] > [data-hz-part=thumb] { transition: none; }
}
[data-hz=composer] {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	grid-template-areas: "above above" "input input" "actions send";
}
[data-hz=composer] > [data-hz-part=content] { display: contents; }
[data-hz=composer] > [data-hz-part=content] > [data-hz-slot=above] { grid-area: above; }
[data-hz=composer] > [data-hz-part=content] > [data-hz-slot=actions] { grid-area: actions; }
[data-hz=composer] > [data-hz-part=input] { grid-area: input; field-sizing: content; resize: none; }
[data-hz=composer] > [data-hz-part=send] { grid-area: send; }
`

const installed = new WeakSet<Document>()

/** Adds the controls' renderer stylesheet to `document` once. */
export const ensureStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const style = document.createElement("style")
	style.dataset.hzRenderer = "controls"
	style.textContent = css
	document.head.append(style)
}
