/**
 * The welcome step (today's `steps/welcome.ts`): who the workspace is for, what the next steps ask,
 * and "Get started".
 */
import type { Hazel } from "@hazel/ui/vocabulary/index"
import { StepHeader, StepNavigation } from "../components/StepLayout"
import type { StepInput } from "./OnboardingStep"

/** One line per step of the flow (`OnboardingFlow.ts`), in its order. */
const CREATOR_ITEMS = [
	"Set up your profile",
	"Pick your time zone",
	"Choose your theme",
	"Tell us your team size",
	"Share your role",
	"Bring channels from Slack or Discord (optional)",
	"Invite your team (optional)",
]
const INVITED_ITEMS = ["Set up your profile", "Pick your time zone", "Choose your theme", "Share your role"]

const checkLine = <Msg>(h: Hazel.H<Msg>, item: string) =>
	h.stack
		.key(item)
		.axis("horizontal")
		.density("compact")
		.align("start")
		.children(
			h.text.role("label").tone("accent").children("✓"),
			h.text.role("label").tone("muted").children(item),
		)

export const WelcomeStep = <Msg>(h: Hazel.H<Msg>, { flow, continued }: StepInput<Msg>) => {
	const isCreator = flow.userType === "creator"
	return h.stack.density("relaxed").children(
		StepHeader(h, {
			title: isCreator ? "Welcome to Hazel!" : `Welcome to ${flow.membership?.name ?? "Hazel"}!`,
			description: isCreator
				? "Let's set up your workspace in just a few quick steps. This will only take a minute."
				: "Let's get you set up with your workspace. We just need a few details to personalize your experience.",
			isWelcome: true,
		}),
		h.frame.children(
			h.stack.children(
				h.heading.level("2").children("What's next:"),
				h.stack
					.density("compact")
					.children(
						...(isCreator ? CREATOR_ITEMS : INVITED_ITEMS).map((item) => checkLine(h, item)),
					),
			),
		),
		StepNavigation(h, { onContinue: continued({}), onBack: null, continueLabel: "Get started" }),
	)
}
