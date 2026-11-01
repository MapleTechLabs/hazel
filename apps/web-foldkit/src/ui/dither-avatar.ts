import type { Html, HtmlBuilder } from "foldkit/html"

/**
 * Default avatar when there is no image: a Bayer-dithered diagonal ramp between two tones
 * of a hue picked from the name, with the name's first letter on top. Pure SVG, so it
 * scales with the avatar and needs no canvas.
 */

const stringHash = (value: string) => {
	let hash = 0
	for (let index = 0; index < value.length; index++) {
		hash = (hash << 5) - hash + value.charCodeAt(index)
		hash &= hash
	}
	return Math.abs(hash)
}

/**
 * OKLCH hues the seed picks from, brand purple first. On every hue both tones (L 0.4 and 0.55)
 * keep the white initial at 4.5:1 or more.
 */
const HUES = [285, 255, 215, 165, 85, 45, 15, 330] as const

export const ditherHue = (seed: string): number => HUES[stringHash(seed) % HUES.length] ?? HUES[0]

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** First grapheme of the seed (whole emoji included), uppercased unless that makes it longer ("ß" → "SS"). */
export const ditherInitial = (seed: string): string => {
	const first = graphemes.segment(seed.trim())[Symbol.iterator]().next().value?.segment
	if (first === undefined) return "?"
	const upper = first.toUpperCase()
	return upper.length === first.length ? upper : first
}

const BAYER_4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
] as const
const BAYER_2 = [
	[0, 2],
	[3, 1],
] as const

/** 8×8 ordered-dither threshold in (0, 1), built from the 4×4 and 2×2 matrices. */
const bayer = (x: number, y: number) =>
	(4 * BAYER_4[y % 4]![x % 4]! + BAYER_2[(y >> 2) & 1]![(x >> 2) & 1]! + 0.5) / 64

const pathCache = new Map<number, string>()

/**
 * The lit cells of an `n`×`n` grid dithering a ramp that is brightest at the top left,
 * as one SVG path in grid units. Horizontal runs merge into one rectangle each.
 * Independent of the seed, so it is computed once per grid size.
 */
export const ditherPath = (n: number): string => {
	const cached = pathCache.get(n)
	if (cached !== undefined) return cached
	const span = Math.max(1, 2 * (n - 1))
	const parts: string[] = []
	for (let y = 0; y < n; y++) {
		let runStart = -1
		for (let x = 0; x <= n; x++) {
			const lit = x < n && (1 - (x + y) / span) * 1.05 - 0.05 > bayer(x, y)
			if (lit && runStart < 0) runStart = x
			if (!lit && runStart >= 0) {
				parts.push(`M${runStart} ${y}h${x - runStart}v1h${runStart - x}z`)
				runStart = -1
			}
		}
	}
	const path = parts.join("")
	pathCache.set(n, path)
	return path
}

/** `size` is the avatar's rendered size in CSS pixels; it sets the grain (1px cells up to 24px, 2px above). */
export const ditherAvatar = <Message>(h: HtmlBuilder<Message>, seed: string, size: number): Html => {
	const hue = ditherHue(seed)
	const cells = Math.max(8, Math.round(size <= 24 ? size : size / 2))
	return h.div(
		[
			h.Attribute("data-dither-avatar", ""),
			h.Attribute("aria-hidden", "true"),
			h.Class(
				"relative flex size-full items-center justify-center overflow-hidden [container-type:size]",
			),
			h.Style({ "background-color": `oklch(0.4 0.13 ${hue})` }),
		],
		[
			h.svg(
				[
					h.Attribute("aria-hidden", "true"),
					h.Attribute("class", "absolute inset-0 size-full"),
					h.Attribute("viewBox", `0 0 ${cells} ${cells}`),
					h.Attribute("preserveAspectRatio", "none"),
					h.Attribute("shape-rendering", "crispEdges"),
					h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
				],
				[
					h.path([
						h.Attribute("d", ditherPath(cells)),
						h.Attribute("fill", `oklch(0.55 0.12 ${hue})`),
					]),
				],
			),
			h.span(
				[
					h.Class(
						"relative font-semibold text-white leading-none [text-box:trim-both_cap_alphabetic]",
					),
					h.Style({ "font-size": "46cqw" }),
				],
				[ditherInitial(seed)],
			),
		],
	)
}
