// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What a step of the onboarding flow is to the shell (`pages/onboarding/OnboardingPage.ts`): a view
 * drawn inside the step's frame, given the flow and two messages, Continue and Back. A step with state
 * of its own is a component whose `OnboardingStepEvents` map to those two (`ProfileStep`).
 */
import { UiSchema, type View } from "@effect/ui"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import type { Session } from "../../app/session"
import type { Flow, OnboardingData, Step } from "../domain/OnboardingFlow"

/** The answers a step adds to `OnboardingData` as it continues (none: it collects nothing). */
export const DataPatch = Schema.Struct({
	timezone: Schema.optionalKey(Schema.NullOr(Schema.String)),
	useCases: Schema.optionalKey(Schema.Array(Schema.String)),
	role: Schema.optionalKey(Schema.NullOr(Schema.String)),
})
export type DataPatch = typeof DataPatch.Type

/** What a step component tells the shell. */
export const OnboardingStepEvents = UiSchema.TaggedEnum({
	/** Done with this step: the shell records `patch` and moves to the next. */
	Continued: { patch: DataPatch },
	RequestedBack: {},
})
export type OnboardingStepEvents = typeof OnboardingStepEvents.Type

export interface StepInput<Msg> {
	readonly flow: Flow
	readonly data: OnboardingData
	readonly session: Session
	/** The shell's message for Continue, with the step's answers. */
	readonly continued: (patch: DataPatch) => Msg
	readonly back: Msg
}

/** One step: what it draws inside the shell's frame. */
export type StepView = <Msg>(h: Hazel.H<Msg>, input: StepInput<Msg>) => View.Content<Msg, any>

/** The steps the shell draws itself, by flow position (`registry.ts`). */
export type StepRegistry = { readonly [S in Step]?: StepView }
