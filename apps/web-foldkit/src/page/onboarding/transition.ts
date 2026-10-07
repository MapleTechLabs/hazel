import { Match } from "effect"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { DEFAULT_BRAND_COLOR } from "~/lib/theme/presets"
import type { HazelRpc } from "../../rpc"
import * as ChoiceBox from "../../ui/choice-box"
import type { PageReturn, Shared } from "../contract"
import { CompleteOnboarding, ReadThemePreference, ReplaceStepUrl } from "./command"
import { type Direction, nextStep, previousStep, type Step, stepFromUrl } from "./flow"
import type { Message } from "./message"
import { type Data, type Model, StepForm } from "./model"

/** Step changes: each entered step gets fresh form state, like the legacy step components remounting. */

export type Return = PageReturn<Model, Message>

const formFor = (model: Model, step: Step, shared: Shared): StepForm =>
	Match.value(step).pipe(
		Match.when("profileInfo", () =>
			StepForm.Profile({
				firstName: shared.currentUser?.firstName ?? "",
				lastName: shared.currentUser?.lastName ?? "",
				hasChanged: false,
				isSubmitting: false,
			}),
		),
		Match.when("timezoneSelection", () =>
			StepForm.Timezone({
				selected: model.data.timezone ?? model.browserTimezone,
				query: "",
				debouncedQuery: "",
				hoveredOffset: null,
				detectionAttempted: false,
				isSubmitting: false,
			}),
		),
		Match.when("themeSelection", () =>
			StepForm.Theme({ theme: "system", brandColor: DEFAULT_BRAND_COLOR }),
		),
		Match.when("useCases", () =>
			StepForm.Choice({
				box: ChoiceBox.init({ id: "team-size", selectedKeys: model.data.useCases.slice(0, 1) }),
			}),
		),
		Match.when("role", () =>
			StepForm.Choice({
				box: ChoiceBox.init({ id: "role", selectedKeys: model.data.role ? [model.data.role] : [] }),
			}),
		),
		Match.when("teamInvitation", () => StepForm.Invite({ emails: [""], errors: {}, isLoading: false })),
		Match.orElse(() => StepForm.None()),
	)

const stepCommands = (model: Model, step: Step): ReadonlyArray<Command.Command<Message, never, HazelRpc>> =>
	step === "themeSelection"
		? [ReadThemePreference({})]
		: step === "finalization"
			? [
					CompleteOnboarding({
						memberId: model.membership?.memberId ?? null,
						role: model.data.role,
						useCases: model.data.useCases,
						emails: model.data.emails,
					}),
				]
			: []

/** Enters `step`; `syncUrl` is false only for the first step, which came from the URL. */
export const enterStep = (
	model: Model,
	step: Step,
	options: { readonly direction: Direction; readonly shared: Shared; readonly syncUrl: boolean },
): Return => {
	const next = modifyFields(model, {
		step: () => step,
		direction: () => options.direction,
		animatesStep: () => options.syncUrl,
		error: () => null,
		isProcessing: () => step === "finalization",
		form: () => formFor(model, step, options.shared),
	})
	return {
		model: next,
		commands: [...(options.syncUrl ? [ReplaceStepUrl({ step })] : []), ...stepCommands(next, step)],
	}
}

/** `createStepHandler`: record the step's data and move forward. */
export const advance = (model: Model, shared: Shared, patch: Partial<Data> = {}): Return =>
	enterStep(
		modifyFields(model, { data: (data) => ({ ...data, ...patch }) }),
		nextStep(model.step, model.userType),
		{ direction: "forward", shared, syncUrl: true },
	)

/** The invite step skips straight to finalization (`handleTeamInviteContinue` / `Skip`). */
export const finalize = (model: Model, shared: Shared, emails: ReadonlyArray<string>): Return =>
	enterStep(modifyFields(model, { data: (data) => ({ ...data, emails }) }), "finalization", {
		direction: "forward",
		shared,
		syncUrl: true,
	})

export const goBack = (model: Model, shared: Shared): Return => {
	const previous = previousStep(model.step, model.userType)
	return previous === null
		? { model }
		: enterStep(model, previous, { direction: "backward", shared, syncUrl: true })
}

/**
 * `createInitialState` plus the `?step=` override, once both the URL and the membership are known.
 * An organization with a slug means the user was invited into it.
 */
export const initializeWhenReady = (model: Model, shared: Shared): Return => {
	if (model.isInitialized || model.urlStep === undefined || model.membership === undefined) return { model }
	const userType = model.membership?.slug ? "invited" : "creator"
	const step = stepFromUrl(model.urlStep, userType) ?? "welcome"
	return enterStep(modifyFields(model, { isInitialized: () => true, userType: () => userType }), step, {
		direction: "forward",
		shared,
		syncUrl: false,
	})
}
