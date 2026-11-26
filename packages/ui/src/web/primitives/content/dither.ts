/**
 * Today's seeded fallback (`avatar-seed-tint`): `ui/dither-avatar.ts`'s Bayer-dithered ramp between two
 * tones of a hue picked from the name, drawn behind the initial. The hue, path and grain are the app's.
 */
import { ditherHue, ditherPath } from "../../../../../../apps/web-foldkit/src/ui/dither-avatar.ts"
import { flag } from "../define.ts"

/**
 * Today's avatar shows only its picture once it loads, over the muted ground: the fallback steps aside
 * (`data-pictured`), or its tint would show through the picture's antialiased corners.
 */
export const showsPicture = (box: HTMLElement, image: HTMLElement) => {
	image.addEventListener("load", () => flag(box, "pictured", true))
	image.addEventListener("error", () => flag(box, "pictured", false))
}

const SVG = "http://www.w3.org/2000/svg"

/**
 * A layer filling its positioned parent: the dark tone, the lit cells over it. Hidden until seeded.
 * As the kit, a rounded clip holds an unrounded fill, so the corners antialias the same.
 */
export const ditherLayer = (document: Document) => {
	const layer = document.createElement("span")
	layer.dataset.hzPart = "dither"
	layer.setAttribute("aria-hidden", "true")
	layer.hidden = true
	const fill = document.createElement("span")
	fill.dataset.hzPart = "ditherFill"
	const svg = document.createElementNS(SVG, "svg")
	svg.setAttribute("preserveAspectRatio", "none")
	svg.setAttribute("shape-rendering", "crispEdges")
	const path = document.createElementNS(SVG, "path")
	svg.append(path)
	fill.append(svg)
	layer.append(fill)
	let seed: string | undefined
	let cells = 0
	const draw = (px: number) => {
		if (seed === undefined) return
		// 1px cells up to 24px, 2px above, as `ditherAvatar`.
		const next = Math.max(8, Math.round(px <= 24 ? px : px / 2))
		if (next === cells) return
		cells = next
		svg.setAttribute("viewBox", `0 0 ${cells} ${cells}`)
		path.setAttribute("d", ditherPath(cells))
	}
	return {
		layer,
		/** Seeds the tint by `name` (undefined hides it) for a box `px` wide. */
		seed: (name: string | undefined, px: number) => {
			seed = name?.trim() || undefined
			layer.hidden = seed === undefined
			if (seed === undefined) return
			const hue = ditherHue(seed)
			fill.style.backgroundColor = `oklch(0.4 0.13 ${hue})`
			path.setAttribute("fill", `oklch(0.55 0.12 ${hue})`)
			cells = 0
			draw(px)
		},
		/** The box was laid out at `px`: the grain follows the rendered size. */
		resize: draw,
	}
}

/** Calls `resize` with the node's rendered width whenever it changes (where layout exists). */
export const observeWidth = (node: HTMLElement, resize: (px: number) => void) => {
	if (typeof ResizeObserver === "undefined") return
	new ResizeObserver((entries) => {
		const width = entries[0]?.contentRect.width ?? 0
		if (width > 0) resize(width)
	}).observe(node)
}
