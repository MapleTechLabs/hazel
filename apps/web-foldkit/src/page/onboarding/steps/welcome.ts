import type { Html, HtmlBuilder } from "foldkit/html"
import { Message } from "../message"
import { onboardingNavigation, stepHeader } from "../navigation"

/** `welcome-step.tsx` */

const CREATOR_ITEMS = [
	"Set up your profile",
	"Choose your theme",
	"Set up your organization workspace",
	"Tell us about your use case",
	"Share your role",
	"Invite your team (optional)",
]
const INVITED_ITEMS = [
	"Set up your profile",
	"Choose your theme",
	"Tell us about your use case",
	"Share your role",
]

export const welcomeStep = (
	h: HtmlBuilder<Message>,
	options: { readonly isCreatingOrg: boolean; readonly organizationName: string | undefined },
): Html =>
	h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", "onboarding-step-welcome")],
		[
			stepHeader(
				h,
				{
					title: options.isCreatingOrg
						? "Welcome to Hazel!"
						: `Welcome to ${options.organizationName}!`,
					description: options.isCreatingOrg
						? "Let's set up your workspace in just a few quick steps. This will only take a minute."
						: "Let's get you set up with your workspace. We just need a few details to personalize your experience.",
					isCentered: true,
				},
				{ title: "text-2xl sm:text-3xl", description: "text-base" },
			),
			h.div(
				[h.Class("space-y-3 rounded-lg border border-border bg-muted/30 p-4 sm:space-y-4 sm:p-6")],
				[
					h.h3([h.Class("font-medium text-fg")], ["What's next:"]),
					h.ul(
						[h.Class("space-y-2 text-muted-fg text-sm sm:space-y-3")],
						(options.isCreatingOrg ? CREATOR_ITEMS : INVITED_ITEMS).map((item) =>
							h.li(
								[h.Class("flex items-start gap-2")],
								[h.span([h.Class("text-primary")], ["✓"]), h.span([], [item])],
							),
						),
					),
				],
			),
			onboardingNavigation(h, {
				onContinue: Message.ClickedGetStarted(),
				showBack: false,
				continueLabel: "Get Started",
			}),
		],
	)
