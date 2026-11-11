import type { Html, HtmlBuilder } from "foldkit/html"
import {
	IconChartBar,
	IconCircleDottedUser,
	IconCode,
	IconCube,
	IconLightbulb,
	IconMegaphone,
	IconOffice,
	IconPaintbrush,
	IconPresentationChart,
	IconRocket,
	IconUser,
	IconUsers,
	IconUsersPlus,
} from "../../../icons"
import * as ChoiceBox from "../../../ui/choice-box"
import { Message } from "../message"
import { onboardingNavigation, stepHeader } from "../navigation"

/** `use-case-step.tsx` and `role-step.tsx`: a two-column single-select ChoiceBox. */

type IconView = (h: HtmlBuilder<Message>) => Html

interface Choice {
	readonly id: string
	readonly label: string
	readonly description: string
	readonly icon: IconView
}

const TEAM_SIZES: ReadonlyArray<Choice> = [
	{
		id: "solo",
		label: "Just me",
		description: "Solo user or personal workspace",
		icon: IconCircleDottedUser,
	},
	{ id: "small", label: "2-10 people", description: "Small team or startup", icon: IconUsers },
	{ id: "medium", label: "11-50 people", description: "Growing team", icon: IconUsersPlus },
	{ id: "large", label: "51-200 people", description: "Medium-sized company", icon: IconOffice },
	{ id: "xlarge", label: "201-1000 people", description: "Large organization", icon: IconOffice },
	{ id: "enterprise", label: "1000+ people", description: "Enterprise", icon: IconOffice },
]

const ROLES: ReadonlyArray<Choice> = [
	{
		id: "developer",
		label: "Developer / Engineer",
		description: "Write code and build features",
		icon: IconCode,
	},
	{
		id: "designer",
		label: "Designer",
		description: "Create interfaces and experiences",
		icon: IconPaintbrush,
	},
	{ id: "pm", label: "Product Manager", description: "Define roadmap and requirements", icon: IconCube },
	{
		id: "marketing",
		label: "Marketing",
		description: "Growth, campaigns, and content",
		icon: IconMegaphone,
	},
	{
		id: "sales",
		label: "Sales / Business Development",
		description: "Revenue and customer relationships",
		icon: IconPresentationChart,
	},
	{
		id: "data",
		label: "Data / Analytics",
		description: "Insights, metrics, and analysis",
		icon: IconChartBar,
	},
	{
		id: "leadership",
		label: "Leadership / Executive",
		description: "Strategy and decision making",
		icon: IconRocket,
	},
	{
		id: "founder",
		label: "Founder / Entrepreneur",
		description: "Building and growing a business",
		icon: IconLightbulb,
	},
	{ id: "other", label: "Other", description: "A different role or multiple roles", icon: IconUser },
]

const toChoiceBoxMessage = (message: ChoiceBox.Message) => Message.GotChoiceBoxMessage({ message })

const choiceStep = (
	h: HtmlBuilder<Message>,
	box: ChoiceBox.Model,
	options: {
		readonly testId: string
		readonly title: string
		readonly description: string
		readonly ariaLabel: string
		readonly choices: ReadonlyArray<Choice>
	},
): Html =>
	h.div(
		[h.Class("space-y-4 sm:space-y-6"), h.DataAttribute("testid", options.testId)],
		[
			stepHeader(h, { title: options.title, description: options.description }),
			h.div(
				[],
				ChoiceBox.choiceBox(
					h,
					{
						model: box,
						toParentMessage: toChoiceBoxMessage,
						ariaLabel: options.ariaLabel,
						columns: 2,
						gap: 4,
					},
					options.choices.map((choice) => ({
						key: choice.id,
						textValue: choice.label,
						content: (parts) => [
							choice.icon(h),
							parts.label([choice.label]),
							parts.description([choice.description]),
						],
					})),
				),
			),
			onboardingNavigation(h, {
				onContinue: Message.ClickedContinueChoice(),
				canContinue: box.selectedKeys.length > 0,
			}),
		],
	)

export const useCaseStep = (h: HtmlBuilder<Message>, box: ChoiceBox.Model): Html =>
	choiceStep(h, box, {
		testId: "onboarding-step-team-size",
		title: "How big is your team?",
		description: "This helps us optimize Hazel for your team size.",
		ariaLabel: "Team size",
		choices: TEAM_SIZES,
	})

export const roleStep = (h: HtmlBuilder<Message>, box: ChoiceBox.Model): Html =>
	choiceStep(h, box, {
		testId: "onboarding-step-role",
		title: "What's your role?",
		description: "Help us tailor Hazel to your needs by selecting your primary role.",
		ariaLabel: "Role",
		choices: ROLES,
	})
