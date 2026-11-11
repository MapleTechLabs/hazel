import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { appLoader } from "../../shell/layouts"
import { link } from "../../ui/link"
import { failureMessage } from "~/lib/error-messages"
import { button } from "../../ui/button"
import { loader } from "../../ui/loader"
import type { PageViewInputs, Shared } from "../contract"
import { backgroundImage, logoContent, panelCard, panelFrame } from "./brand-panel"
import { stepNumber, totalSteps } from "./flow"
import { Message, toInteractionMessage } from "./message"
import { type Model, Phase, type Running, type StepOf, StepState, stepOf } from "./model"
import { enterAnimation } from "./enter-animation"
import { MOTION_END_STYLE } from "./motion"
import { roleStep, useCaseStep } from "./steps/choice"
import { inviteStep } from "./steps/invite"
import { profileStep } from "./steps/profile"
import { themeStep } from "./steps/theme"
import { welcomeStep } from "./steps/welcome"
import { timezoneStep } from "./timezone/view"

/** `routes/_app/onboarding/index.tsx` inside `onboarding-layout.tsx`. */

const stepCounter = (h: HtmlBuilder<Message>, running: Running): Array<Html | string> => {
	const number = stepNumber(stepOf(running.step), running.flow.userType)
	return [
		"Step",
		" ",
		h.span(
			[
				h.Key(`step-number-${number}`),
				h.Class("inline-block font-mono"),
				...enterAnimation(h, running.direction === "forward" ? "NumberForward" : "NumberBackward"),
			],
			[String(number)],
		),
		" ",
		"of ",
		String(totalSteps(running.flow.userType)),
	]
}

const leftPanel = (h: HtmlBuilder<Message>, running: Running, nowMs: number): Html =>
	panelFrame(h, [
		backgroundImage(h, nowMs, "Onboarding background"),
		link(
			h,
			{
				href: "/",
				className: "relative z-20 flex items-center gap-2",
				attributes: [h.AriaLabel("Go to homepage")],
			},
			[...logoContent(h, { logoClassName: "size-8 text-white" })],
		),
		panelCard(h, [
			h.blockquote(
				[h.Class("space-y-2")],
				[
					h.p(
						[h.Class("text-lg text-white")],
						["Welcome to your new workspace. Let's get you set up in just a few steps."],
					),
					h.div([h.Class("font-mono text-sm text-white/80")], stepCounter(h, running)),
				],
			),
		]),
	])

/** Setting up, or (after a failed finalize) why it stopped and a way to try again. No spinner while failed. */
const finalizationView = (h: HtmlBuilder<Message>, step: StepOf<"Finalizing">): Html =>
	Option.match(step.failure, {
		onNone: () =>
			h.div(
				[h.Class("flex flex-col items-center justify-center space-y-4 py-12 text-center")],
				[
					loader(h, { className: "size-12" }),
					h.p([h.Class("font-medium text-lg")], ["Setting up your workspace..."]),
					h.p([h.Class("text-muted-fg text-sm")], ["This will just take a moment"]),
				],
			),
		onSome: (reason) => {
			const message = failureMessage(reason, {})
			return h.div(
				[h.Class("flex flex-col items-center justify-center space-y-4 py-12 text-center")],
				[
					h.p([h.Class("font-medium text-lg")], ["Couldn't finish setting up your workspace"]),
					h.p(
						[h.Class("text-danger text-sm"), h.Role("alert")],
						[
							message.description === undefined
								? message.title
								: `${message.title}. ${message.description}`,
						],
					),
					button(h, { intent: "primary", onPress: Message.ClickedRetryFinalize() }, ["Try again"]),
				],
			)
		},
	})

const stepBody = (h: HtmlBuilder<Message>, model: Model, running: Running, shared: Shared): Html => {
	const interaction = { model: model.interaction, toParentMessage: toInteractionMessage }
	return StepState.match(running.step, {
		Welcome: () =>
			welcomeStep(h, {
				isCreatingOrg: running.flow.userType === "creator",
				organizationName: running.flow.membership?.name,
			}),
		Profile: (form) => profileStep(h, form, interaction),
		Timezone: (form) =>
			timezoneStep(h, form, {
				browserTimezone: running.flow.browserTimezone || "UTC",
				nowMs: shared.nowMs,
			}),
		Theme: () => themeStep(h, shared.theme),
		UseCases: ({ box }) => useCaseStep(h, box),
		Role: ({ box }) => roleStep(h, box),
		Invite: (form) => inviteStep(h, form, interaction),
		Finalizing: (step) => finalizationView(h, step),
		Completed: () => finalizationView(h, StepState.Finalizing({ failure: Option.none() })),
	})
}

/** The motion.div around each step, keyed by step so a new step enters with its transition. */
const animatedStep = (h: HtmlBuilder<Message>, running: Running, body: Html): Html =>
	h.div(
		[
			h.Key(`step-${stepOf(running.step)}`),
			...(running.animatesStep
				? enterAnimation(h, running.direction === "forward" ? "StepForward" : "StepBackward")
				: [h.Attribute("style", MOTION_END_STYLE)]),
		],
		[body],
	)

const running = (h: HtmlBuilder<Message>, model: Model, running: Running, shared: Shared): Html =>
	h.main(
		[
			h.Class(
				"relative grid h-dvh grid-cols-1 flex-col items-center justify-center overflow-y-auto lg:max-w-none lg:grid-cols-2 lg:overflow-hidden",
			),
		],
		[
			leftPanel(h, running, shared.nowMs),
			h.div(
				[
					h.Class(
						"flex min-h-dvh flex-col overflow-y-auto p-3 pt-6 sm:p-4 md:p-12 lg:h-full lg:min-h-0",
					),
				],
				[
					h.div(
						[h.Class("m-auto w-full max-w-2xl space-y-4 py-4 sm:space-y-6 sm:py-6")],
						[animatedStep(h, running, stepBody(h, model, running, shared))],
					),
				],
			),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	// `AppShell` waits for `user.me`; onboarding also waits for its flow to be known.
	shared.currentUser === null
		? appLoader(h)
		: Phase.match(model.phase, {
				Starting: () => appLoader(h),
				Leaving: () => appLoader(h),
				Running: (phase) => running(h, model, phase, shared),
			}),
)
