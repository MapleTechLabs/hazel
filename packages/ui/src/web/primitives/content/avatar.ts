// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import type { AvatarPresence, AvatarSize } from "../../../vocabulary/options.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, flag, option, part, type Primitive } from "../define.ts"
import { ditherLayer, observeWidth, showsPicture } from "./dither.ts"
import { pressable } from "./press.ts"
import { ensureStyles } from "./styles.ts"

const presenceLabels = {
	none: "",
	online: "Online",
	away: "Away",
	busy: "Do not disturb",
	offline: "Offline",
} as const satisfies Record<AvatarPresence, string>

const presenceLabel = (status: string) =>
	Object.hasOwn(presenceLabels, status) ? presenceLabels[status as AvatarPresence] : ""

/** Each size's box before layout, in px (`regular` steps down from the size class); layout corrects it. */
const fixedPx = {
	xxsmall: 16,
	inline: 20,
	xsmall: 24,
	row: 28,
	small: 32,
	medium: 40,
	large: 48,
	xlarge: 56,
} as const satisfies Partial<Record<AvatarSize, number>>

const isFixed = (size: string): size is keyof typeof fixedPx => Object.hasOwn(fixedPx, size)

const sizePx = (size: string, document: Document) => {
	if (isFixed(size)) return fixedPx[size]
	return document.defaultView?.matchMedia("(width >= 40rem)").matches ? 16 : 20
}

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
	ensureStyles(document)
	const node = outer("span")
	// Seeded by `name`: today's dither and its one initial (`avatar-seed-tint`); else `initials`.
	const dither = ditherLayer(document)
	observeWidth(node, dither.resize)
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
	showsPicture(node, image)
	node.append(dither.layer, initials, image, presence, mark)
	let name = ""
	let initialsText = ""
	let size = "regular"
	let status = ""
	let placeholder = false
	const seed = () => {
		const seeded = name.trim() !== "" && !placeholder
		flag(node, "seeded", seeded)
		dither.seed(seeded ? name : undefined, sizePx(size, document))
		if (placeholder) glyph(initials, "user")
		else initials.textContent = seeded ? ditherInitial(name) : initialsText
	}
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
			if (prop === "name") {
				name = text ?? ""
				seed()
			} else if (prop === "initials") {
				initialsText = text ?? ""
				seed()
			} else if (prop === "src") {
				image.hidden = text === undefined
				flag(node, "pictured", false)
				if (text === undefined) image.removeAttribute("src")
				else image.setAttribute("src", text)
			} else if (prop === "size") {
				option(node, "size", value)
				size = text ?? "regular"
				seed()
			} else if (prop === "presence") {
				option(node, "presence", value)
				status = text ?? ""
				presence.hidden = text === undefined || text === "none"
			} else if (prop === "corners" || prop === "tint") {
				option(node, prop, text === "auto" || text === "none" ? undefined : value)
			} else if (prop === "placeholder") {
				placeholder = value === true
				flag(node, "placeholder", value)
				seed()
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
