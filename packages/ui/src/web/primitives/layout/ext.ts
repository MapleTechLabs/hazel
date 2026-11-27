// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G1 renderer, moved here in C0.
import { mountExtension } from "../../extensions.ts"
import { definePrimitive, part, type Plain, type Primitive } from "../define.ts"

export const primitive = definePrimitive("ext", ({ document, tag, outer }) => {
	const node = outer("div")
	const surface = part(document, "div", "surface")
	const content = part(document, "div", "content")
	// One of the two shows: the platform's drawing once drawn, else the fallback.
	surface.hidden = true
	node.append(surface, content)
	let ext: string | undefined
	let args: Plain | undefined
	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "args") args = value
			else if (name === "ext") ext = typeof value === "string" ? value : undefined
			else return
			if (ext !== undefined) node.dataset.ext = ext
			// Props arrive one at a time after create: draw once both name and args are known.
			if (ext === undefined || args === undefined) return
			const send = (event: string, payload: Plain) => {
				const events = primitive.events
				const handler = events?.handlers[event]
				return (
					handler !== undefined && events !== undefined && events.dispatch(event, handler, payload)
				)
			}
			// Drawn here if this platform registered it; else the fallback slot shows.
			if (mountExtension(surface, ext, args, send)) {
				node.dataset.drawn = ""
				surface.hidden = false
				content.hidden = true
			}
		},
		events: undefined,
	}
	return primitive
})
