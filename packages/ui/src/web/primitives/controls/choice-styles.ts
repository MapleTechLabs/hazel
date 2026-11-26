/**
 * What the choice controls' web renderers own and a recipe cannot say (C3 `rendererFeatures`): focus
 * rings, an option's own selected, hover and disabled looks (recipe states sit on the root), the card
 * grid and joined column, the slider's positions and drag, and the checkbox's well. Tokens only.
 */
// HAZEL-GAP(choice-option-states): an option's selected and disabled looks need part-level states.
const group = `[data-hz=choiceGroup]`
const options = `${group} > [data-hz-part=options]`
const option = `${options} > [data-hz-part=option]`
const box = `[data-hz-part=indicator] > [data-hz-part=box]`
const style = (name: string) =>
	name === "list" ? `${group}:is([data-style=list], :not([data-style]))` : `${group}[data-style=${name}]`
const optionOf = (name: string) => `${style(name)} > [data-hz-part=options] > [data-hz-part=option]`
const mix = (color: string, percent: number) =>
	`color-mix(in oklab, var(--hz-color-${color}) ${percent}%, transparent)`
const halo = `0 0 0 3px var(--hz-color-focus-halo)`

const css = `
${option} { cursor: default; text-align: start; outline: none; }
${option}:disabled { cursor: default; }
${group}:not([data-disabled]) > [data-hz-part=options] > [data-hz-part=option][data-disabled] { opacity: 0.5; }

${option} > ${box} > [data-hz-part=mark] { transition: background-color var(--hz-duration-fast) var(--hz-ease-out); }
${style("list")}:not([data-multiple]) > [data-hz-part=options] > [data-hz-part=option]:not([data-selected], :disabled):hover > ${box} > [data-hz-part=mark] {
	background-color: ${mix("muted-fg", 20)};
}
${option}[data-selected] > ${box} { background-color: var(--hz-color-primary); box-shadow: inset 0 0 0 1px var(--hz-color-primary); }
${group}:not([data-multiple]) > [data-hz-part=options] > [data-hz-part=option][data-selected] > ${box} > [data-hz-part=mark] {
	background-color: var(--hz-color-bg);
}
${group}[data-multiple] > [data-hz-part=options] > [data-hz-part=option][data-selected] > ${box} { box-shadow: inset 0 0 0 1px var(--hz-color-ring); }
${group}[data-multiple] > [data-hz-part=options] > [data-hz-part=option]:not([data-selected], :disabled):hover > ${box} {
	box-shadow: inset 0 0 0 1px ${mix("muted-fg", 30)};
}
${group}[data-multiple] > [data-hz-part=options] > [data-hz-part=option] > ${box} > [data-hz-part=mark] > svg { display: block; width: 100%; height: 100%; }
${group}[data-invalid] > [data-hz-part=options] > [data-hz-part=option] > ${box} { box-shadow: inset 0 0 0 1px var(--hz-color-invalid-border); }
${group}[data-invalid] > [data-hz-part=options] > [data-hz-part=option][data-selected] > ${box} { background-color: var(--hz-color-danger); }
${option}:focus-visible > ${box} { box-shadow: inset 0 0 0 1px var(--hz-color-primary), ${halo}; }

${optionOf("cards")} { position: relative; }
${optionOf("cards")} > [data-hz-part=optionText] { min-width: 0; overflow-wrap: anywhere; }
${optionOf("cards")}:not([data-selected], :disabled):hover { box-shadow: inset 0 0 0 1px ${mix("muted-fg", 30)}; }
${optionOf("cards")}[data-selected] {
	z-index: 1;
	background-color: var(--hz-color-primary-subtle);
	color: var(--hz-color-primary-subtle-fg);
	box-shadow: inset 0 0 0 1px var(--hz-color-focus-ring);
}
${optionOf("cards")}[data-selected]:hover { background-color: color-mix(in oklab, var(--hz-color-primary-subtle) 90%, transparent); }
${optionOf("cards")}[data-selected] > [data-hz-part=optionText] > :is([data-hz-part=optionLabel], [data-hz-part=optionDescription]),
${optionOf("cards")}[data-selected] > [data-hz-part=optionIcon] { color: var(--hz-color-primary-subtle-fg); }
${optionOf("cards")}:focus-visible { z-index: 1; box-shadow: inset 0 0 0 1px var(--hz-color-focus-ring), ${halo}; }
${optionOf("cards")} > [data-hz-part=optionIcon] > svg { display: block; width: 100%; height: 100%; }
${style("cards")}:is([data-columns="1"], :not([data-columns])) > [data-hz-part=options] > [data-hz-part=option] { border-radius: 0; }
${style("cards")}:is([data-columns="1"], :not([data-columns])) > [data-hz-part=options] > [data-hz-part=option] + [data-hz-part=option] { margin-top: -1px; }
${style("cards")}:is([data-columns="1"], :not([data-columns])) > [data-hz-part=options] > [data-hz-part=option]:first-child {
	border-start-start-radius: calc(var(--hz-radius-lg) - 1px);
	border-start-end-radius: calc(var(--hz-radius-lg) - 1px);
}
${style("cards")}:is([data-columns="1"], :not([data-columns])) > [data-hz-part=options] > [data-hz-part=option]:last-child {
	border-end-start-radius: calc(var(--hz-radius-lg) - 1px);
	border-end-end-radius: calc(var(--hz-radius-lg) - 1px);
}
@media (width >= 40rem) {
	${style("cards")}[data-columns="2"] > [data-hz-part=options] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
	${style("cards")}[data-columns="3"] > [data-hz-part=options] { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

${optionOf("segmented")}:not([data-selected], :disabled):hover > [data-hz-part=optionText] > [data-hz-part=optionLabel] { color: var(--hz-color-fg); }
${optionOf("segmented")}[data-selected] {
	background-color: var(--hz-color-bg);
	box-shadow: var(--hz-shadow-xs), 0 0 0 1px ${mix("fg", 10)};
}
${optionOf("segmented")}[data-selected] > [data-hz-part=optionText] > [data-hz-part=optionLabel] { color: var(--hz-color-fg); }
${optionOf("segmented")}:focus-visible, ${optionOf("chips")}:focus-visible { box-shadow: 0 0 0 2px var(--hz-color-focus-ring); }
${optionOf("chips")}:not([data-selected], :disabled):hover { background-color: var(--hz-color-secondary); }
${optionOf("chips")}:not([data-selected], :disabled):hover > [data-hz-part=optionText] > [data-hz-part=optionLabel] { color: var(--hz-color-fg); }
${optionOf("chips")}[data-selected] { background-color: var(--hz-color-chip-selected); border-color: var(--hz-color-chip-selected-border); }
${optionOf("chips")}[data-selected] > [data-hz-part=optionText] > [data-hz-part=optionLabel] { color: var(--hz-color-fg); }
:is(${optionOf("segmented")}, ${optionOf("chips")}) > [data-hz-part=optionIcon] > svg { display: block; width: 100%; height: 100%; }
${optionOf("swatches")} { cursor: pointer; forced-color-adjust: none; }
${optionOf("swatches")}:is([data-selected], :focus-visible) { outline: 2px solid var(--hz-color-ring); outline-offset: 2px; }
${optionOf("swatches")}[data-selected] > ${box} { box-shadow: inset 0 0 0 1px var(--hz-color-toggle-edge); }
${optionOf("swatches")}:focus-visible > ${box} { box-shadow: inset 0 0 0 1px var(--hz-color-toggle-edge); }

[data-hz=toggle][data-style=checkbox] > [data-hz-part=control] { outline: none; }
[data-hz=toggle][data-style=checkbox] > [data-hz-part=control] > [data-hz-part=box] > [data-hz-part=mark] > svg { display: block; width: 100%; height: 100%; }
[data-hz=toggle][data-style=checkbox]:not([data-selected], [data-indeterminate], [data-disabled]):hover > [data-hz-part=control] > [data-hz-part=box] {
	box-shadow: inset 0 0 0 1px ${mix("muted-fg", 30)};
}
[data-hz=toggle][data-style=checkbox][data-disabled]:not([data-selected], [data-indeterminate]) > [data-hz-part=control] > [data-hz-part=box] {
	background-color: var(--hz-color-muted);
}
[data-hz=toggle][data-style=checkbox] > [data-hz-part=control]:focus-visible > [data-hz-part=box] {
	box-shadow: inset 0 0 0 1px var(--hz-color-ring), ${halo};
}

[data-hz=slider] { touch-action: none; user-select: none; }
[data-hz=slider] > [data-hz-part=track] { position: relative; }
[data-hz=slider] > [data-hz-part=track] > [data-hz-part=fill] {
	position: absolute; inset-block: 0; inset-inline-start: 0; inline-size: var(--hz-slider-at); pointer-events: none;
}
[data-hz=slider] > [data-hz-part=track] > [data-hz-part=thumb] {
	position: absolute; top: 50%; inset-inline-start: var(--hz-slider-at); translate: -50% -50%;
	cursor: grab; outline: none; touch-action: none;
	transition: scale var(--hz-duration-fast) var(--hz-ease-out), box-shadow var(--hz-duration-fast) var(--hz-ease-out);
}
[data-hz=slider] > [data-hz-part=track] > [data-hz-part=thumb]:focus-visible {
	border-color: var(--hz-color-focus-ring); box-shadow: var(--hz-shadow-sm), ${halo};
}
[data-hz=slider][data-dragging] > [data-hz-part=track] > [data-hz-part=thumb] { scale: 1.1; cursor: grabbing; box-shadow: var(--hz-shadow-md); }
[data-hz=slider][data-disabled] > [data-hz-part=track] > [data-hz-part=thumb] { cursor: default; }
@media (prefers-reduced-motion: reduce) {
	[data-hz=slider] > [data-hz-part=track] > [data-hz-part=thumb] { transition: none; }
}

[data-hz=button] > [data-hz-part=remove] > svg { display: block; width: 100%; height: 100%; }
[data-hz=button]:not([data-disabled]) > [data-hz-part=remove]:hover { color: var(--hz-color-fg); background-color: var(--hz-color-secondary-hover); }
`

const installed = new WeakSet<Document>()

/** Adds the choice controls' renderer stylesheet to `document` once. */
export const ensureChoiceStyles = (document: Document) => {
	if (installed.has(document)) return
	installed.add(document)
	const sheet = document.createElement("style")
	sheet.dataset.hzRenderer = "choices"
	sheet.textContent = css
	document.head.append(sheet)
}
