/**
 * A leaf that raises `press` only when the view handles it (`avatar`, `image`): then it is a button to
 * assistive technology and the keyboard (Enter and Space click it; the host maps `press` to `click`).
 */
import type { Events, Primitive } from "../define.ts"

const keydown = (event: KeyboardEvent) => {
	if (event.key !== "Enter" && event.key !== " ") return
	event.preventDefault()
	if (event.currentTarget instanceof HTMLElement) event.currentTarget.click()
}

/** Makes `primitive.events` a setter that turns `node` into a button while `press` is handled. */
export const pressable = (
	primitive: Primitive,
	node: HTMLElement,
	onChange?: (pressable: boolean) => void,
) => {
	let events: Events | undefined
	let on = false
	Object.defineProperty(primitive, "events", {
		enumerable: true,
		get: () => events,
		set: (next: Events | undefined) => {
			events = next
			const wanted = next?.handlers.press !== undefined
			if (wanted === on) return
			on = wanted
			if (on) {
				node.setAttribute("role", "button")
				node.tabIndex = 0
				node.addEventListener("keydown", keydown)
			} else {
				node.removeAttribute("role")
				node.removeAttribute("tabindex")
				node.removeEventListener("keydown", keydown)
			}
			onChange?.(on)
		},
	})
	return primitive
}
