import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import {
	channelName,
	firstNames,
	int,
	lastNames,
	longPeople,
	messageContent,
	mulberry32,
	pick,
	type Rng,
} from "./heavy-content.ts"

/**
 * A large workspace for list performance and virtualization parity: ~50 users,
 * 500 channels Ada belongs to (a third unread), one 10,000-message #firehose and
 * ~2,000 messages spread elsewhere. Same org and signed-in user as `default`.
 */

const now = new Date("2026-03-12T15:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
const secondsAgo = (seconds: number) => new Date(now.getTime() - seconds * 1000)

const orgId = stableId("org:hazel")

interface Person {
	readonly key: string
	readonly firstName: string
	readonly lastName: string
	readonly role: "owner" | "admin" | "member"
}

const people: ReadonlyArray<Person> = [
	{ key: "ada", firstName: "Ada", lastName: "Lovelace", role: "owner" },
	...Array.from(
		{ length: 42 },
		(_, i): Person => ({
			key: `u${i}`,
			firstName: firstNames[i % firstNames.length]!,
			lastName: lastNames[(i + Math.floor(i / firstNames.length) * 5) % lastNames.length]!,
			role: i < 2 ? "admin" : "member",
		}),
	),
	...longPeople.map((person, i): Person => ({ key: `long${i}`, ...person, role: "member" })),
]
const others = people.slice(1)

const userId = (key: string) => stableId(`user:${key}`)

const users: Row[] = people.map((person) => ({
	id: userId(person.key),
	externalId: `user_${person.key}`,
	email: `${person.key}@hazel.test`,
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

const sectionNames = [
	"Projects",
	"Teams",
	"Customers",
	"Incidents and on-call rotations",
	"Social",
	"Archive",
]
const sectionId = (index: number) => stableId(`heavy-section:${index}`)
const channelSections: Row[] = sectionNames.map((name, order) => ({
	id: sectionId(order),
	organizationId: orgId,
	name,
	order,
	createdAt: minutesAgo(60 * 24 * 60),
	updatedAt: null,
	deletedAt: null,
}))

interface ChannelDef {
	readonly key: string
	readonly name: string
	readonly type: "public" | "private" | "single"
	readonly sectionId: string | null
	/** Members besides Ada. */
	readonly members: ReadonlyArray<string>
}

const CHANNEL_COUNT = 500
const DM_COUNT = 8
const rng: Rng = mulberry32(0x6ea7)

const sampleOthers = (count: number) => {
	const chosen = new Set<string>()
	while (chosen.size < count) chosen.add(pick(rng, others).key)
	return [...chosen]
}

const channelDefs: ReadonlyArray<ChannelDef> = [
	{ key: "firehose", name: "firehose", type: "public", sectionId: null, members: others.map((p) => p.key) },
	{ key: "general", name: "general", type: "public", sectionId: null, members: others.map((p) => p.key) },
	...Array.from({ length: DM_COUNT }, (_, i): ChannelDef => {
		const other = others[(i * 5) % others.length]!
		return {
			key: `dm-${other.key}`,
			name: `${other.firstName} ${other.lastName}`,
			type: "single",
			sectionId: null,
			members: [other.key],
		}
	}),
	...Array.from({ length: CHANNEL_COUNT - 2 - DM_COUNT }, (_, i): ChannelDef => {
		const roll = rng()
		return {
			key: `c${i}`,
			name: channelName(i + 1),
			type: i % 11 === 3 ? "private" : "public",
			sectionId: roll < 0.4 ? null : sectionId(Math.floor((roll - 0.4) / 0.1)),
			members: sampleOthers(int(rng, 1, 4)),
		}
	}),
]

const channelId = (key: string) => stableId(`heavy-channel:${key}`)

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
	channelKey: string,
	personKey: string,
	flags: { isMuted?: boolean; isFavorite?: boolean; notificationCount?: number } = {},
): Row => ({
	id: stableId(`heavy-channel-member:${channelKey}:${personKey}`),
	channelId: channelId(channelKey),
	userId: userId(personKey),
	isHidden: false,
	isMuted: flags.isMuted ?? false,
	isFavorite: flags.isFavorite ?? false,
	lastSeenMessageId: null,
	notificationCount: flags.notificationCount ?? 0,
	joinedAt: minutesAgo(60 * 24 * 60),
	createdAt: minutesAgo(60 * 24 * 60),
	deletedAt: null,
})

/** Ada's flags per channel: about a third unread, every 61st a favorite, every 47th muted. */
const adaFlags = (channel: ChannelDef, index: number) => {
	const unread = channel.key !== "firehose" && rng() < 1 / 3
	return {
		notificationCount: unread ? (rng() < 0.1 ? int(rng, 100, 250) : int(rng, 1, 30)) : 0,
		isFavorite: index % 61 === 5,
		isMuted: index % 47 === 7,
	}
}

const channelMembers: Row[] = channelDefs.flatMap((channel, index) => [
	membership(channel.key, "ada", adaFlags(channel, index)),
	...channel.members.map((member) => membership(channel.key, member)),
])

const messageRng: Rng = mulberry32(0xf12e)
const BIG_CHANNEL_MESSAGES = 10_000
const authorPool = [...people.map((p) => p.key), "ada", "ada", "ada"]

/**
 * Authors in runs of 1-6 and seconds-before-now for each message, oldest first.
 * Runs are seconds apart (grouped); between runs the gap is up to 7 minutes.
 */
const timeline = (count: number, latestAgo: number) => {
	const authors: string[] = []
	while (authors.length < count) {
		let author = pick(messageRng, authorPool)
		while (author === authors.at(-1)) author = pick(messageRng, authorPool)
		const run = Math.min(int(messageRng, 1, 6), count - authors.length)
		for (let i = 0; i < run; i++) authors.push(author)
	}
	const ago: number[] = Array.from({ length: count }, () => latestAgo)
	for (let i = count - 2; i >= 0; i--) {
		const gap = authors[i] === authors[i + 1] ? int(messageRng, 5, 60) : int(messageRng, 20, 420)
		ago[i] = ago[i + 1]! + gap
	}
	return authors.map((author, i) => ({ author, ago: ago[i]! }))
}

const messageId = (channelKey: string, index: number) => stableId(`heavy-message:${channelKey}:${index}`)

const channelMessages = (channelKey: string, count: number, latestAgo: number): Row[] =>
	timeline(count, latestAgo).map(({ author, ago }, index) => ({
		id: messageId(channelKey, index),
		channelId: channelId(channelKey),
		conversationId: null,
		authorId: userId(author),
		content: messageContent(messageRng),
		embeds: null,
		replyToMessageId: null,
		threadChannelId: null,
		createdAt: secondsAgo(ago),
		updatedAt: null,
		deletedAt: null,
	}))

const firehoseMessages = channelMessages("firehose", BIG_CHANNEL_MESSAGES, 90)

/** ~2,000 more: #general, every DM, and the first 190 generated channels. */
const spreadMessages: Row[] = [
	...channelMessages("general", 60, 240),
	...channelDefs
		.filter((channel) => channel.type === "single")
		.flatMap((channel) => channelMessages(channel.key, 6, int(messageRng, 600, 60 * 60 * 24))),
	...Array.from({ length: 190 }, (_, i) =>
		channelMessages(`c${i}`, int(messageRng, 4, 16), int(messageRng, 300, 60 * 60 * 24 * 7)),
	).flat(),
]

const emojis = ["👍", "🎉", "🙏", "❤️", "😂"]

/**
 * Reactions on ~7% of #firehose messages, 1-3 emoji each, Ada among the reactors on some.
 * A few of the newest always react so the steady-state viewport shows reaction pills.
 */
const messageReactions: Row[] = firehoseMessages.flatMap((message, index) => {
	const forced = index >= BIG_CHANNEL_MESSAGES - 8 && index % 3 === 0
	if (!forced && messageRng() >= 0.07) return []
	const createdAt = new Date(Math.min((message.createdAt as Date).getTime() + 30_000, now.getTime()))
	const chosenEmojis = new Set(
		Array.from({ length: int(messageRng, 1, 3) }, () => pick(messageRng, emojis)),
	)
	return [...chosenEmojis].flatMap((emoji) => {
		const reactors = new Set(
			Array.from({ length: int(messageRng, 1, 4) }, () => pick(messageRng, authorPool)),
		)
		return [...reactors].map((person) => ({
			id: stableId(`heavy-reaction:${index}:${person}:${emoji}`),
			messageId: message.id,
			channelId: channelId("firehose"),
			conversationId: null,
			userId: userId(person),
			emoji,
			createdAt,
		}))
	})
})

const statuses = ["online", "online", "away", "busy", "dnd", "offline", "offline"] as const
const presence: Row[] = people.map((person, index) => ({
	id: stableId(`presence:${person.key}`),
	userId: userId(person.key),
	status: index === 0 ? "online" : pick(messageRng, statuses),
	customMessage: null,
	statusEmoji: null,
	statusExpiresAt: null,
	activeChannelId: null,
	suppressNotifications: false,
	updatedAt: minutesAgo(5),
	lastSeenAt: minutesAgo(5),
}))

const ada = people[0]!

export const heavyDataset: Dataset = {
	name: "heavy",
	now,
	clerkOrgId: "org_hazel",
	currentUser: {
		id: userId("ada"),
		clerkUserId: "user_ada",
		organizationId: orgId,
		role: "owner",
		firstName: ada.firstName,
		lastName: ada.lastName,
		email: "ada@hazel.test",
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
		messages: [...firehoseMessages, ...spreadMessages],
		message_reactions: messageReactions,
		user_presence_status: presence,
	},
	rpc: {},
}

/** Handy references for scenarios. */
export const heavyIds = {
	orgSlug: "hazel",
	orgId,
	channel: channelId,
	user: userId,
	currentUserId: userId("ada"),
	bigChannelId: channelId("firehose"),
	smallChannelId: channelId("general"),
}
