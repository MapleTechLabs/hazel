import { Match, Option } from "effect"
import type { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { onboardingHref } from "../../route"
import type { Resources } from "../../rpc"
import * as ChoiceBox from "../../ui/choice-box"
import type { PageReturn, Shared } from "../contract"
import { CompleteOnboarding, ReplaceOnboardingStepUrl } from "./command"
import { type Direction, nextStep, previousStep, type Step, stepFromUrl } from "./flow"
import type { Message } from "./message"
import {
	type Data,
	type Membership,
	type Model,
	Phase,
	type Running,
	StepState,
	isBusy,
	stepOf,
} from "./model"

/** Step changes: each entered step gets fresh state, like the legacy step components remounting. */

export type Return = PageReturn<Model, Message>

const stateFor = (step: Step, running: Running, shared: Shared): StepState =>
	Match.value(step).pipe(
		Match.when("welcome", () => StepState.Welcome()),
		Match.when("profileInfo", () =>
			StepState.Profile({
				firstName: shared.currentUser?.firstName ?? "",
				lastName: shared.currentUser?.lastName ?? "",
				hasChanged: false,
				isSubmitting: false,
			}),
		),
		Match.when("timezoneSelection", () =>
			StepState.Timezone({
				selected: running.data.timezone ?? (running.flow.browserTimezone || "UTC"),
				query: "",
				debouncedQuery: "",
				hoveredOffset: null,
				detectionAttempted: false,
				isSubmitting: false,
			}),
		),
		Match.when("themeSelection", () => StepState.Theme()),
		Match.when("useCases", () =>
			StepState.UseCases({
				box: ChoiceBox.init({ id: "team-size", selectedKeys: running.data.useCases.slice(0, 1) }),
			}),
		),
		Match.when("role", () =>
			StepState.Role({
				box: ChoiceBox.init({
					id: "role",
					selectedKeys: running.data.role ? [running.data.role] : [],
				}),
			}),
		),
		Match.when("teamInvitation", () =>
			StepState.Invite({
				rows: [{ id: 0, email: "", error: Option.none() }],
				nextRowId: 1,
				isSending: false,
			}),
		),
		Match.when("finalization", () => StepState.Finalizing({ failure: Option.none() })),
		Match.when("completed", () => StepState.Completed()),
		Match.exhaustive,
	)

/** Finalizes with what the steps collected and the member the user joined as. */
export const completeOnboarding = (running: Running): Command.Command<Message, never, Resources> =>
	CompleteOnboarding({
		memberId: running.flow.membership?.memberId ?? null,
		role: running.data.role,
		useCases: running.data.useCases,
	})

export const withPhase = (model: Model, phase: Running): Model => modifyFields(model, { phase: () => phase })

/** Replaces the step's state in place (no step change, no URL change). */
export const setStep = (model: Model, running: Running, step: StepState): Model =>
	withPhase(model, modifyFields(running, { step: () => step }))

/** Enters `step`; `syncUrl` is false only for the first step, which came from the URL. */
export const enterStep = (
	model: Model,
	running: Running,
	step: Step,
	options: { readonly direction: Direction; readonly shared: Shared; readonly syncUrl: boolean },
): Return => {
	const next = modifyFields(running, {
		step: () => stateFor(step, running, options.shared),
		direction: () => options.direction,
		animatesStep: () => options.syncUrl,
	})
	return {
		model: withPhase(model, next),
		commands: [
			...(options.syncUrl
				? [ReplaceOnboardingStepUrl({ href: onboardingHref(model.orgId, step) })]
				: []),
			...(step === "finalization" ? [completeOnboarding(next)] : []),
		],
	}
}

type DataTransform = Partial<{ readonly [K in keyof Data]: (value: Data[K]) => Data[K] }>

/** `createStepHandler`: record the step's data and move forward. */
export const advance = (
	model: Model,
	running: Running,
	shared: Shared,
	transform: DataTransform = {},
): Return =>
	enterStep(
		model,
		modifyFields(running, { data: (data) => modifyFields(data, transform) }),
		nextStep(stepOf(running.step), running.flow.userType),
		{ direction: "forward", shared, syncUrl: true },
	)

/** The invite step skips straight to finalization (`handleTeamInviteContinue` / `Skip`). */
export const finalize = (model: Model, running: Running, shared: Shared): Return =>
	enterStep(model, running, "finalization", { direction: "forward", shared, syncUrl: true })

/** Back waits for a request in flight: its late result would otherwise land on a fresh form. */
export const goBack = (model: Model, running: Running, shared: Shared): Return => {
	if (isBusy(running.step)) return { model }
	const previous = previousStep(stepOf(running.step), running.flow.userType)
	return previous === null
		? { model }
		: enterStep(model, running, previous, { direction: "backward", shared, syncUrl: true })
}

/**
 * `createInitialState` plus the `?step=` override, once both the browser timezone and the membership
 * are known. An organization with a slug means the user was invited into it.
 */
export const startWhenReady = (
	model: Model,
	known: {
		readonly membership: Option.Option<Membership | null>
		readonly browserTimezone: Option.Option<string>
	},
	shared: Shared,
): Return =>
	Option.match(Option.all({ membership: known.membership, browserTimezone: known.browserTimezone }), {
		onNone: () => ({ model: modifyFields(model, { phase: () => Phase.Starting(known) }) }),
		onSome: ({ membership, browserTimezone }) => {
			const userType = membership?.slug ? "invited" : "creator"
			const running = Phase.Running({
				flow: { userType, membership, browserTimezone },
				step: StepState.Welcome(),
				direction: "forward",
				animatesStep: false,
				data: { timezone: null, useCases: [], role: null },
			})
			return enterStep(model, running, stepFromUrl(model.urlStep, userType) ?? "welcome", {
				direction: "forward",
				shared,
				syncUrl: false,
			})
		},
	})
