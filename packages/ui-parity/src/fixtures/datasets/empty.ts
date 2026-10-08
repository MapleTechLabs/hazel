import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"

/**
 * A brand-new organization: one onboarded owner, no channels, no messages, no teammates.
 * Covers the org home, chat index and sidebar empty states.
 */

const now = new Date("2026-03-12T15:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

const orgId = stableId("org:nimbus")
const userId = stableId("user:robin")

const users: Row[] = [
	{
		id: userId,
		externalId: "user_robin",
		email: "robin@nimbus.test",
		firstName: "Robin",
		lastName: "Founder",
		avatarUrl: null,
		userType: "user",
		settings: null,
		isOnboarded: true,
		timezone: "UTC",
		createdAt: minutesAgo(30),
		updatedAt: null,
		deletedAt: null,
	},
]

const organizations: Row[] = [
	{
		id: orgId,
		name: "Nimbus",
		slug: "nimbus",
		logoUrl: null,
		settings: null,
		isPublic: false,
		createdAt: minutesAgo(20),
		updatedAt: null,
		deletedAt: null,
	},
]

const organizationMembers: Row[] = [
	{
		id: stableId("org-member:nimbus:robin"),
		organizationId: orgId,
		userId,
		role: "owner",
		nickname: null,
		joinedAt: minutesAgo(20),
		invitedBy: null,
		deletedAt: null,
		createdAt: minutesAgo(20),
	},
]

const presence: Row[] = [
	{
		id: stableId("presence:robin"),
		userId,
		status: "online",
		customMessage: null,
		statusEmoji: null,
		statusExpiresAt: null,
		activeChannelId: null,
		suppressNotifications: false,
		updatedAt: minutesAgo(1),
		lastSeenAt: minutesAgo(1),
	},
]

export const emptyDataset: Dataset = {
	name: "empty",
	now,
	clerkOrgId: "org_nimbus",
	currentUser: {
		id: userId,
		clerkUserId: "user_robin",
		organizationId: orgId,
		role: "owner",
		firstName: "Robin",
		lastName: "Founder",
		email: "robin@nimbus.test",
		isOnboarded: true,
		timezone: "UTC",
		settings: null,
	} as Dataset["currentUser"],
	tables: {
		users,
		organizations,
		organization_members: organizationMembers,
		user_presence_status: presence,
	},
	rpc: {},
}

export const emptyIds = { orgSlug: "nimbus", orgId }
