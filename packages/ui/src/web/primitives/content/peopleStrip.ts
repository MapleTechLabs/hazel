// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import { Schema } from "effect"
import { ditherInitial } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { StripPerson } from "../../../vocabulary/content.ts"
import type { AvatarPresence } from "../../../vocabulary/options.ts"
import { definePrimitive, flag, part, type Primitive } from "../define.ts"
import { ditherLayer } from "./dither.ts"
import { ensureStyles } from "./styles.ts"

const isPerson = Schema.is(StripPerson)

const presenceLabels = {
	none: undefined,
	online: "Online",
	away: "Away",
	busy: "Do not disturb",
	offline: "Offline",
} as const satisfies Record<AvatarPresence, string | undefined>

/** One tile: a link (its `href`) holding the avatar and the label; the label names it. */
const tileOf = (document: Document, person: StripPerson) => {
	const tile = part(document, "a", "tile")
	tile.dataset.id = person.id
	if (person.href !== undefined) tile.setAttribute("href", person.href)
	else {
		tile.setAttribute("role", "button")
		tile.tabIndex = 0
	}
	flag(tile, "emphasized", person.emphasized === true)
	const avatar = part(document, "span", "avatar")
	avatar.setAttribute("aria-hidden", "true")
	const dither = ditherLayer(document)
	const initials = part(document, "span", "initials")
	avatar.append(dither.layer, initials)
	if (person.src !== undefined) {
		const image = part(document, "img", "image")
		image.setAttribute("src", person.src)
		image.setAttribute("alt", "")
		avatar.append(image)
	}
	// Today's seeded fallback, at the kit's `xl` (56px): seeded by the full name.
	const seeded = person.name.trim() !== ""
	flag(avatar, "seeded", seeded)
	dither.seed(seeded ? person.name : undefined, 56)
	initials.textContent = seeded ? ditherInitial(person.name) : person.initials
	const status = person.presence ?? "none"
	if (status !== "none") {
		const presence = part(document, "span", "presence")
		presence.dataset.presence = status
		avatar.append(presence)
	}
	const label = part(document, "span", "label")
	label.textContent = person.label
	const presenceLabel = presenceLabels[status]
	if (presenceLabel !== undefined) tile.setAttribute("aria-label", `${person.label}, ${presenceLabel}`)
	tile.append(avatar, label)
	return tile
}

export const primitive = definePrimitive("peopleStrip", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("nav")
	node.setAttribute("aria-label", "People")
	let last: unknown
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name !== "people" || value === last) return
			last = value
			const people = Array.isArray(value) ? value.filter(isPerson) : []
			node.replaceChildren(...people.map((person) => tileOf(document, person)))
		},
		events: undefined,
	}
	const press = (event: Event) => {
		const tile = event.target instanceof Element ? event.target.closest("[data-hz-part=tile]") : null
		const events = primitive.events
		const handler = events?.handlers.press
		if (!(tile instanceof HTMLElement) || events === undefined || handler === undefined) return
		// A modified click keeps the link's own behaviour (a new tab, copy link).
		if (
			event instanceof MouseEvent &&
			(event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
		)
			return
		event.preventDefault()
		events.dispatch("press", handler, { id: tile.dataset.id ?? "" })
	}
	node.addEventListener("click", press)
	node.addEventListener("keydown", (event) => {
		const tile = event.target instanceof HTMLElement ? event.target : null
		if (tile?.getAttribute("role") !== "button" || (event.key !== "Enter" && event.key !== " ")) return
		event.preventDefault()
		tile.click()
	})
	return primitive
})
