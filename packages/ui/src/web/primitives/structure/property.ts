// Owned by lane A4 (phase 4, W9). `hz:property`: a label and its value (the children), as today's
// customer sidebar row (`page/customers/detail/parts.ts` `property`). A group named by its label.
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { ensureSheet, textOf } from "../list/runtime.ts"

// `grid-cols-[7rem_1fr] items-center`: a fixed label column, so rows in a frame align; the
// description sits under the label, and the value spans both lines when there is one.
const css = `
[data-hz="property"] {
	display: grid; grid-template-columns: calc(var(--hz-space-7) * 4) minmax(0, 1fr); align-items: center;
}
[data-hz="property"] > [data-hz-part="label"] { grid-column: 1; grid-row: 1; min-width: 0; }
[data-hz="property"] > [data-hz-part="description"] { grid-column: 1; grid-row: 2; }
[data-hz="property"] > [data-hz-part="description"]:empty { display: none; }
[data-hz="property"] > [data-hz-part="value"] { grid-column: 2; grid-row: 1; min-width: 0; }
[data-hz="property"][data-described] > [data-hz-part="value"] { grid-row: 1 / span 2; }
`

let counter = 0

export const primitive = definePrimitive("property", ({ document, tag, outer }) => {
	ensureSheet(document, "property", css)
	const node = outer("div")
	node.setAttribute("role", "group")
	const label = part(document, "span", "label")
	label.id = `hz-property-${++counter}`
	node.setAttribute("aria-labelledby", label.id)
	const description = part(document, "span", "description")
	const value = part(document, "div", "value")
	node.append(label, description, value)
	const primitive: Primitive = {
		tag,
		outer: node,
		content: value,
		set: (name, input) => {
			if (name === "label") label.textContent = textOf(input)
			else if (name === "description") {
				description.textContent = textOf(input)
				flag(node, "described", textOf(input) !== "")
			}
		},
		events: undefined,
	}
	return primitive
})
