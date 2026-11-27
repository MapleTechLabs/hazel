/**
 * `hz:contextMenu` on the web (lane A3): its children are the region; a right click, a long press
 * (touch), Shift+F10 or the ContextMenu key inside it opens the entries at the pointer or the focused
 * element (`menu-list.ts`). A pick raises `select`. In a gallery frame it draws open in place.
 */
import type { Rect } from "../../../vocabulary/Hazel.ts"
import { measureNode } from "../../focus/measure.ts"
import { isSpecimen, whenConnected } from "../../focus/surface.ts"
import { definePrimitive, part, type Primitive } from "../define.ts"
import { asGroups, createMenuList } from "./menu-list.ts"
import { fire } from "./overlay.ts"

const LONG_PRESS_MS = 500
const SLOP = 8

export const primitive = definePrimitive("contextMenu", ({ document, tag, outer }) => {
	const node = outer("div")
	const content = part(document, "div", "content")
	node.append(content)
	const list = createMenuList(document, node, (id) => fire(primitive, "select", { id }))

	const openAt = (rect: Rect) => {
		list.close(false)
		list.open({
			anchor: () => rect,
			placement: { side: "bottom", align: "start", gap: 2 },
			focus: "first",
		})
	}
	content.addEventListener("contextmenu", (event) => {
		event.preventDefault()
		openAt({ x: event.clientX, y: event.clientY, width: 0, height: 0 })
	})
	content.addEventListener("keydown", (event) => {
		if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
		event.preventDefault()
		openAt(event.target instanceof Node ? measureNode(event.target) : measureNode(content))
	})

	// Touch: a still press held for LONG_PRESS_MS opens it where the finger is.
	let timer: ReturnType<typeof setTimeout> | undefined
	let start: { readonly x: number; readonly y: number } | undefined
	const cancel = () => {
		if (timer !== undefined) clearTimeout(timer)
		timer = undefined
		start = undefined
	}
	content.addEventListener("pointerdown", (event) => {
		if (event.pointerType !== "touch") return
		cancel()
		const at = { x: event.clientX, y: event.clientY }
		start = at
		timer = setTimeout(() => {
			cancel()
			openAt({ ...at, width: 0, height: 0 })
		}, LONG_PRESS_MS)
	})
	content.addEventListener("pointermove", (event) => {
		if (start !== undefined && Math.hypot(event.clientX - start.x, event.clientY - start.y) > SLOP)
			cancel()
	})
	content.addEventListener("pointerup", cancel)
	content.addEventListener("pointercancel", cancel)

	whenConnected(node)(() => {
		if (isSpecimen(node)) openAt(measureNode(content))
	})

	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			if (name === "entries") list.setEntries(asGroups(value))
		},
		events: undefined,
	}
	return primitive
})
