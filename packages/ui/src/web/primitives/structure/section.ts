// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:section`: a titled group of rows with
// one header action. Collapsible, its title is a disclosure; reorderable, its rows drag (`move`).
import { svg } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { attachReorder, reorderCss } from "../list/reorder.ts"
import { ensureSheet, fire, rowsOf, textOf } from "../list/runtime.ts"

const css = `
[data-hz="section"] > [data-hz-part="title"] > [data-hz-part="disclosure"] {
	display: inline-flex; align-items: center; gap: var(--hz-space-1); cursor: default;
	border-radius: var(--hz-radius-md); color: inherit;
}
/* Today's collapsible header (sectionGroupHeader): the chevron leads, pl-2.5, muted text-xs/5. */
[data-hz="section"][data-collapsible] > [data-hz-part="title"] {
	padding-inline: var(--hz-space-2_5) 0; margin-bottom: 0; line-height: var(--hz-space-5);
	color: var(--hz-color-muted-fg);
}
[data-hz="section"][data-collapsible] > [data-hz-part="title"] [data-hz-part="chevron"] { color: currentColor; }
/* Its "+" is today's round sq-xs button (sectionPlusButton): 28px with a 12px icon at regular widths. */
[data-hz="section"][data-collapsible] > [data-hz-part="content"] > [data-hz="action"] {
	border-radius: var(--hz-radius-full); color: var(--hz-color-muted-fg);
}
[data-hz="section"] [data-hz-part="chevron"] > svg { display: block; width: 100%; height: 100%; }
@media (width >= 40rem) {
	[data-hz="section"][data-collapsible] > [data-hz-part="content"] > [data-hz="action"] {
		width: var(--hz-space-7); height: var(--hz-space-7);
	}
	[data-hz="section"][data-collapsible] > [data-hz-part="content"] > [data-hz="action"] > [data-hz="icon"] {
		width: var(--hz-space-3); height: var(--hz-space-3);
	}
}
[data-hz="section"] > [data-hz-part="title"] > [data-hz-part="disclosure"]:active { color: var(--hz-color-fg); }
[data-hz="section"] > [data-hz-part="title"] > [data-hz-part="disclosure"]:hover { color: var(--hz-color-fg); }
[data-hz="section"] > [data-hz-part="title"] > [data-hz-part="disclosure"]:focus-visible {
	outline: 2px solid var(--hz-color-ring); outline-offset: 1px;
}
[data-hz="section"] [data-hz-part="chevron"] {
	display: block; width: var(--hz-space-3); height: var(--hz-space-3);
	transition: transform var(--hz-duration-fast) var(--hz-ease-out);
}
[data-hz="section"][data-collapsed] [data-hz-part="chevron"] { transform: rotate(-90deg); }
[data-hz="section"][data-collapsed] > [data-hz-part="content"] > :not([data-hz="action"]) { display: none; }
@media (prefers-reduced-motion: reduce) { [data-hz="section"] [data-hz-part="chevron"] { transition: none; } }
/* A \`tree\` section keeps today's empty rows grid under its header: 2px more when it has no rows. */
[data-hz="section"][data-style="tree"]:not(:has(> [data-hz-part="content"] > :not([data-hz="action"]))) {
	padding-bottom: calc(var(--hz-space-4) + var(--hz-space-0_5));
}
/* \`list\` and \`sticky\` (\`section-style\`): each child takes a line; a list's rows bleed past its inset. */
[data-hz="section"]:is([data-style="list"], [data-style="sticky"]) > [data-hz-part="content"] > * { flex: 1 1 100%; }
[data-hz="section"][data-style="list"] > [data-hz-part="content"] > [data-hz="item"] {
	width: calc(100% + 2 * var(--hz-space-4)); margin-inline: calc(var(--hz-space-4) * -1);
	flex-basis: calc(100% + 2 * var(--hz-space-4));
}
/* The inbox's label stays over its group while it scrolls (\`sticky top-0 bg-bg/95 backdrop-blur-sm\`). */
[data-hz="section"][data-style="sticky"] > [data-hz-part="title"] {
	position: sticky; top: 0; z-index: 1; backdrop-filter: blur(4px);
	background: color-mix(in oklab, var(--hz-color-bg) 95%, transparent);
}
${reorderCss('[data-hz="section"] > [data-hz-part="content"]')}
`

export const primitive = definePrimitive("section", ({ document, tag, outer }) => {
	ensureSheet(document, "section", css)
	const node = outer("section")
	const title = part(document, "h2", "title")
	const label = part(document, "span", "label")
	const disclosure = part(document, "button", "disclosure")
	disclosure.setAttribute("type", "button")
	const chevron = part(document, "span", "chevron")
	chevron.setAttribute("aria-hidden", "true")
	chevron.innerHTML = svg("chevron-down")
	const content = part(document, "div", "content")
	title.append(label)
	title.hidden = true
	node.append(title, content)

	let collapsible = false
	let collapsed = false
	let reorderable = false

	// The title's text lives in one label; collapsible, the label moves into the disclosure button.
	const layout = () => {
		if (collapsible && disclosure.parentNode !== title) {
			disclosure.append(chevron, label)
			title.append(disclosure)
		} else if (!collapsible && label.parentNode !== title) {
			title.append(label)
			disclosure.remove()
		}
		if (collapsible) disclosure.setAttribute("aria-expanded", String(!collapsed))
	}

	disclosure.addEventListener("click", () => fire(primitive, "toggle", { collapsed: !collapsed }))

	const reorder = attachReorder({
		container: content,
		rows: () => rowsOf(content),
		enabled: () => reorderable,
		move: (id, before) => fire(primitive, "move", { id, before }),
	})
	const win = document.defaultView
	if (win?.MutationObserver !== undefined)
		new win.MutationObserver(() => reorder.sync()).observe(content, { childList: true })

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "title") {
				label.textContent = textOf(value)
				title.hidden = textOf(value) === ""
				if (textOf(value) === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", textOf(value))
			} else if (name === "collapsible") {
				collapsible = value === true
				flag(node, "collapsible", value)
				layout()
			} else if (name === "collapsed") {
				collapsed = value === true
				flag(node, "collapsed", value)
				layout()
			} else if (name === "style") option(node, "style", value)
			else if (name === "reorderable") {
				reorderable = value === true
				flag(node, "reorderable", value)
				reorder.sync()
			}
		},
		events: undefined,
	}
	return primitive
})
