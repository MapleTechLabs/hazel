import { Effect, Schema } from "effect"
import { Mount } from "foldkit"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"

/**
 * The `motion` enter transitions of the entry screens, run with the Web Animations API on mount.
 * Elements carry motion's end-state inline style, so the settled frame matches legacy exactly.
 */

export const MOTION_END_STYLE = "opacity: 1; filter: blur(0px); transform: none;"

export const Preset = Schema.Literals([
	"Card",
	"StepForward",
	"StepBackward",
	"NumberForward",
	"NumberBackward",
])
export type Preset = typeof Preset.Type

export const MotionMessage = defineMessageUnion({ CompletedEnterAnimation: {} })
export type MotionMessage = typeof MotionMessage.Type

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
}

const EnterAnimation = Mount.define("EnterAnimation", {
	args: { preset: Preset },
	messages: [MotionMessage.CompletedEnterAnimation],
	execute: ({ element, preset }) =>
		Effect.sync(() => {
			const { from, duration, easing } = presets[preset]
			element.animate(
				[
					{ opacity: from.opacity, filter: `blur(${from.blur}px)`, transform: from.transform },
					{ opacity: 1, filter: "blur(0px)", transform: "none" },
				],
				{ duration, easing },
			)
			return MotionMessage.CompletedEnterAnimation()
		}),
})

/** The end-state style plus the enter animation, for an element that appears with `preset`. */
export const enterAnimation = <Message>(
	h: HtmlBuilder<Message>,
	preset: Preset,
	toMessage: (message: MotionMessage) => Message,
): ReadonlyArray<Attribute<Message>> => [
	h.Attribute("style", MOTION_END_STYLE),
	h.OnMount(Mount.mapMessage(EnterAnimation({ preset }), toMessage)),
]
