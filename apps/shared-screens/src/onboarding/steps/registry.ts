/**
 * The steps the shell draws itself, by flow position. Adding a step is one entry here; a step with
 * no entry is drawn by the host through the shell's `legacyStep` slot (today's Foldkit views, until
 * lane PA4 brings them here).
 */
import type { StepRegistry } from "./OnboardingStep"
import { ProfileStep } from "./ProfileStep"
import { WelcomeStep } from "./WelcomeStep"

export const onboardingSteps: StepRegistry = {
	welcome: WelcomeStep,
	profileInfo: ProfileStep,
}
