import { Effect, Schema } from "effect"
import { Mount } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconMoon, IconSun } from "../../../icons"
import { Message } from "../message"

/**
 * `globe-visual.tsx`. Inline styles are motion's settled values (it writes colours as rounded rgb());
 * the grid lines draw in and the stars twinkle through the Web Animations API.
 */

const rgb = (hue: number, saturation: number, lightness: number, alpha?: number) => {
	const s = saturation / 100
	const l = lightness / 100
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s
	const p = 2 * l - q
	const channel = (offset: number) => {
		const t = (((hue / 360 + offset) % 1) + 1) % 1
		const value =
			t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
		return Math.round(value * 255)
	}
	const [r, g, b] = [channel(1 / 3), channel(0), channel(-1 / 3)]
	return alpha === undefined ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const STARS = [
	{ x: 8, y: 18, delay: 0, size: 1.5 },
	{ x: 88, y: 12, delay: 0.2, size: 1 },
	{ x: 12, y: 72, delay: 0.4, size: 1.5 },
	{ x: 92, y: 78, delay: 0.1, size: 1 },
	{ x: 4, y: 42, delay: 0.3, size: 2 },
	{ x: 96, y: 48, delay: 0.5, size: 1 },
	{ x: 25, y: 8, delay: 0.15, size: 1 },
	{ x: 75, y: 85, delay: 0.35, size: 1.5 },
]

/** `pathLength` 0 → 1 over a second, after `delay` seconds. */
export const DrawGlobePath = Mount.define("DrawGlobePath", {
	args: { delay: Schema.Number },
	messages: [Message.StartedGlobeAnimation],
	execute: ({ element, delay }) =>
		Effect.sync(() => {
			element.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
				duration: 1000,
				delay: delay * 1000,
				fill: "backwards",
			})
			return Message.StartedGlobeAnimation()
		}),
})

/**
 * Twinkle at night; by day the stars fade out. Both repeat forever, as motion's `repeat: Infinity`,
 * from motion's first keyframe (the inline style), where the first render at hour 0 starts them.
 */
export const TwinkleStar = Mount.define("TwinkleStar", {
	args: { delay: Schema.Number, isVisible: Schema.Boolean },
	messages: [Message.StartedGlobeAnimation],
	execute: ({ element, delay, isVisible }) =>
		Effect.acquireRelease(
			Effect.sync(() => {
				const keyframes = isVisible
					? [
							{ opacity: 0.4, transform: "scale(0.8)" },
							{ opacity: 1, transform: "scale(1.3)" },
							{ opacity: 0.4, transform: "scale(0.8)" },
						]
					: [
							{ opacity: 0.4, transform: "scale(0.8)" },
							{ opacity: 0, transform: "scale(0)" },
						]
				return element.animate(keyframes, {
					duration: 2500,
					delay: delay * 1000,
					iterations: Number.POSITIVE_INFINITY,
					easing: "ease-in-out",
				})
			}),
			// The animation repeats forever, so it is cancelled when the star leaves the DOM.
			(animation) => Effect.sync(() => animation.cancel()),
		).pipe(Effect.as(Message.StartedGlobeAnimation())),
})

const gridLine = (h: HtmlBuilder<Message>, isDaytime: boolean, delay: number) => [
	h.Attribute("stroke", "currentColor"),
	h.Attribute("stroke-width", "0.3"),
	h.Attribute("fill", "none"),
	h.Class(isDaytime ? "text-fg/20" : "text-fg/10"),
	h.Attribute("pathLength", "1"),
	h.Attribute("stroke-dasharray", "1 1"),
	h.Attribute("stroke-dashoffset", "0"),
	h.OnMount(DrawGlobePath({ delay })),
]

export const globeVisual = (
	h: HtmlBuilder<Message>,
	options: { readonly nowMs: number; readonly activeOffset: number },
): Html => {
	const currentHour = new Date(options.nowMs).getUTCHours()
	const localHour = (currentHour + options.activeOffset + 24) % 24
	const isDaytime = localHour >= 6 && localHour < 18
	const position = isDaytime
		? ((localHour - 6) / 12) * 100
		: localHour >= 18
			? ((localHour - 18) / 12) * 100
			: ((localHour + 6) / 12) * 100
	const background = isDaytime
		? `linear-gradient(to right, ${rgb(210, 40, 85)} 0%, ${rgb(45, 100, 90)} ${position}%, ${rgb(200, 60, 80)} 100%)`
		: `linear-gradient(to right, ${rgb(230, 30, 15)} 0%, ${rgb(230, 40, 25)} ${position}%, ${rgb(230, 30, 12)} 100%)`
	const orbStyle = isDaytime
		? `background-color: ${rgb(45, 100, 55)}; box-shadow: ${rgb(45, 100, 55, 0.5)} 0px 0px 40px 15px;`
		: `background-color: ${rgb(230, 20, 80)}; box-shadow: ${rgb(230, 30, 80, 0.3)} 0px 0px 30px 10px;`
	const labelStyle = isDaytime
		? `background-color: ${rgb(45, 100, 60, 0.2)}; color: ${rgb(45, 80, 25)};`
		: `background-color: ${rgb(230, 50, 30, 0.6)}; color: ${rgb(230, 20, 90)};`
	return h.div(
		[h.Class("relative w-full max-w-md mx-auto aspect-[2/1] mb-6")],
		[
			h.div([
				h.Class("absolute inset-0 rounded-full overflow-hidden"),
				h.Attribute("style", `background: ${background};`),
			]),
			h.div(
				[h.Class("absolute inset-4 rounded-full border-2 border-border/50 overflow-hidden")],
				[
					h.svg(
						[h.Class("absolute inset-0 w-full h-full"), h.Attribute("viewBox", "0 0 100 50")],
						[
							...[12.5, 25, 37.5].map((y) =>
								h.path([
									h.Attribute("d", `M 0 ${y} Q 50 ${y - 5} 100 ${y}`),
									...gridLine(h, isDaytime, y / 50),
								]),
							),
							...[20, 40, 60, 80].map((x) =>
								h.ellipse([
									h.Attribute("cx", String(x)),
									h.Attribute("cy", "25"),
									h.Attribute("rx", String(3 + Math.abs(x - 50) / 10)),
									h.Attribute("ry", "20"),
									...gridLine(h, isDaytime, x / 100),
								]),
							),
						],
					),
					h.div(
						[
							h.Class("absolute top-1/2 -translate-y-1/2 w-10 h-10"),
							h.Attribute("style", `left: ${position}%; transform: translateX(-50%);`),
						],
						[
							h.div(
								[
									h.Class("w-full h-full rounded-full flex items-center justify-center"),
									h.Attribute("style", orbStyle),
								],
								[
									isDaytime
										? IconSun(h, { className: "size-5 text-amber-800" })
										: IconMoon(h, { className: "size-5 text-slate-600" }),
								],
							),
						],
					),
					h.div(
						[
							h.Class(
								"absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5",
							),
							h.Attribute("style", labelStyle),
						],
						[
							isDaytime
								? IconSun(h, { className: "size-3" })
								: IconMoon(h, { className: "size-3" }),
							isDaytime ? "Daytime" : "Nighttime",
							" • ",
							localHour.toString().padStart(2, "0"),
							":00",
						],
					),
				],
			),
			...STARS.map((star) =>
				h.div([
					// Keyed by position and day/night: the twinkle restarts when the sky changes.
					h.Key(`star-${star.x}-${star.y}-${isDaytime ? "day" : "night"}`),
					h.Class("absolute rounded-full bg-white"),
					h.Attribute(
						"style",
						`left: ${star.x}%; top: ${star.y}%; width: ${star.size * 2}px; height: ${star.size * 2}px; opacity: 0.4; transform: scale(0.8);`,
					),
					h.OnMount(TwinkleStar({ delay: star.delay, isVisible: !isDaytime })),
				]),
			),
		],
	)
}
