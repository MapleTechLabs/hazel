// Owned by lane A4 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:navigation`: a stack of screens, the
// last child on top. The top screen's back button, or Alt+ArrowLeft, raises `pop {depth: 1}`.
import { definePrimitive, flag, type Primitive } from "../define.ts"
import { ensureSheet, fire } from "../list/runtime.ts"

// Only the top screen shows; the ones under it stay mounted (their scroll and state kept). The
// `rootToolbar` slot sits over the root screen's bar end, and only while the root is on top.
const css = `
[data-hz="navigation"] { position: relative; display: flex; flex-direction: column; min-height: 0; }
[data-hz="navigation"] > [data-under] { display: none; }
[data-hz="navigation"] > [data-top] { flex: 1 1 auto; min-height: 0; }
[data-hz="navigation"] > [data-hz-slot="rootToolbar"] {
	position: absolute; top: 0; inset-inline-end: var(--hz-space-4); height: var(--hz-space-14);
	display: flex; align-items: center; gap: var(--hz-space-1); z-index: 12;
}
[data-hz="navigation"]:not([data-at-root]) > [data-hz-slot="rootToolbar"] { display: none; }
`

export const primitive = definePrimitive("navigation", ({ document, outer, self }) => {
	ensureSheet(document, "navigation", css)
	const node = outer("div")
	const screens = () =>
		Array.from(node.children).filter(
			(child): child is HTMLElement =>
				child instanceof HTMLElement && child.dataset.hzSlot === undefined,
		)
	const top = () => screens().at(-1)
	const depth = () => screens().length
	// The top screen shows, those under it hide; at the root the `rootToolbar` slot shows.
	const restack = () => {
		const list = screens()
		list.forEach((screen, index) => {
			flag(screen, "top", index === list.length - 1)
			flag(screen, "under", index < list.length - 1)
		})
		flag(node, "at-root", list.length === 1)
	}
	const win = document.defaultView
	if (win?.MutationObserver !== undefined)
		new win.MutationObserver(restack).observe(node, { childList: true })
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
