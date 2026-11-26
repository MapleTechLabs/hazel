// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:screen`: a title bar over its content,
// with a back button (`back`) and a `toolbar` slot drawn at the bar's end.
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ensureSheet, fire, textOf } from "../list/runtime.ts"

// `floatingAction` (`floating-action`): today's DMs compose, a 56px round button that sticks to the
// end corner of the scrolling content, after the last row; only the button takes the pointer.
const FLOATING = '[data-hz="screen"] > [data-hz-part="content"] > [data-hz-slot="floatingAction"]'
const floatingCss = `
${FLOATING} {
	order: 1; position: sticky; bottom: var(--hz-space-4); margin-top: auto; display: flex;
	justify-content: flex-end; padding: var(--hz-space-4) var(--hz-space-4) 0; pointer-events: none;
}
${FLOATING} > * { pointer-events: auto; }
${FLOATING} > [data-hz="button"] {
	width: var(--hz-space-14); height: var(--hz-space-14); border-radius: var(--hz-radius-full);
	box-shadow: var(--hz-shadow-lg);
}
${FLOATING} > [data-hz="button"] > [data-hz-part="icon"] { width: var(--hz-space-6); height: var(--hz-space-6); }
`

// The toolbar slot stays in the content parent (slots never move) and is placed over the bar's end.
// A recipe's interaction states are the root's, so the back button's own hover is here.
const css = `
[data-hz="screen"] { position: relative; }
[data-hz="screen"] > [data-hz-part="content"] > [data-hz-slot="toolbar"] {
	position: absolute; top: 0; inset-inline-end: var(--hz-space-4); height: var(--hz-space-14);
	display: flex; align-items: center; gap: var(--hz-space-1);
}
[data-hz="screen"] > [data-hz-part="content"] > [data-hz-slot="toolbar"] > [data-hz="icon"] {
	width: var(--hz-space-5); height: var(--hz-space-5); color: var(--hz-color-fg-3);
}
[data-hz="screen"] > [data-hz-part="header"] > [data-hz-part="back"] > svg { display: block; width: 100%; height: 100%; transform: scaleX(-1); }
[data-hz="screen"] > [data-hz-part="header"] > [data-hz-part="back"]:is(:hover, :active) {
	background: var(--hz-color-wash); color: var(--hz-color-fg);
}
[data-hz="screen"] > [data-hz-part="header"] > [data-hz-part="back"]:focus-visible {
	outline: 2px solid var(--hz-color-ring); outline-offset: -2px;
}
[data-hz="screen"] > [data-hz-part="header"] > [data-hz-part="title"] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* A phone tab's page (\`surface\` \`page\`): at least its container's height, so the floating action
   reaches the bottom, under a bar that sticks (\`sticky top-0 z-10\`). */
[data-hz="screen"][data-surface="page"] { min-height: 100%; flex: 1 0 auto; }
[data-hz="screen"][data-surface="page"] > [data-hz-part="header"] { position: sticky; top: 0; z-index: 10; background: inherit; }
${floatingCss}
`

export const primitive = definePrimitive("screen", ({ document, tag, outer }) => {
	ensureSheet(document, "screen", css)
	const node = outer("main")
	const header = part(document, "header", "header")
	const back = part(document, "button", "back")
	back.setAttribute("type", "button")
	back.setAttribute("aria-label", "Back")
	back.innerHTML = svg("chevron-right")
	back.hidden = true
	const title = part(document, "h1", "title")
	const content = part(document, "div", "content")
	header.append(back, title)
	node.append(header, content)
	back.addEventListener("click", () => fire(primitive, "back"))
	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") title.textContent = textOf(value)
			else if (name === "surface") option(node, "surface", value)
			else if (name === "back") {
				back.hidden = value !== true
				flag(node, "back", value)
			}
		},
		events: undefined,
	}
	return primitive
})
