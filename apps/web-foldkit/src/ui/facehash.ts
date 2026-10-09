import type { Html, HtmlBuilder } from "foldkit/html"

/**
 * Port of `facehash@0.1.0` (React) as a pure view. Same hash, same faces, same inline
 * styles, so avatars render byte-identically to the legacy app. Non-interactive,
 * no blink: the only configuration the legacy app uses.
 */

const stringHash = (value: string) => {
	let hash = 0
	for (let index = 0; index < value.length; index++) {
		hash = (hash << 5) - hash + value.charCodeAt(index)
		hash &= hash
	}
	return Math.abs(hash)
}

type Face = <Message>(h: HtmlBuilder<Message>, style: Record<string, string>) => Html

const rect = <Message>(h: HtmlBuilder<Message>, attrs: Record<string, string>) =>
	h.rect([
		h.Attribute("fill", "currentColor"),
		...Object.entries(attrs).map(([key, value]) => h.Attribute(key, value)),
	])

const svg = <Message>(
	h: HtmlBuilder<Message>,
	viewBox: string,
	style: Record<string, string>,
	children: Html[],
) =>
	h.svg(
		[
			h.Attribute("aria-hidden", "true"),
			h.Attribute("fill", "none"),
			h.Style(style),
			h.Attribute("viewBox", viewBox),
			h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
		],
		children,
	)

const roundFace: Face = (h, style) =>
	svg(h, "0 0 63 15", style, [
		h.g(
			[],
			[
				h.circle(
					[
						h.Attribute("cx", "55.2"),
						h.Attribute("cy", "7.2"),
						h.Attribute("fill", "currentColor"),
						h.Attribute("r", "7.2"),
					],
					[],
				),
			],
		),
		h.g(
			[],
			[
				h.circle(
					[
						h.Attribute("cx", "7.2"),
						h.Attribute("cy", "7.2"),
						h.Attribute("fill", "currentColor"),
						h.Attribute("r", "7.2"),
					],
					[],
				),
			],
		),
	])

const crossFace: Face = (h, style) =>
	svg(h, "0 0 71 23", style, [
		h.g(
			[],
			[
				rect(h, { height: "23", rx: "3.5", width: "7", x: "8", y: "0" }),
				rect(h, { height: "7", rx: "3.5", width: "23", x: "0", y: "8" }),
			],
		),
		h.g(
			[],
			[
				rect(h, { height: "23", rx: "3.5", width: "7", x: "55.2", y: "0" }),
				rect(h, { height: "7", rx: "3.5", width: "23", x: "47.3", y: "8" }),
			],
		),
	])

const lineFace: Face = (h, style) =>
	svg(h, "0 0 82 8", style, [
		h.g(
			[],
			[
				rect(h, { height: "6.9", rx: "3.5", width: "6.9", x: "0.07", y: "0.16" }),
				rect(h, { height: "6.9", rx: "3.5", width: "20.7", x: "7.9", y: "0.16" }),
			],
		),
		h.g(
			[],
			[
				rect(h, { height: "6.9", rx: "3.5", width: "6.9", x: "74.7", y: "0.16" }),
				rect(h, { height: "6.9", rx: "3.5", width: "20.7", x: "53.1", y: "0.16" }),
			],
		),
	])

const curvedFace: Face = (h, style) =>
	svg(h, "0 0 63 9", style, [
		h.g(
			[],
			[
				h.path(
					[
						h.Attribute(
							"d",
							"M0 5.1c0-.1 0-.2 0-.3.1-.5.3-1 .7-1.3.1 0 .1-.1.2-.1C2.4 2.2 6 0 10.5 0S18.6 2.2 20.2 3.3c.1 0 .1.1.1.1.4.3.7.9.7 1.3v.3c0 1 0 1.4 0 1.7-.2 1.3-1.2 1.9-2.5 1.6-.2 0-.7-.3-1.8-.8C15 6.7 12.8 6 10.5 6s-4.5.7-6.3 1.5c-1 .5-1.5.7-1.8.8-1.3.3-2.3-.3-2.5-1.6v-1.7z",
						),
						h.Attribute("fill", "currentColor"),
					],
					[],
				),
			],
		),
		h.g(
			[],
			[
				h.path(
					[
						h.Attribute(
							"d",
							"M42 5.1c0-.1 0-.2 0-.3.1-.5.3-1 .7-1.3.1 0 .1-.1.2-.1C44.4 2.2 48 0 52.5 0S60.6 2.2 62.2 3.3c.1 0 .1.1.1.1.4.3.7.9.7 1.3v.3c0 1 0 1.4 0 1.7-.2 1.3-1.2 1.9-2.5 1.6-.2 0-.7-.3-1.8-.8C57 6.7 54.8 6 52.5 6s-4.5.7-6.3 1.5c-1 .5-1.5.7-1.8.8-1.3.3-2.3-.3-2.5-1.6v-1.7z",
						),
						h.Attribute("fill", "currentColor"),
					],
					[],
				),
			],
		),
	])

const FACES: ReadonlyArray<Face> = [roundFace, crossFace, lineFace, curvedFace]
const ROTATIONS = [
	{ x: -1, y: 1 },
	{ x: 1, y: 1 },
	{ x: 1, y: 0 },
	{ x: 0, y: 1 },
	{ x: -1, y: 0 },
	{ x: 0, y: 0 },
	{ x: 0, y: -1 },
	{ x: -1, y: -1 },
	{ x: 1, y: -1 },
] as const
const DRAMATIC = { rotateRange: 15, translateZ: 12, perspective: "300px" }

export const AVATAR_COLOR_CLASSES = [
	"bg-pink-500",
	"bg-blue-500",
	"bg-green-500",
	"bg-yellow-500",
	"bg-purple-500",
	"bg-orange-500",
	"bg-red-500",
] as const

export const facehash = <Message>(
	h: HtmlBuilder<Message>,
	name: string,
	colorClasses: ReadonlyArray<string> = AVATAR_COLOR_CLASSES,
): Html => {
	const hash = stringHash(name)
	const face = FACES[hash % FACES.length] ?? roundFace
	const colorClass = colorClasses[hash % colorClasses.length]
	const rotation = ROTATIONS[hash % ROTATIONS.length] ?? { x: 0, y: 0 }
	return h.div(
		[
			h.Class(["facehash", colorClass].filter(Boolean).join(" ")),
			h.Attribute("data-facehash", ""),
			h.Attribute("aria-hidden", "true"),
			h.Style({
				width: "100%",
				height: "100%",
				position: "relative",
				display: "flex",
				"align-items": "center",
				"justify-content": "center",
				overflow: "hidden",
				"container-type": "size",
				perspective: DRAMATIC.perspective,
				"transform-style": "preserve-3d",
			}),
		],
		[
			h.div([
				h.Attribute("data-facehash-gradient", ""),
				h.Style({
					position: "absolute",
					inset: "0px",
					"pointer-events": "none",
					"z-index": "1",
					background:
						"radial-gradient(ellipse 100% 100% at 50% 50%, rgba(255,255,255,0.15) 0%, transparent 60%)",
				}),
			]),
			h.div(
				[
					h.Attribute("data-facehash-face", ""),
					h.Style({
						position: "absolute",
						inset: "0px",
						display: "flex",
						"flex-direction": "column",
						"align-items": "center",
						"justify-content": "center",
						"z-index": "2",
						transform: `rotateX(${rotation.x * DRAMATIC.rotateRange}deg) rotateY(${rotation.y * DRAMATIC.rotateRange}deg) translateZ(${DRAMATIC.translateZ}px)`,
						"transform-style": "preserve-3d",
					}),
				],
				[
					face(h, { width: "60%", height: "auto", "max-width": "90%", "max-height": "40%" }),
					h.span(
						[
							h.Attribute("data-facehash-initial", ""),
							h.Style({ "margin-top": "8%", "font-size": "26cqw", "line-height": "1" }),
						],
						[name.charAt(0).toUpperCase()],
					),
				],
			),
		],
	)
}
