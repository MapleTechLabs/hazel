// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:listDivider`: a labelled rule between
// rows, a day (`date`, the label centred) or where unread begins (`unread`, the label at the end).
import { definePrimitive, option, part } from "../define.ts"
import { ensureSheet } from "./runtime.ts"

// The unread rule runs up to its label at the end; a recipe cannot drop a part. A day sticks to the
// list's top with its pill where today's stuck one sits (the list's `py-2` above it),
// in the mono family (no mono caption step yet).
const css = `[data-hz="listDivider"][data-kind="unread"] > [data-hz-part="lineEnd"] { display: none; }
[data-hz="listDivider"]:not([data-kind="unread"]) { position: sticky; top: calc(var(--hz-space-2) * -1); z-index: 1; }
[data-hz="listDivider"]:not([data-kind="unread"]) > [data-hz-part="label"] { font-family: var(--hz-font-mono); }`

export const primitive = definePrimitive("listDivider", ({ document, tag, outer }) => {
	ensureSheet(document, "listDivider", css)
	const node = outer("div")
	node.setAttribute("role", "separator")
	const before = part(document, "span", "lineStart")
	const label = part(document, "span", "label")
	const after = part(document, "span", "lineEnd")
	label.hidden = true
	node.append(before, label, after)
	return {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "kind") option(node, "kind", value)
			else if (name === "label") {
				const text = typeof value === "string" ? value : ""
				label.textContent = text
				label.hidden = text === ""
				if (text === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", text)
			}
		},
		events: undefined,
	}
})
