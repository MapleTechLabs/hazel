import type { Html, HtmlBuilder } from "foldkit/html"

/** The inline Video.js minimal icon set from `components/chat/video-player.tsx`. */

const VOLUME_BASE =
	"M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752m10.568.59a.91.91 0 0 1 0-1.316.91.91 0 0 1 1.316 0c1.203 1.203 1.47 2.216 1.522 3.208q.012.255.011.51c0 1.16-.358 2.733-1.533 3.803a.7.7 0 0 1-.298.156c-.382.106-.873-.011-1.018-.156a.91.91 0 0 1 0-1.316c.57-.57.995-1.551.995-2.487 0-.944-.26-1.667-.995-2.402"
const FULLSCREEN_LAST = "M6.72 10.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06-1.06z"

/** Spinner rects: [width, height, x, y, opacity, transform?], animated at 0.125s steps. */
const SPINNER: ReadonlyArray<readonly [number, number, number, number, number, string?]> = [
	[2, 5, 8, 0.5, 0.5],
	[2, 5, 12.243, 2.257, 0.45, "rotate(45 13.243 4.757)"],
	[5, 2, 12.5, 8, 0.4],
	[5, 2, 10.743, 12.243, 0.35, "rotate(45 13.243 13.243)"],
	[2, 5, 8, 12.5, 0.3],
	[2, 5, 3.757, 10.743, 0.25, "rotate(45 4.757 13.243)"],
	[5, 2, 0.5, 8, 0.15],
	[5, 2, 2.257, 3.757, 0.1, "rotate(45 4.757 4.757)"],
]

export const videoIcons = <M>(h: HtmlBuilder<M>) => {
	const svg = (className: string, children: ReadonlyArray<Html>, fill = "none") =>
		h.svg(
			[
				h.Attribute("xmlns", "http://www.w3.org/2000/svg"),
				h.Attribute("width", "18"),
				h.Attribute("height", "18"),
				h.Attribute("fill", fill),
				h.Attribute("viewBox", "0 0 18 18"),
				h.Attribute("aria-hidden", "true"),
				h.Class(className),
			],
			children,
		)
	const path = (d: string) => h.path([h.Attribute("fill", "currentColor"), h.Attribute("d", d)])
	const rect = (x: number) =>
		h.rect([
			h.Attribute("width", "4"),
			h.Attribute("height", "12"),
			h.Attribute("x", String(x)),
			h.Attribute("y", "3"),
			h.Attribute("fill", "currentColor"),
			h.Attribute("rx", "1.75"),
		])
	return {
		play: (className: string) =>
			svg(className, [
				path(
					"m13.473 10.476-6.845 4.256a1.697 1.697 0 0 1-2.364-.547 1.77 1.77 0 0 1-.264-.93v-8.51C4 3.78 4.768 3 5.714 3c.324 0 .64.093.914.268l6.845 4.255a1.763 1.763 0 0 1 0 2.953",
				),
			]),
		pause: (className: string) => svg(className, [rect(3), rect(11)]),
		restart: (className: string) =>
			svg(className, [
				path(
					"M9 17a8 8 0 0 1-8-8h1.5a6.5 6.5 0 1 0 1.43-4.07l1.643 1.643A.25.25 0 0 1 5.396 7H1.25A.25.25 0 0 1 1 6.75V2.604a.25.25 0 0 1 .427-.177l1.438 1.438A8 8 0 1 1 9 17",
				),
				path(
					"m11.61 9.639-3.331 2.07a.826.826 0 0 1-1.15-.266.86.86 0 0 1-.129-.452V6.849C7 6.38 7.374 6 7.834 6c.158 0 .312.045.445.13l3.331 2.071a.858.858 0 0 1 0 1.438",
				),
			]),
		volumeHigh: (className: string) =>
			svg(className, [
				path(
					"M15.6 3.3c-.4-.4-1-.4-1.4 0s-.4 1 0 1.4C15.4 5.9 16 7.4 16 9s-.6 3.1-1.8 4.3c-.4.4-.4 1 0 1.4.2.2.5.3.7.3.3 0 .5-.1.7-.3C17.1 13.2 18 11.2 18 9s-.9-4.2-2.4-5.7",
				),
				path(VOLUME_BASE),
			]),
		volumeLow: (className: string) => svg(className, [path(VOLUME_BASE)]),
		volumeOff: (className: string) =>
			svg(className, [
				path(
					"M.714 6.008h3.072l4.071-3.857c.5-.376 1.143 0 1.143.601V15.28c0 .602-.643.903-1.143.602l-4.071-3.858H.714c-.428 0-.714-.3-.714-.752V6.76c0-.451.286-.752.714-.752M14.5 7.586l-1.768-1.768a1 1 0 1 0-1.414 1.414L13.085 9l-1.767 1.768a1 1 0 0 0 1.414 1.414l1.768-1.768 1.768 1.768a1 1 0 0 0 1.414-1.414L15.914 9l1.768-1.768a1 1 0 0 0-1.414-1.414z",
				),
			]),
		fullscreenEnter: (className: string) =>
			svg(className, [
				path(
					"M15.25 2a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V3.5h-3.75a.75.75 0 0 1-.743-.648L10 2.75a.75.75 0 0 1 .75-.75z",
				),
				path(
					"M14.72 2.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06zM2.75 10a.75.75 0 0 1 .75.75v3.75h3.75a.75.75 0 0 1 .743.648L8 15.25a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 .75-.75",
				),
				path(FULLSCREEN_LAST),
			]),
		fullscreenExit: (className: string) =>
			svg(className, [
				path(
					"M10.75 2a.75.75 0 0 1 .75.75V6.5h3.75a.75.75 0 0 1 .743.648L16 7.25a.75.75 0 0 1-.75.75h-4.5a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 .75-.75",
				),
				path(
					"M14.72 2.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 1 1-1.06-1.06zM7.25 10a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V11.5H2.75a.75.75 0 0 1-.743-.648L2 10.75a.75.75 0 0 1 .75-.75z",
				),
				path(FULLSCREEN_LAST),
			]),
		spinner: (className: string) =>
			svg(
				className,
				SPINNER.map(([width, height, x, y, opacity, transform], index) =>
					h.rect(
						[
							h.Attribute("width", String(width)),
							h.Attribute("height", String(height)),
							h.Attribute("x", String(x)),
							h.Attribute("y", String(y)),
							h.Attribute("opacity", String(opacity)),
							h.Attribute("rx", "1"),
							...(transform === undefined ? [] : [h.Attribute("transform", transform)]),
						],
						[
							h.animate([
								h.Attribute("attributeName", "opacity"),
								h.Attribute("begin", `${index * 0.125}s`),
								h.Attribute("calcMode", "linear"),
								h.Attribute("dur", "1s"),
								h.Attribute("repeatCount", "indefinite"),
								h.Attribute("values", "1;0"),
							]),
						],
					),
				),
				"currentColor",
			),
	}
}
