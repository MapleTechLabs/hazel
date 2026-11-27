/**
 * The onboarding flow (today's `atoms/onboarding-atoms.ts`): the step order of the creator and invited
 * flows, the "Step N of M" numbers, and what the finished steps collect. Shared with the Foldkit page
 * that still draws the later steps (`web-foldkit/src/page/onboarding/flow.ts` re-exports it).
 */
import { OrganizationId, OrganizationMemberId } from "@hazel/schema"
import { Schema } from "effect"

export const Step = Schema.Literals([
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"useCases",
	"role",
	"import",
	"teamInvitation",
	"finalization",
	"completed",
])
export type Step = typeof Step.Type

export const UserType = Schema.Literals(["creator", "invited"])
export type UserType = typeof UserType.Type

export const Direction = Schema.Literals(["forward", "backward"])
export type Direction = typeof Direction.Type

/** The user's first organization membership: an organization with a slug means they were invited. */
export const Membership = Schema.Struct({
	organizationId: OrganizationId,
	memberId: OrganizationMemberId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
})
export type Membership = typeof Membership.Type

/** `OnboardingData`: what the finished steps collected, sent when onboarding finishes. */
export const OnboardingData = Schema.Struct({
	timezone: Schema.NullOr(Schema.String),
	useCases: Schema.Array(Schema.String),
	role: Schema.NullOr(Schema.String),
})
export type OnboardingData = typeof OnboardingData.Type

export const emptyData: OnboardingData = { timezone: null, useCases: [], role: null }

/** The flow, fixed when it starts (`userType`) or kept current by the live query (`membership`). */
export const Flow = Schema.Struct({
	userType: UserType,
	membership: Schema.NullOr(Membership),
	browserTimezone: Schema.String,
})
export type Flow = typeof Flow.Type

export const userTypeOf = (membership: Membership | null): UserType =>
	membership?.slug ? "invited" : "creator"

const CREATOR_FLOW: ReadonlyArray<Step> = [
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"useCases",
	"role",
	"import",
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

/** Which way a move from `from` to `to` goes in the flow (an unknown step counts as forward). */
export const directionOf = (from: Step, to: Step, userType: UserType): Direction => {
	const flow = flowOf(userType)
	return flow.indexOf(to) < flow.indexOf(from) ? "backward" : "forward"
}

const STEP_NUMBERS = {
	welcome: { creator: 1, invited: 1 },
	profileInfo: { creator: 2, invited: 2 },
	timezoneSelection: { creator: 3, invited: 3 },
	themeSelection: { creator: 4, invited: 4 },
	useCases: { creator: 5, invited: null },
	role: { creator: 6, invited: 5 },
	import: { creator: 7, invited: null },
	teamInvitation: { creator: 8, invited: null },
	finalization: { creator: 8, invited: 5 },
	completed: { creator: 8, invited: 5 },
} satisfies Readonly<Record<Step, { creator: number; invited: number | null }>>

export const stepNumber = (step: Step, userType: UserType): number =>
	(userType === "creator" ? STEP_NUMBERS[step].creator : STEP_NUMBERS[step].invited) ?? 1

export const totalSteps = (userType: UserType): number => (userType === "creator" ? 8 : 5)
