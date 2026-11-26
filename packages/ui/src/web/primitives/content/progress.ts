// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { loop } from "../../motion.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"

export const primitive = definePrimitive("progress", ({ document, tag, outer }) => {
	const node = outer("div")
	node.setAttribute("role", "progressbar")
	node.setAttribute("aria-valuemin", "0")
	node.setAttribute("aria-valuemax", "100")
	const label = part(document, "span", "label")
	label.hidden = true
	const track = part(document, "span", "track")
	const fill = part(document, "span", "fill")
	// Renderer-owned: the fill's width is the value, and the slide clips at the track's ends.
	track.style.position = "relative"
	track.style.overflow = "hidden"
	fill.style.position = "absolute"
	fill.style.insetBlock = "0"
	fill.style.insetInlineStart = "0"
	fill.style.width = "0%"
	track.append(fill)
	node.append(label, track)
	let value = 0
	let indeterminate = false
	const draw = () => {
		// The kit's `w-2/5 animate-progress-slide` (`recipe.motion` loop), or the value's width easing
		// over 200ms (`transition-[width] duration-200 ease-linear`).
		loop(fill, indeterminate)
		if (indeterminate) {
			node.removeAttribute("aria-valuenow")
			fill.style.transition = "none"
			fill.style.width = "40%"
			return
		}
		const percent = Math.round(Math.min(1, Math.max(0, value)) * 100)
		node.setAttribute("aria-valuenow", String(percent))
		fill.style.transition = "width var(--hz-duration-normal) var(--hz-ease-linear)"
		fill.style.width = `${percent}%`
	}
	draw()
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, next) => {
			if (name === "value") value = typeof next === "number" ? next : 0
			else if (name === "indeterminate") {
				indeterminate = next === true
				flag(node, "indeterminate", next)
			} else if (name === "label") {
				const text = typeof next === "string" ? next : ""
				label.textContent = text
				label.hidden = text === ""
				if (text === "") node.removeAttribute("aria-label")
				else node.setAttribute("aria-label", text)
				return
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
