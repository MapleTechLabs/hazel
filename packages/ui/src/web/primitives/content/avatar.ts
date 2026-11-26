// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import type { AvatarPresence } from "../../../vocabulary/options.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"
import { pressable } from "./press.ts"

const presenceLabels = {
	none: "",
	online: "Online",
	away: "Away",
	busy: "Do not disturb",
	offline: "Offline",
} as const satisfies Record<AvatarPresence, string>

const presenceLabel = (status: string) =>
	Object.hasOwn(presenceLabels, status) ? presenceLabels[status as AvatarPresence] : ""

/** A corner badge: absolutely placed at the bottom right, a quarter outside (`presence-dot.ts`). */
const corner = (node: HTMLElement) => {
	node.style.position = "absolute"
	node.style.right = "0"
	node.style.bottom = "0"
	node.style.transform = "translate(25%, 25%)"
	node.hidden = true
	return node
}

export const primitive = definePrimitive("avatar", ({ document, tag, outer }) => {
	const node = outer("span")
	node.style.position = "relative"
	const initials = part(document, "span", "initials")
	initials.setAttribute("aria-hidden", "true")
	const image = part(document, "img", "image")
	image.setAttribute("alt", "")
	image.style.position = "absolute"
	image.style.inset = "0"
	image.style.objectFit = "cover"
	image.hidden = true
	const presence = corner(part(document, "span", "presence"))
	const mark = corner(part(document, "span", "mark"))
	mark.setAttribute("aria-hidden", "true")
	node.append(initials, image, presence, mark)
	let name = ""
	let status = ""
	// One accessible name: the person, and their presence when it shows.
	const label = () => {
		const text = [name, presenceLabel(status)].filter(Boolean).join(", ")
		if (text === "") {
			node.removeAttribute("aria-label")
			if (node.getAttribute("role") !== "button") node.setAttribute("aria-hidden", "true")
		} else {
			node.setAttribute("aria-label", text)
			node.removeAttribute("aria-hidden")
			if (node.getAttribute("role") !== "button") node.setAttribute("role", "img")
		}
	}
	label()
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (prop, value) => {
			const text = typeof value === "string" ? value : undefined
			if (prop === "name") name = text ?? ""
			else if (prop === "initials") initials.textContent = text ?? ""
			else if (prop === "src") {
				image.hidden = text === undefined
				if (text === undefined) image.removeAttribute("src")
				else image.setAttribute("src", text)
			} else if (prop === "size") option(node, "size", value)
			else if (prop === "presence") {
				option(node, "presence", value)
				status = text ?? ""
				presence.hidden = text === undefined || text === "none"
			} else if (prop === "mark") {
				option(node, "mark", value)
				mark.hidden = text === undefined || text === "none"
				glyph(mark, text)
			} else return
			label()
		},
		events: undefined,
	}
	return pressable(primitive, node, (on) => {
		if (!on) node.removeAttribute("role")
		node.style.cursor = on ? "pointer" : ""
		label()
	})
})
