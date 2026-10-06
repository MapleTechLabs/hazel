import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"

/**
 * The baseline workspace: one organization, a handful of teammates, a few
 * channels and a populated #general. Most scenarios run against this.
 */

const now = new Date("2026-03-12T15:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)

const orgId = stableId("org:hazel")

const people = [
	{ key: "ada", firstName: "Ada", lastName: "Lovelace", email: "ada@hazel.test", role: "owner" },
	{ key: "grace", firstName: "Grace", lastName: "Hopper", email: "grace@hazel.test", role: "admin" },
	{ key: "alan", firstName: "Alan", lastName: "Turing", email: "alan@hazel.test", role: "member" },
	{
		key: "margaret",
		firstName: "Margaret",
		lastName: "Hamilton",
		email: "margaret@hazel.test",
		role: "member",
	},
	{ key: "linus", firstName: "Linus", lastName: "Torvalds", email: "linus@hazel.test", role: "member" },
] as const

const userId = (key: (typeof people)[number]["key"]) => stableId(`user:${key}`)

const users: Row[] = people.map((person) => ({
	id: userId(person.key),
	externalId: `user_${person.key}`,
	email: person.email,
	firstName: person.firstName,
	lastName: person.lastName,
	avatarUrl: null,
	userType: "user",
	settings: null,
	isOnboarded: true,
	timezone: "UTC",
	createdAt: minutesAgo(60 * 24 * 90),
	updatedAt: null,
	deletedAt: null,
}))

const organizations: Row[] = [
	{
		id: orgId,
		name: "Hazel Labs",
		slug: "hazel",
		logoUrl: null,
		settings: null,
		isPublic: false,
		createdAt: minutesAgo(60 * 24 * 90),
		updatedAt: null,
		deletedAt: null,
	},
]

const organizationMembers: Row[] = people.map((person) => ({
	id: stableId(`org-member:${person.key}`),
	organizationId: orgId,
	userId: userId(person.key),
	role: person.role,
	nickname: null,
	joinedAt: minutesAgo(60 * 24 * 90),
	invitedBy: null,
	deletedAt: null,
	createdAt: minutesAgo(60 * 24 * 90),
}))

const projectsSectionId = stableId("section:projects")
const channelSections: Row[] = [
	{
		id: projectsSectionId,
		organizationId: orgId,
		name: "Projects",
		order: 0,
		createdAt: minutesAgo(60 * 24 * 60),
		updatedAt: null,
		deletedAt: null,
	},
]

const channelDefs = [
	{ key: "general", name: "general", type: "public", sectionId: null },
	{ key: "random", name: "random", type: "public", sectionId: null },
	{ key: "design", name: "design", type: "public", sectionId: projectsSectionId },
	{ key: "engineering", name: "engineering", type: "public", sectionId: projectsSectionId },
	{ key: "leadership", name: "leadership", type: "private", sectionId: null },
	{ key: "dm-grace", name: "Grace Hopper", type: "single", sectionId: null },
] as const

const channelId = (key: (typeof channelDefs)[number]["key"]) => stableId(`channel:${key}`)

const channels: Row[] = channelDefs.map((channel) => ({
	id: channelId(channel.key),
	name: channel.name,
	icon: null,
	type: channel.type,
	organizationId: orgId,
	parentChannelId: null,
	sectionId: channel.sectionId,
	createdAt: minutesAgo(60 * 24 * 60),
	updatedAt: null,
	deletedAt: null,
}))

const membership = (
	channelKey: (typeof channelDefs)[number]["key"],
	personKey: (typeof people)[number]["key"],
) => ({
	id: stableId(`channel-member:${channelKey}:${personKey}`),
	channelId: channelId(channelKey),
	userId: userId(personKey),
	isHidden: false,
	isMuted: false,
	isFavorite: channelKey === "design" && personKey === "ada",
	lastSeenMessageId: null,
	notificationCount: channelKey === "engineering" && personKey === "ada" ? 3 : 0,
	joinedAt: minutesAgo(60 * 24 * 60),
	createdAt: minutesAgo(60 * 24 * 60),
	deletedAt: null,
})

const channelMembers: Row[] = [
	...(["general", "random", "design", "engineering"] as const).flatMap((channel) =>
		people.map((person) => membership(channel, person.key)),
	),
	membership("leadership", "ada"),
	membership("leadership", "grace"),
	membership("dm-grace", "ada"),
	membership("dm-grace", "grace"),
]

const generalThread: ReadonlyArray<readonly [(typeof people)[number]["key"], number, string]> = [
	["grace", 180, "Morning all! Standup notes are in the doc, please skim before 10."],
	["alan", 176, "Thanks Grace. I'll take the parser refactor today."],
	[
		"margaret",
		170,
		"Reminder: the release freeze starts Thursday. Anything risky should land before then.",
	],
	["linus", 168, "Is the CI flake on `main` known? Seeing intermittent timeouts in the sync tests."],
	["grace", 166, "Known, tracking it. It's the Electric reconnect test, should be fixed by lunch."],
	[
		"ada",
		120,
		"Shipped the new onboarding copy. Feedback welcome!\n\n- shorter intro\n- clearer invite step",
	],
	["alan", 118, "Looks great. The invite step reads much better now."],
	["margaret", 60, "Can someone review **#412**? It touches the notification fan-out."],
	["ada", 42, "On it."],
	["linus", 12, "Heading out early today, back online tomorrow morning."],
	["grace", 3, "Have a good one!"],
]

const messages: Row[] = generalThread.map(([author, ago, content], index) => ({
	id: stableId(`message:general:${index}`),
	channelId: channelId("general"),
	conversationId: null,
	authorId: userId(author),
	content,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt: minutesAgo(ago),
	updatedAt: null,
	deletedAt: null,
}))

const messageReactions: Row[] = [
	{ message: 5, person: "grace", emoji: "🎉" },
	{ message: 5, person: "alan", emoji: "🎉" },
	{ message: 5, person: "margaret", emoji: "👍" },
	{ message: 8, person: "margaret", emoji: "🙏" },
].map(({ message, person, emoji }) => ({
	id: stableId(`reaction:${message}:${person}:${emoji}`),
	messageId: stableId(`message:general:${message}`),
	channelId: channelId("general"),
	conversationId: null,
	userId: userId(person as (typeof people)[number]["key"]),
	emoji,
	createdAt: minutesAgo(30),
}))

const presence: Row[] = people.map((person, index) => ({
	id: stableId(`presence:${person.key}`),
	userId: userId(person.key),
	status: (["online", "online", "away", "busy", "offline"] as const)[index],
	customMessage: null,
	statusEmoji: null,
	statusExpiresAt: null,
	activeChannelId: null,
	suppressNotifications: false,
	updatedAt: minutesAgo(5),
	lastSeenAt: minutesAgo(5),
}))

const ada = people[0]

export const defaultDataset: Dataset = {
	name: "default",
	now,
	clerkOrgId: "org_hazel",
	currentUser: {
		id: userId("ada"),
		clerkUserId: "user_ada",
		organizationId: orgId,
		role: "owner",
		firstName: ada.firstName,
		lastName: ada.lastName,
		email: ada.email,
		isOnboarded: true,
		timezone: "UTC",
		settings: null,
	} as Dataset["currentUser"],
	tables: {
		users,
		organizations,
		organization_members: organizationMembers,
		channel_sections: channelSections,
		channels,
		channel_members: channelMembers,
		messages,
		message_reactions: messageReactions,
		user_presence_status: presence,
	},
	rpc: {},
}

/** Handy references for scenarios. */
export const defaultIds = {
	orgSlug: "hazel",
	orgId,
	channel: channelId,
	user: userId,
}
