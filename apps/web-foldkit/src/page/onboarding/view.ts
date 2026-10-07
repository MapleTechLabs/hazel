import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { appLoader } from "../../shell/layouts"
import { link } from "../../ui/link"
import { loader } from "../../ui/loader"
import type { PageViewInputs, Shared } from "../contract"
import { backgroundImage, logoContent, panelCard, panelFrame } from "./brand-panel"
import { stepNumber, totalSteps } from "./flow"
import { Message, toInteractionMessage } from "./message"
import type { Model } from "./model"
import { enterAnimation } from "./enter-animation"
import { MOTION_END_STYLE } from "./motion"
import { roleStep, useCaseStep } from "./steps/choice"
import { inviteStep } from "./steps/invite"
import { profileStep } from "./steps/profile"
import { themeStep } from "./steps/theme"
import { welcomeStep } from "./steps/welcome"
import { timezoneStep } from "./timezone/view"

/** `routes/_app/onboarding/index.tsx` inside `onboarding-layout.tsx`. */

const stepCounter = (h: HtmlBuilder<Message>, model: Model): Array<Html | string> => [
	"Step",
	" ",
	h.span(
		[
			h.Key(`step-number-${stepNumber(model.step, model.userType)}`),
			h.Class("inline-block font-mono"),
			...enterAnimation(h, model.direction === "forward" ? "NumberForward" : "NumberBackward"),
		],
		[String(stepNumber(model.step, model.userType))],
	),
	" ",
	"of ",
	String(totalSteps(model.userType)),
]

const leftPanel = (h: HtmlBuilder<Message>, model: Model, nowMs: number): Html =>
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
					h.div([h.Class("font-mono text-sm text-white/80")], stepCounter(h, model)),
				],
			),
		]),
	])

const finalizationView = (h: HtmlBuilder<Message>, error: string | null): Html =>
	h.div(
		[h.Class("flex flex-col items-center justify-center space-y-4 py-12 text-center")],
		[
			loader(h, { className: "size-12" }),
			h.p([h.Class("font-medium text-lg")], ["Setting up your workspace..."]),
			h.p([h.Class("text-muted-fg text-sm")], ["This will just take a moment"]),
			...(error ? [h.p([h.Class("text-danger text-sm")], [error])] : []),
		],
	)

const stepBody = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html | null => {
	const { form } = model
	if (model.step === "welcome")
		return welcomeStep(h, {
			isCreatingOrg: model.userType === "creator",
			organizationName: model.membership?.name,
		})
	if (model.step === "finalization") return finalizationView(h, model.error)
	const interaction = { model: model.interaction, toParentMessage: toInteractionMessage }
	if (form._tag === "Profile") return profileStep(h, form, interaction)
	if (form._tag === "Timezone")
		return timezoneStep(h, form, { browserTimezone: model.browserTimezone, nowMs: shared.nowMs })
	if (form._tag === "Theme") return themeStep(h, form)
	if (form._tag === "Choice")
		return model.step === "useCases" ? useCaseStep(h, form.box) : roleStep(h, form.box)
	if (form._tag === "Invite") return inviteStep(h, form, interaction)
	return null
}

/** The motion.div around each step, keyed by step so a new step enters with its transition. */
const animatedStep = (h: HtmlBuilder<Message>, model: Model, body: Html): Html =>
	h.div(
		[
			h.Key(`step-${model.step}`),
			...(model.animatesStep
				? enterAnimation(h, model.direction === "forward" ? "StepForward" : "StepBackward")
				: [h.Attribute("style", MOTION_END_STYLE)]),
		],
		[body],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	// `AppShell` waits for `user.me`; onboarding also waits for its flow to be known.
	if (!model.isInitialized || shared.currentUser === null) return appLoader(h)
	const body = stepBody(h, model, shared)
	return h.main(
		[
			h.Class(
				"relative grid h-dvh grid-cols-1 flex-col items-center justify-center overflow-y-auto lg:max-w-none lg:grid-cols-2 lg:overflow-hidden",
			),
		],
		[
			leftPanel(h, model, shared.nowMs),
			h.div(
				[
					h.Class(
						"flex min-h-dvh flex-col overflow-y-auto p-3 pt-6 sm:p-4 md:p-12 lg:h-full lg:min-h-0",
					),
				],
				[
					h.div(
						[h.Class("m-auto w-full max-w-2xl space-y-4 py-4 sm:space-y-6 sm:py-6")],
						body === null ? [] : [animatedStep(h, model, body)],
					),
				],
			),
		],
	)
})
