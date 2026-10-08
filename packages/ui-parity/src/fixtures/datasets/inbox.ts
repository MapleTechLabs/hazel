import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"

/**
 * The default workspace plus a full notifications inbox for Ada: channel, DM and thread
 * notifications spread over today, yesterday, this week and older, read and unread mixed.
 * Also links Ada's Discord account for the linked-accounts screen.
 */

const now = defaultDataset.now
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
const hoursAgo = (hours: number) => minutesAgo(hours * 60)
const daysAgo = (days: number) => minutesAgo(days * 60 * 24)

type Person = Parameters<typeof defaultIds.user>[0]

const threadChannelId = stableId("channel:thread-onboarding")
const dmChannelId = defaultIds.channel("dm-grace")
const general = defaultIds.channel("general")

const threadChannel: Row = {
	id: threadChannelId,
	name: "Onboarding copy feedback",
	icon: null,
	type: "thread",
	organizationId: defaultIds.orgId,
	parentChannelId: general,
	sectionId: null,
	createdAt: hoursAgo(2),
	updatedAt: null,
	deletedAt: null,
}

const threadMembers: Row[] = (["ada", "alan", "margaret"] as const).map((person) => ({
	id: stableId(`channel-member:thread-onboarding:${person}`),
	channelId: threadChannelId,
	userId: defaultIds.user(person),
	isHidden: false,
	isMuted: false,
	isFavorite: false,
	lastSeenMessageId: null,
	notificationCount: 0,
	joinedAt: hoursAgo(2),
	createdAt: hoursAgo(2),
	deletedAt: null,
}))

const extraMessages: ReadonlyArray<readonly [string, string, Person, Date, string]> = [
	["dm:0", dmChannelId, "grace", minutesAgo(25), "Do you have ten minutes before the planning call?"],
	["dm:1", dmChannelId, "grace", hoursAgo(26), "Sent you the hiring rubric, let me know what you think."],
	["dm:2", dmChannelId, "grace", daysAgo(3), "Thanks for covering the on-call shift!"],
	[
		"thread:0",
		threadChannelId,
		"alan",
		minutesAgo(50),
		"Could we shorten the second paragraph a bit more?",
	],
	[
		"thread:1",
		threadChannelId,
		"margaret",
		hoursAgo(28),
		"I left a few suggestions inline. The invite step wording is **much** clearer than before, nice work on that one.",
	],
	[
		"design:0",
		defaultIds.channel("design"),
		"linus",
		daysAgo(2),
		"New icon set is uploaded to the shared drive.",
	],
	[
		"engineering:0",
		defaultIds.channel("engineering"),
		"margaret",
		daysAgo(9),
		"Postmortem for last week's sync outage is published, please add your notes before Friday so we can close it out.",
	],
]

const messages: Row[] = extraMessages.map(([key, channelId, author, createdAt, content]) => ({
	id: stableId(`message:${key}`),
	channelId,
	conversationId: null,
	authorId: defaultIds.user(author),
	content,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt,
	updatedAt: null,
	deletedAt: null,
}))

/** [key, message id (or null), targeted channel (or null), createdAt, read] */
const notificationDefs: ReadonlyArray<readonly [string, string | null, string | null, Date, boolean]> = [
	["n0", stableId("message:general:10"), general, minutesAgo(3), false],
	["n1", stableId("message:dm:0"), dmChannelId, minutesAgo(25), false],
	["n2", stableId("message:general:8"), general, minutesAgo(42), true],
	["n3", stableId("message:thread:0"), threadChannelId, minutesAgo(50), false],
	["n4", stableId("message:general:7"), general, minutesAgo(60), true],
	["n5", stableId("message:general:3"), general, minutesAgo(168), true],
	["n6", stableId("message:dm:1"), dmChannelId, hoursAgo(26), true],
	["n7", stableId("message:thread:1"), threadChannelId, hoursAgo(28), false],
	["n8", null, defaultIds.channel("design"), hoursAgo(30), true],
	["n9", stableId("message:design:0"), defaultIds.channel("design"), daysAgo(2), false],
	["n10", stableId("message:dm:2"), dmChannelId, daysAgo(3), true],
	["n11", null, null, daysAgo(3), false],
	["n12", stableId("message:engineering:0"), defaultIds.channel("engineering"), daysAgo(9), true],
	["n13", stableId("message:general:0"), general, daysAgo(12), true],
]

const adaMemberId = stableId("org-member:ada")

const notifications: Row[] = notificationDefs.map(([key, messageId, channelId, createdAt, read]) => ({
	id: stableId(`notification:${key}`),
	memberId: adaMemberId,
	targetedResourceId: channelId,
	targetedResourceType: channelId ? "channel" : null,
	resourceId: messageId,
	resourceType: messageId ? "message" : null,
	createdAt,
	readAt: read ? new Date(createdAt.getTime() + 5 * 60_000) : null,
}))

const discordConnection: Row = {
	id: stableId("integration-connection:discord:ada"),
	provider: "discord",
	organizationId: defaultIds.orgId,
	userId: defaultIds.user("ada"),
	level: "user",
	status: "active",
	externalAccountId: "1029384756",
	externalAccountName: "ada.lovelace",
	connectedBy: defaultIds.user("ada"),
	settings: null,
	metadata: null,
	errorMessage: null,
	lastUsedAt: null,
	createdAt: daysAgo(20),
	updatedAt: null,
	deletedAt: null,
}

const tables = defaultDataset.tables

export const inboxDataset: Dataset = {
	...defaultDataset,
	name: "inbox",
	tables: {
		...tables,
		channels: [...(tables.channels ?? []), threadChannel],
		channel_members: [...(tables.channel_members ?? []), ...threadMembers],
		messages: [...(tables.messages ?? []), ...messages],
		notifications,
		integration_connections: [discordConnection],
	},
}
