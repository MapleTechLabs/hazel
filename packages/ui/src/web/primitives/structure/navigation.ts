// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:navigation`: a stack of screens, the
// last child on top. The top screen's back button, or Alt+ArrowLeft, raises `pop {depth: 1}`.
import { definePrimitive, type Primitive } from "../define.ts"
import { ensureSheet, fire } from "../list/runtime.ts"

// Only the top screen shows; the ones under it stay mounted (their scroll and state kept).
const css = `
[data-hz="navigation"] { display: flex; flex-direction: column; min-height: 0; }
[data-hz="navigation"] > [data-hz]:not(:last-child) { display: none; }
[data-hz="navigation"] > [data-hz]:last-child { flex: 1 1 auto; min-height: 0; }
`

export const primitive = definePrimitive("navigation", ({ document, outer, self }) => {
	ensureSheet(document, "navigation", css)
	const node = outer("div")
	const top = () => {
		const last = node.lastElementChild
		return last instanceof HTMLElement ? last : undefined
	}
	const depth = () => node.children.length
	node.addEventListener("click", (event) => {
		const target = event.target instanceof Element ? event.target : null
		const back = target?.closest("[data-hz-part=back]")
		const screen = back?.parentElement?.parentElement
		if (back === null || back === undefined || screen !== top() || depth() < 2) return
		fire(primitive, "pop", { depth: 1 })
	})
	node.addEventListener("keydown", (event) => {
		if (!event.altKey || event.key !== "ArrowLeft" || depth() < 2) return
		if (fire(primitive, "pop", { depth: 1 })) event.preventDefault()
	})
	const primitive: Primitive = self(node, () => {})
	return primitive
})
