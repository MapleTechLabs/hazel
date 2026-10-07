import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"

/** Datasets for the personal area: Ada's own preferences toggled, and an overflowing directory. */

const now = defaultDataset.now
const daysAgo = (days: number) => new Date(now.getTime() - days * 60 * 24 * 60_000)
const tables = defaultDataset.tables
const ada = defaultIds.user("ada")

/** Ada has do-not-disturb on, custom quiet hours, and the quiet-hours status indicator off. */
export const personalPrefsDataset: Dataset = {
	...defaultDataset,
	name: "personal-prefs",
	tables: {
		...tables,
		users: (tables.users ?? []).map((user) =>
			user.id === ada
				? {
						...user,
						settings: {
							doNotDisturb: true,
							quietHoursStart: "21:30",
							quietHoursEnd: "07:15",
							showQuietHoursInStatus: false,
						},
					}
				: user,
		),
	},
}

const longFirst = "Augusta Ada Maximiliana"
const longLast = "King-Noel Lovelace-Byron of Ockham"

/** Thirty extra members with long names, long channel names, and Ada with a very long name. */
const extraPeople = Array.from({ length: 30 }, (_, index) => ({
	key: `member-${String(index).padStart(2, "0")}`,
	firstName: ["Bartholomew", "Konstantina", "Maximilian", "Evangeline", "Wilhelmina"][index % 5]!,
	lastName: `${["Featherstonehaugh", "Vandersloot-Abernathy", "Oyelaran-Castellanos"][index % 3]} ${index + 1}`,
	role: index % 7 === 0 ? "admin" : "member",
}))

const extraUsers: Row[] = extraPeople.map((person) => ({
	id: stableId(`user:${person.key}`),
	externalId: `user_${person.key}`,
	email: `${person.firstName.toLowerCase()}.${person.key}@a-very-long-company-domain-name.test`,
	firstName: person.firstName,
	lastName: person.lastName,
	avatarUrl: null,
	userType: "user",
	settings: null,
	isOnboarded: true,
	timezone: "UTC",
	createdAt: daysAgo(30),
	updatedAt: null,
	deletedAt: null,
}))

const extraOrgMembers: Row[] = extraPeople.map((person, index) => ({
	id: stableId(`org-member:${person.key}`),
	organizationId: defaultIds.orgId,
	userId: stableId(`user:${person.key}`),
	role: person.role,
	nickname: null,
	joinedAt: daysAgo(30 - index),
	invitedBy: null,
	deletedAt: null,
	createdAt: daysAgo(30 - index),
}))

const longChannels = [
	"cross-functional-platform-reliability-and-incident-response",
	"customer-feedback-triage-for-the-enterprise-tier",
	"quarterly-planning-and-roadmap-alignment-working-group",
	"design-system-component-library-office-hours",
].map((name, index) => ({ key: `long-${index}`, name }))

const extraChannels: Row[] = longChannels.map((channel) => ({
	id: stableId(`channel:${channel.key}`),
	name: channel.name,
	icon: null,
	type: "public",
	organizationId: defaultIds.orgId,
	parentChannelId: null,
	sectionId: null,
	createdAt: daysAgo(10),
	updatedAt: null,
	deletedAt: null,
}))

const extraChannelMembers: Row[] = longChannels.flatMap((channel, index) =>
	[ada, ...extraUsers.slice(0, 5 + index * 4).map((user) => user.id as string)].map((userId) => ({
		id: stableId(`channel-member:${channel.key}:${userId}`),
		channelId: stableId(`channel:${channel.key}`),
		userId,
		isHidden: false,
		isMuted: index === 3,
		isFavorite: index === 0,
		lastSeenMessageId: null,
		notificationCount: userId === ada ? [120, 7, 0, 0][index] : 0,
		joinedAt: daysAgo(10),
		createdAt: daysAgo(10),
		deletedAt: null,
	})),
)

export const personalOverflowDataset: Dataset = {
	...defaultDataset,
	name: "personal-overflow",
	currentUser: { ...defaultDataset.currentUser, firstName: longFirst, lastName: longLast },
	tables: {
		...tables,
		users: [
			...(tables.users ?? []).map((user) =>
				user.id === ada ? { ...user, firstName: longFirst, lastName: longLast } : user,
			),
			...extraUsers,
		],
		organization_members: [...(tables.organization_members ?? []), ...extraOrgMembers],
		channels: [...(tables.channels ?? []), ...extraChannels],
		channel_members: [...(tables.channel_members ?? []), ...extraChannelMembers],
	},
}

export const personalIds = {
	longMember: stableId("user:member-00"),
	missingUser: stableId("user:does-not-exist"),
}
