import { Effect } from "effect"
import { Mount } from "foldkit"
import type { Attribute, HtmlBuilder } from "foldkit/html"
import { Message } from "./message"
import { animateEnter, endStyleOf, Preset } from "./motion"

export const EnterAnimation = Mount.define("OnboardingEnterAnimation", {
	args: { preset: Preset },
	messages: [Message.CompletedEnterAnimation],
	execute: ({ element, preset }) =>
		Effect.sync(() => {
			animateEnter(element, preset)
			return Message.CompletedEnterAnimation()
		}),
})

/** Motion's end-state style plus the enter animation for an element that appears with `preset`. */
export const enterAnimation = (
	h: HtmlBuilder<Message>,
	preset: Preset,
): ReadonlyArray<Attribute<Message>> => [
	h.Attribute("style", endStyleOf(preset)),
	h.OnMount(EnterAnimation({ preset })),
]
