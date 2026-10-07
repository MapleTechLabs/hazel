import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"

/**
 * A user who just signed up: `isOnboarded: false`, no organization yet. Drives the
 * creator onboarding flow (`/onboarding`) and the no-organization screens.
 */

const now = new Date("2026-03-12T15:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

const userId = stableId("user:nora")

const users: Row[] = [
	{
		id: userId,
		externalId: "user_nora",
		email: "nora@newcomer.test",
		firstName: "Nora",
		lastName: "Newcomer",
		avatarUrl: null,
		userType: "user",
		settings: null,
		isOnboarded: false,
		timezone: null,
		createdAt: minutesAgo(5),
		updatedAt: null,
		deletedAt: null,
	},
]

export const onboardingDataset: Dataset = {
	name: "onboarding",
	now,
	clerkOrgId: null,
	currentUser: {
		id: userId,
		clerkUserId: "user_nora",
		organizationId: null,
		role: "member",
		firstName: "Nora",
		lastName: "Newcomer",
		email: "nora@newcomer.test",
		isOnboarded: false,
		timezone: null,
		settings: null,
	} as Dataset["currentUser"],
	tables: { users },
	rpc: {},
}
