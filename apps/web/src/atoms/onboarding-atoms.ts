import { Atom } from "effect/reactivity"
import type { OrganizationId } from "@hazel/schema"

// Step identifiers. Clerk handles org creation during sign-up via its
// "Force organization creation" dashboard setting — our custom flow
// just needs to know about (not create) the org.
export type OnboardingStep =
	| "welcome"
	| "profileInfo"
	| "timezoneSelection"
	| "themeSelection"
	| "useCases"
	| "role"
	| "teamInvitation"
	| "finalization"
	| "completed"

// User type determines which flow to follow
export type UserType = "creator" | "invited"

// Accumulated wizard data
export interface OnboardingData {
	firstName?: string
	lastName?: string
	timezone?: string
	theme?: "dark" | "light" | "system"
	brandColor?: string
	orgName?: string
	orgSlug?: string
	createdOrgId?: OrganizationId
	useCases: string[]
	role?: string
	emails: string[]
}

// Complete wizard state
export interface OnboardingState {
	currentStep: OnboardingStep
	direction: "forward" | "backward"
	userType: UserType
	data: OnboardingData
	isProcessing: boolean
	error?: string
	initialOrgId?: OrganizationId
	initialOrganization?: {
		id: OrganizationId
		name?: string
		slug?: string
	}
}

// Flow configuration (exported for URL validation)
export const CREATOR_FLOW: OnboardingStep[] = [
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"useCases",
	"role",
	"teamInvitation",
	"finalization",
]

export const INVITED_FLOW: OnboardingStep[] = [
	"welcome",
	"profileInfo",
	"timezoneSelection",
	"themeSelection",
	"role",
	"finalization",
]

// Validate if a step is valid for a given user type
export function isValidStepForUser(step: string, userType: UserType): step is OnboardingStep {
	const flow = userType === "creator" ? CREATOR_FLOW : INVITED_FLOW
	return flow.includes(step as OnboardingStep)
}

// Step numbers for progress indicator
const STEP_NUMBERS: Record<OnboardingStep, { creator: number | null; invited: number | null }> = {
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

// Helper functions
function getFlow(userType: UserType): OnboardingStep[] {
	return userType === "creator" ? CREATOR_FLOW : INVITED_FLOW
}

export function getNextStep(currentStep: OnboardingStep, userType: UserType): OnboardingStep | undefined {
	const flow = getFlow(userType)
	const currentIndex = flow.indexOf(currentStep)
	if (currentIndex === -1 || currentIndex >= flow.length - 1) return undefined
	return flow[currentIndex + 1]
}

export function getPreviousStep(currentStep: OnboardingStep, userType: UserType): OnboardingStep | undefined {
	const flow = getFlow(userType)
	const currentIndex = flow.indexOf(currentStep)
	if (currentIndex <= 0) return undefined
	return flow[currentIndex - 1]
}

export function getStepNumber(step: OnboardingStep, userType: UserType): number {
	const numbers = STEP_NUMBERS[step]
	return (userType === "creator" ? numbers.creator : numbers.invited) ?? 1
}

export function getTotalSteps(userType: UserType): number {
	return userType === "creator" ? 7 : 5
}

// Factory function to create initial state
export function createInitialState(input: {
	orgId?: OrganizationId
	organization?: { id: OrganizationId; name?: string; slug?: string }
}): OnboardingState {
	const userType: UserType = input.orgId && input.organization?.slug ? "invited" : "creator"

	return {
		currentStep: "welcome",
		direction: "forward",
		userType,
		data: {
			useCases: [],
			emails: [],
		},
		isProcessing: false,
		error: undefined,
		initialOrgId: input.orgId,
		initialOrganization: input.organization,
	}
}

// Atom family keyed by a stable identifier for the onboarding session
export const onboardingAtomFamily = Atom.family((_key: string) =>
	Atom.make<OnboardingState>(createInitialState({})),
)

// Derived atom helpers (use with the state directly in the hook)
export function computeStepNumber(state: OnboardingState): number {
	return getStepNumber(state.currentStep, state.userType)
}

export function computeTotalSteps(state: OnboardingState): number {
	return getTotalSteps(state.userType)
}
