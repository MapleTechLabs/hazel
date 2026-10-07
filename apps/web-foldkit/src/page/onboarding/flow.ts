import { Schema } from "effect"

/** Port of `atoms/onboarding-atoms.ts`: the step order of both flows and the progress numbers. */

export const Step = Schema.Literals([
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"useCases",
	"role",
	"teamInvitation",
	"finalization",
	"completed",
])
export type Step = typeof Step.Type

export const UserType = Schema.Literals(["creator", "invited"])
export type UserType = typeof UserType.Type

export const Direction = Schema.Literals(["forward", "backward"])
export type Direction = typeof Direction.Type

const CREATOR_FLOW: ReadonlyArray<Step> = [
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"useCases",
	"role",
	"teamInvitation",
	"finalization",
]

const INVITED_FLOW: ReadonlyArray<Step> = [
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"role",
	"finalization",
]

const flowOf = (userType: UserType) => (userType === "creator" ? CREATOR_FLOW : INVITED_FLOW)

/** The `?step=` value is honoured only when it belongs to the user's flow. */
export const stepFromUrl = (value: string | null, userType: UserType): Step | null => {
	const step = flowOf(userType).find((candidate) => candidate === value)
	return step ?? null
}

export const nextStep = (step: Step, userType: UserType): Step => {
	const flow = flowOf(userType)
	const index = flow.indexOf(step)
	return index === -1 || index >= flow.length - 1 ? step : (flow[index + 1] ?? step)
}

export const previousStep = (step: Step, userType: UserType): Step | null => {
	const flow = flowOf(userType)
	const index = flow.indexOf(step)
	return index <= 0 ? null : (flow[index - 1] ?? null)
}

const STEP_NUMBERS: Readonly<Record<Step, { creator: number; invited: number | null }>> = {
	welcome: { creator: 1, invited: 1 },
	profileInfo: { creator: 2, invited: 2 },
	timezoneSelection: { creator: 3, invited: 3 },
	themeSelection: { creator: 4, invited: 4 },
	useCases: { creator: 5, invited: null },
	role: { creator: 6, invited: 5 },
	teamInvitation: { creator: 7, invited: null },
	finalization: { creator: 7, invited: 5 },
	completed: { creator: 7, invited: 5 },
}

export const stepNumber = (step: Step, userType: UserType): number =>
	(userType === "creator" ? STEP_NUMBERS[step].creator : STEP_NUMBERS[step].invited) ?? 1

export const totalSteps = (userType: UserType): number => (userType === "creator" ? 7 : 5)
