import { Effect } from "effect"
import { Mount } from "foldkit"
import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { cardDescription, cardTitle } from "../../ui/card"
import { button } from "../../ui/button"
import { Message } from "./message"

/** `onboarding-navigation.tsx` plus the header and autofocus every step shares. */

export interface NavigationOptions {
	readonly onContinue: Message
	readonly canContinue?: boolean
	readonly isLoading?: boolean
	readonly continueLabel?: string
	readonly showBack?: boolean
}

export const onboardingNavigation = (h: HtmlBuilder<Message>, options: NavigationOptions): Html => {
	const isLoading = options.isLoading ?? false
	return h.div(
		[h.Class("sticky bottom-0 flex flex-wrap justify-between gap-2 pt-4 pb-2")],
		[
			options.showBack === false
				? h.div([])
				: button(
						h,
						{
							intent: "secondary",
							isDisabled: isLoading,
							onPress: Message.ClickedBack(),
							attributes: [h.DataAttribute("testid", "onboarding-back-btn")],
						},
						["← Back"],
					),
			button(
				h,
				{
					isDisabled: !(options.canContinue ?? true) || isLoading,
					isPending: isLoading,
					className: "group",
					onPress: options.onContinue,
					attributes: [h.DataAttribute("testid", "onboarding-continue-btn")],
				},
				[
					`${options.continueLabel ?? "Continue"} `,
					h.span([h.Class("duration-300 group-hover:translate-x-1")], ["→"]),
				],
			),
		],
	)
}

/** CardTitle and CardDescription in the `flex flex-col space-y-1.5` header. */
export const stepHeader = (
	h: HtmlBuilder<Message>,
	options: { readonly title: string; readonly description: string; readonly isCentered?: boolean },
	classes: { readonly title?: string; readonly description?: string } = {},
): Html =>
	h.div(
		[h.Class(options.isCentered ? "flex flex-col space-y-1.5 text-center" : "flex flex-col space-y-1.5")],
		[
			cardTitle(h, { className: classes.title }, [options.title]),
			cardDescription(h, { className: classes.description }, [options.description]),
		],
	)

export const AutoFocus = Mount.define("AutoFocusOnboardingInput", {
	messages: [Message.CompletedAutoFocus],
	execute: ({ element }) =>
		Effect.sync(() => {
			if (element instanceof HTMLElement) element.focus()
			return Message.CompletedAutoFocus()
		}),
})

/** React's `autoFocus`. */
export const autoFocus = (h: HtmlBuilder<Message>): Attribute<Message> => h.OnMount(AutoFocus())
