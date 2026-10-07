import type { Html, HtmlBuilder } from "foldkit/html"
import { Logo } from "../../icons"

/** The pixel-art left panel shared by onboarding and `/join/$slug` (desktop only). */

/** `getOnboardingImage`: season by month, day from 6AM to 6PM, in local time. */
export const onboardingImageAt = (nowMs: number): string => {
	const now = new Date(nowMs)
	const month = now.getMonth()
	const hour = now.getHours()
	const season =
		month >= 2 && month <= 4
			? "spring"
			: month >= 5 && month <= 7
				? "summer"
				: month >= 8 && month <= 10
					? "autumn"
					: "winter"
	const timeOfDay = hour >= 6 && hour < 18 ? "day" : "night"
	return `/images/onboarding/${season}-${timeOfDay}.webp`
}

export const backgroundImage = <Message>(h: HtmlBuilder<Message>, nowMs: number, alt: string): Html =>
	h.img([
		h.Attribute("src", onboardingImageAt(nowMs)),
		h.Attribute("alt", alt),
		h.Class("absolute inset-0 size-full object-cover object-top-left"),
		h.Attribute("style", "image-rendering: pixelated;"),
	])

/** Logo plus wordmark; `textClassName` is the mobile header's `text-fg`. */
export const logoContent = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly logoClassName: string; readonly textClassName?: string },
): ReadonlyArray<Html> => [
	Logo(h, { className: options.logoClassName }),
	h.strong(
		[h.Class(options.textClassName ? `font-semibold ${options.textClassName}` : "font-semibold")],
		["Hazel"],
	),
]

export const panelCard = <Message>(h: HtmlBuilder<Message>, children: Array<Html>): Html =>
	h.div(
		[h.Class("relative z-20 mt-auto rounded-xl bg-black/60 p-6 ring ring-white/10 backdrop-blur-sm")],
		children,
	)

export const panelFrame = <Message>(h: HtmlBuilder<Message>, children: Array<Html>): Html =>
	h.div([h.Class("relative hidden h-full flex-col p-10 text-white lg:flex")], children)
