// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { definePrimitive } from "../define.ts"
import { pressable } from "./press.ts"

export const primitive = definePrimitive("image", ({ outer, self }) => {
	const node = outer("img")
	node.setAttribute("alt", "")
	node.setAttribute("decoding", "async")
	// Renderer-owned: the box keeps the picture's ratio and never overflows its container.
	node.style.maxWidth = "100%"
	node.style.height = "auto"
	node.style.objectFit = "cover"
	let pressed = false
	// A pressable picture is a button named by its `alt`.
	const name = () => {
		const alt = node.getAttribute("alt") ?? ""
		if (pressed && alt !== "") node.setAttribute("aria-label", alt)
		else node.removeAttribute("aria-label")
	}
	const set = (prop: string, value: unknown) => {
		if (prop === "src" || prop === "alt") {
			node.setAttribute(prop, typeof value === "string" ? value : "")
			name()
		} else if (prop === "width" || prop === "height") {
			if (typeof value === "number" && value > 0) node.setAttribute(prop, String(value))
			else node.removeAttribute(prop)
		}
	}
	return pressable(self(node, set), node, (on) => {
		pressed = on
		node.style.cursor = on ? "pointer" : ""
		name()
	})
})
