import { Option } from "effect"
import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { failureMessage } from "~/lib/error-messages"
import { button } from "../../ui/button"
import { emptyState } from "../../ui/empty-state"
import { loader } from "../../ui/loader"
import type { PageViewInputs, Shared } from "../contract"
import { Message, toInteractionMessage } from "./message"
import { type Model, Phase, type Running, type StepOf, StepState } from "./model"
import { roleStep, useCaseStep } from "./steps/choice"
import { importStep } from "./steps/import"
import { inviteStep } from "./steps/invite"
import { themeStep } from "./steps/theme"
import { timezoneStep } from "./timezone/view"

/**
 * The steps of `routes/_app/onboarding/index.tsx` the native shell does not draw yet: only the step,
 * which the root moves into the shell's `legacyStep` slot (`root/native-pages.ts`). The panel, the
 * counter and the welcome and profile steps are the shell's (`shared-screens/src/onboarding`).
 */

/** Setting up, or (after a failed finalize) why it stopped and a way to try again. No spinner while failed. */
const finalizationView = (h: HtmlBuilder<Message>, step: StepOf<"Finalizing">): Html =>
	Option.match(step.failure, {
		onNone: () =>
			emptyState(h, {
				icon: () => loader(h, { className: "size-12" }),
				title: "Setting up your workspace...",
				description: "This will just take a moment",
				className: "py-12",
			}),
		onSome: (reason) => {
			const message = failureMessage(reason, {})
			return emptyState(h, {
				title: "Couldn't finish setting up your workspace",
				className: "py-12",
				action: [
					h.p(
						[h.Class("mb-4 text-danger text-sm"), h.Role("alert")],
						[
							message.description === undefined
								? message.title
								: `${message.title}. ${message.description}`,
						],
					),
					button(h, { intent: "primary", onPress: Message.ClickedRetryFinalize() }, ["Try again"]),
				],
			})
		},
	})

const stepBody = (h: HtmlBuilder<Message>, model: Model, running: Running, shared: Shared): Html => {
	const interaction = { model: model.interaction, toParentMessage: toInteractionMessage }
	return StepState.match(running.step, {
		Native: () => h.div([]),
		Timezone: (form) =>
			timezoneStep(h, form, {
				browserTimezone: running.flow.browserTimezone || "UTC",
				nowMs: shared.nowMs,
			}),
		Theme: () => themeStep(h, shared.theme),
		UseCases: ({ box }) => useCaseStep(h, box),
		Role: ({ box }) => roleStep(h, box),
		Import: (form) => importStep(h, form),
		Invite: (form) => inviteStep(h, form, interaction),
		Finalizing: (step) => finalizationView(h, step),
		Completed: () => finalizationView(h, StepState.Finalizing({ failure: Option.none() })),
	})
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	// While the flow starts (or leaves) the shell shows its own loader.
	Phase.match(model.phase, {
		Starting: () => h.div([]),
		Leaving: () => h.div([]),
		Running: (running) => stepBody(h, model, running, shared),
	}),
)
