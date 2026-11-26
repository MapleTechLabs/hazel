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
:where([data-hz=textField], [data-hz=textArea], [data-hz=select], [data-hz=searchField], [data-hz=composer])
	:is(input, textarea, select):focus-visible {
	outline: 2px solid color-mix(in oklab, var(--hz-color-ring) 70%, transparent);
	outline-offset: 0;
}
[data-hz=toggle]:not([data-style=checkbox]) > [data-hz-part=control] { inline-size: var(--hz-space-10); align-self: start; }
[data-hz=toggle] > [data-hz-part=control] > [data-hz-part=thumb] {
	transition: translate var(--hz-duration-normal) var(--hz-ease-inOut);
}
[data-hz=toggle][data-selected] > [data-hz-part=control] > [data-hz-part=thumb] { translate: var(--hz-space-4) 0; }
@media (width >= 40rem) {
	[data-hz=toggle]:not([data-style=checkbox]) > [data-hz-part=control] { inline-size: var(--hz-space-8); }
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
