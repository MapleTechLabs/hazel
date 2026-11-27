/**
 * What every onboarding step draws (today's `onboarding/navigation.ts`): its heading and line under
 * it, and the Back and Continue row at its end.
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"

export interface HeaderOptions {
	readonly title: string
	readonly description: string
	/** The welcome step's centred, larger heading. */
	readonly isWelcome?: boolean
}

/**
 * The step's heading over its description.
 * HAZEL-GAP(p4-onboarding-step-header): today's welcome heading is `text-2xl sm:text-3xl` over a
 * `text-base` line, the other steps' a section heading over `text-sm`; level `1` and the body line are nearest.
 */
export const StepHeader = <Msg>(h: Hazel.H<Msg>, options: HeaderOptions) =>
	h.stack
		.density("compact")
		.align(options.isWelcome === true ? "center" : "stretch")
		.children(
			h.heading.level(options.isWelcome === true ? "1" : "2").children(options.title),
			h.text
				.role(options.isWelcome === true ? "body" : "label")
				.tone("muted")
				.children(options.description),
		)

export interface NavigationOptions<Msg> {
	readonly onContinue: Msg
	/** `null` leaves Back out (the first step). */
	readonly onBack: Msg | null
	readonly continueLabel?: string
	readonly canContinue?: boolean
	readonly isLoading?: boolean
}

/** Back at the start, Continue at the end; both wait while the step's request runs. */
export const StepNavigation = <Msg>(h: Hazel.H<Msg>, options: NavigationOptions<Msg>) => {
	const isLoading = options.isLoading ?? false
	return h.stack
		.axis("horizontal")
		.align("center")
		.children(
			options.onBack === null
				? null
				: h.button
						.label("← Back")
						.variant("secondary")
						.disabled(isLoading)
						.on("press", options.onBack),
			h.spacer,
			h.button
				.label(`${options.continueLabel ?? "Continue"} →`)
				.loading(isLoading)
				.disabled(!(options.canContinue ?? true) || isLoading)
				.on("press", options.onContinue),
		)
}
