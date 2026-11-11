import { Schema } from "effect"

/**
 * The `motion` enter transitions of the entry screens, for a Mount to run with the Web Animations
 * API. Elements carry motion's end-state inline style, so the settled frame matches legacy exactly.
 */

export const MOTION_END_STYLE = "opacity: 1; filter: blur(0px); transform: none;"

export const Preset = Schema.Literals([
	"Card",
	"StepForward",
	"StepBackward",
	"NumberForward",
	"NumberBackward",
	"Pop",
])
export type Preset = typeof Preset.Type

type From = { readonly opacity: number; readonly blur: number; readonly transform: string }

const presets: Readonly<Record<Preset, { from: From; duration: number; easing: string }>> = {
	// join `cardVariants`
	Card: { from: { opacity: 0, blur: 8, transform: "translateY(20px)" }, duration: 400, easing: "ease-out" },
	// onboarding step `variants`
	StepForward: {
		from: { opacity: 0, blur: 4, transform: "translateX(20px)" },
		duration: 300,
		easing: "ease-in-out",
	},
	StepBackward: {
		from: { opacity: 0, blur: 4, transform: "translateX(-20px)" },
		duration: 300,
		easing: "ease-in-out",
	},
	// OnboardingLayout `stepVariants`
	NumberForward: {
		from: { opacity: 0.1, blur: 4, transform: "translateY(10px)" },
		duration: 200,
		easing: "ease",
	},
	NumberBackward: {
		from: { opacity: 0.1, blur: 4, transform: "translateY(-10px)" },
		duration: 200,
		easing: "ease",
	},
	// city card badges: `initial={{ scale: 0 }}`, motion's default spring approximated
	Pop: { from: { opacity: 1, blur: 0, transform: "scale(0)" }, duration: 300, easing: "ease-out" },
}

/** Motion writes only the properties it animated. */
export const endStyleOf = (preset: Preset) => (preset === "Pop" ? "transform: none;" : MOTION_END_STYLE)

export const animateEnter = (element: Element, preset: Preset): void => {
	const { from, duration, easing } = presets[preset]
	element.animate(
		preset === "Pop"
			? [{ transform: from.transform }, { transform: "none" }]
			: [
					{ opacity: from.opacity, filter: `blur(${from.blur}px)`, transform: from.transform },
					{ opacity: 1, filter: "blur(0px)", transform: "none" },
				],
		{ duration, easing },
	)
}
