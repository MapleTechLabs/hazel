/**
 * A deterministic offline dataset in the sync wire encoding (ISO timestamps, plain string ids), served
 * by `./fixture-socket.ts` per source the way the Durable Objects would: `user:`, `org:`, `channel:`.
 */
import type {
	Channel,
	ChannelMember,
	ChannelSection,
	Message,
	MessageReaction,
	Notification,
	Organization,
	OrganizationMember,
	PinnedMessage,
	User,
	UserPresenceStatus,
} from "@hazel/domain/models"
import { SyncPageCursor, type SyncSourceKind, type SyncWindow } from "@hazel/domain/sync"
import {
	ChannelId,
	ChannelSectionId,
	MessageId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"

/** Every timestamp is an offset from this instant, so renders never depend on the clock. */
export const FIXTURE_BASE_DATE = "2026-11-06T09:00:00.000Z"
const BASE_MS = Date.parse(FIXTURE_BASE_DATE)
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

const iso = (offsetMs: number): string => new Date(BASE_MS + offsetMs).toISOString()

/** A version 4 UUID from a group number and an index, stable across runs. */
const uuid = (group: number, index: number): string =>
	`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`

type Wire<S extends Schema.Top> = S["Encoded"]

// ORG, USERS, SECTIONS, CHANNELS

export const orgId = Schema.decodeSync(OrganizationId)(uuid(1, 1))
const orgCreatedAt = iso(-120 * DAY)

type Role = Wire<typeof OrganizationMember.Schema>["role"]
type Status = Wire<typeof UserPresenceStatus.Schema>["status"]

const person = (n: number, firstName: string, lastName: string, role: Role, status: Status) => ({
	n,
	id: Schema.decodeSync(UserId)(uuid(2, n)),
	memberId: Schema.decodeSync(OrganizationMemberId)(uuid(3, n)),
	firstName,
	lastName,
	email: `${firstName.toLowerCase()}@hazel.test`,
	role,
	status,
	joinedAt: iso(-120 * DAY + n * DAY),
})
type Person = ReturnType<typeof person>

const ada = person(1, "Ada", "Lovelace", "owner", "online")
const grace = person(2, "Grace", "Hopper", "admin", "online")
const alan = person(3, "Alan", "Turing", "member", "away")
const katherine = person(4, "Katherine", "Johnson", "member", "busy")
const margaret = person(5, "Margaret", "Hamilton", "member", "online")
const dennis = person(6, "Dennis", "Ritchie", "member", "offline")
const PEOPLE = [ada, grace, alan, katherine, margaret, dennis]

export const adaUserId = ada.id
const adaMemberId = ada.memberId
const graceUserId = grace.id
const alanUserId = alan.id
const katherineUserId = katherine.id
const margaretUserId = margaret.id
const dennisUserId = dennis.id
const userIds = PEOPLE.map((p) => p.id)

const section = (n: number, name: string) => ({
	id: Schema.decodeSync(ChannelSectionId)(uuid(4, n)),
	name,
	order: n - 1,
})
const team = section(1, "Team")
const projects = section(2, "Projects")
const social = section(3, "Social")
const SECTIONS = [team, projects, social]
const sectionIds = SECTIONS.map((s) => s.id)

type ChannelType = Wire<typeof Channel.Schema>["type"]

const channel = (
	n: number,
	name: string,
	type: ChannelType,
	inSection: (typeof SECTIONS)[number] | null,
	others: ReadonlyArray<Person>,
	unread: number,
) => ({
	n,
	id: Schema.decodeSync(ChannelId)(uuid(5, n)),
	name,
	type,
	sectionId: inSection === null ? null : inSection.id,
	members: [ada, ...others],
	unread,
	createdAt: iso(-100 * DAY + n * DAY),
})

const everyone = [grace, alan, katherine, margaret, dennis]
const general = channel(1, "general", "public", team, everyone, 0)
const engineering = channel(2, "engineering", "public", team, [grace, alan, margaret, dennis], 0)
const support = channel(3, "support", "public", team, [grace, katherine], 0)
const leadership = channel(4, "leadership", "private", team, [grace], 0)
const design = channel(5, "design", "public", projects, [katherine, margaret], 3)
const productUpdates = channel(6, "product-updates", "public", projects, everyone, 0)
const releases = channel(7, "releases", "public", projects, [grace, alan, dennis], 1)
const random = channel(8, "random", "public", social, everyone, 0)
/** Ada's one to one DM with Grace. */
const graceDm = channel(9, "", "single", null, [grace], 2)
const CHANNELS = [
	general,
	engineering,
	support,
	leadership,
	design,
	productUpdates,
	releases,
	random,
	graceDm,
]

export const channelIds = CHANNELS.map((c) => c.id)
export const generalChannelId = general.id
const engineeringChannelId = engineering.id
const supportChannelId = support.id
const leadershipChannelId = leadership.id
export const designChannelId = design.id
const productUpdatesChannelId = productUpdates.id
const releasesChannelId = releases.id
const randomChannelId = random.id
const graceDmChannelId = graceDm.id

// ORG SOURCE ROWS

export const organizationRows: ReadonlyArray<Wire<typeof Organization.Schema>> = [
	{
		id: orgId,
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
		settings: null,
		isPublic: false,
		createdAt: orgCreatedAt,
		updatedAt: null,
		deletedAt: null,
	},
]

export const userRows: ReadonlyArray<Wire<typeof User.Schema>> = PEOPLE.map((p) => ({
	id: p.id,
	email: p.email,
	firstName: p.firstName,
	lastName: p.lastName,
	avatarUrl: null,
	userType: "user",
	settings: null,
	isOnboarded: true,
	timezone: "Europe/London",
	createdAt: p.joinedAt,
	updatedAt: null,
	deletedAt: null,
}))

export const organizationMemberRows: ReadonlyArray<Wire<typeof OrganizationMember.Schema>> = PEOPLE.map(
	(p) => ({
		id: p.memberId,
		organizationId: orgId,
		userId: p.id,
		role: p.role,
		nickname: null,
		joinedAt: p.joinedAt,
		invitedBy: p === ada ? null : ada.id,
		deletedAt: null,
		createdAt: p.joinedAt,
	}),
)

export const presenceRows: ReadonlyArray<Wire<typeof UserPresenceStatus.Schema>> = PEOPLE.map((p) => ({
	id: uuid(6, p.n),
	userId: p.id,
	status: p.status,
	customMessage: p === katherine ? "Heads down on the launch deck" : null,
	statusEmoji: p === katherine ? "🚀" : null,
	statusExpiresAt: null,
	activeChannelId: p === ada ? general.id : null,
	suppressNotifications: false,
	updatedAt: iso(-10 * MINUTE),
	lastSeenAt: iso(-(p.n - 1) * 37 * MINUTE),
}))

export const channelSectionRows: ReadonlyArray<Wire<typeof ChannelSection.Schema>> = SECTIONS.map((s) => ({
	id: s.id,
	organizationId: orgId,
	name: s.name,
	order: s.order,
	createdAt: orgCreatedAt,
	updatedAt: null,
	deletedAt: null,
}))

export const channelRows: ReadonlyArray<Wire<typeof Channel.Schema>> = CHANNELS.map((c) => ({
	id: c.id,
	name: c.name,
	icon: null,
	type: c.type,
	organizationId: orgId,
	parentChannelId: null,
	sectionId: c.sectionId,
	createdAt: c.createdAt,
	updatedAt: null,
	deletedAt: null,
}))

export const channelMemberRows: ReadonlyArray<Wire<typeof ChannelMember.Schema>> = CHANNELS.flatMap((c) =>
	c.members.map((p) => ({
		id: uuid(7, c.n * 16 + p.n),
		channelId: c.id,
		userId: p.id,
		isHidden: false,
		isMuted: false,
		mutedUntil: null,
		notificationLevel: null,
		isFavorite: p === ada && c === engineering,
		lastSeenMessageId: null,
		notificationCount: p === ada ? c.unread : 0,
		joinedAt: c.createdAt,
		createdAt: c.createdAt,
		deletedAt: null,
	})),
)

// USER SOURCE ROWS

export const userOrganizationRows: ReadonlyArray<{
	readonly organizationId: string
	readonly joinedAt: string
}> = [{ organizationId: orgId, joinedAt: orgCreatedAt }]

/** Ada's unread notifications: the sidebar counts them per targeted channel. */
export const notificationRows: ReadonlyArray<Wire<typeof Notification.Schema>> = CHANNELS.flatMap((c) =>
	Array.from({ length: c.unread }, (_, n) => ({
		id: uuid(8, c.n * 16 + n),
		memberId: ada.memberId,
		targetedResourceId: c.id,
		targetedResourceType: "channel",
		resourceId: uuid(9, 0x1000 + c.n * 16 + n),
		resourceType: "message",
		createdAt: iso(-(n + 1) * 45 * MINUTE),
		readAt: null,
		reason: c.type === "single" ? "direct_message" : "mention",
		silent: false,
	})),
)

// CHANNEL SOURCE ROWS: #general

const mention = (p: Person) => `@[userId:${p.id}]`

interface Extras {
	readonly reactions?: ReadonlyArray<readonly [Person, string]>
	readonly pinnedBy?: Person
	readonly replyToPrevious?: boolean
	readonly editedAfterMinutes?: number
}

/** `[author, minutes since the previous message, content, extras]`. */
const GENERAL: ReadonlyArray<readonly [Person, number, string, Extras?]> = [
	[ada, 0, "Morning all! Kicking off the week with the plan for the native client."],
	[grace, 2, "Morning! Excited about this one."],
	[alan, 1, "Same. Is the plan written up somewhere?"],
	[
		ada,
		3,
		"Yes, in the engineering doc. Short version: boot the real Foldkit app in Bun and render it natively.",
	],
	[katherine, 14, "Coffee machine on the second floor is fixed, for anyone who cares."],
	[margaret, 1, "I care deeply."],
	[
		dennis,
		22,
		"Pushed the first cut of the renderer. It draws text, boxes and borders, nothing fancy yet.",
		{
			reactions: [
				[ada, "🎉"],
				[grace, "🎉"],
				[alan, "👀"],
			],
		},
	],
	[
		grace,
		6,
		"Nice. A few things I noticed while trying it:\n\n1. Scrolling a long channel drops frames after a few hundred rows.\n2. Emoji fall back to a box glyph.\n3. Focus rings are missing on buttons.\n\nNone of these block a demo, but the first one will bite us in benchmarks.",
	],
	[dennis, 3, "Agreed on all three. Scrolling is next on my list.", { replyToPrevious: true }],
	[alan, 41, "Quick question: are we keeping the same sync protocol for native, or a separate API?"],
	[ada, 2, "Same protocol. The client is the real one, only the socket underneath changes."],
	[alan, 1, "Perfect, that keeps things simple."],
	[margaret, 55, `${mention(ada)} can you review the presence changes when you get a minute?`],
	[ada, 9, "On it."],
	[ada, 18, "Left a couple of comments, looks good otherwise."],
	[katherine, 120, "Lunch order is going out in 10 minutes, reply here if you want in."],
	[grace, 1, "In!"],
	[dennis, 1, "In, the usual please."],
	[alan, 2, "Skipping today, thanks."],
	[
		margaret,
		180,
		"Sharing the timing numbers from this morning's run:\n\n```ts\nconst results = {\n\tboot: 412,\n\tfirstPaint: 486,\n\tchannelReady: 731,\n}\n```\n\nMilliseconds, median of 20 runs on the M3.",
		{
			reactions: [
				[ada, "🔥"],
				[katherine, "🔥"],
			],
		},
	],
	[ada, 4, "That boot number is already better than the browser. Great work."],
	[dennis, 2, "Most of it is the token exchange, the rest is layout.", { editedAfterMinutes: 3 }],
	[grace, 300, "Reminder: the design review moves to Thursday this week."],
	[katherine, 6, "Thanks for the heads up."],
	[alan, 400, "Has anyone tried the new release notes page? https://hazel.test/changelog"],
	[margaret, 5, "Yes, the dark mode screenshots look sharp."],
	[ada, 2, "We should link it from the app menu too."],
	[alan, 1, "Filed it."],
	[dennis, 90, "Heads up: I'm rebasing the renderer branch, expect a force push in the next hour."],
	[grace, 70, "Thanks for warning us."],
	[
		katherine,
		240,
		"Long one, sorry. I went through the support inbox from last week and grouped what people asked about.\n\nMost questions were about notifications: people want quiet hours per channel, not only globally. A smaller group asked for better search inside threads.\n\nA handful of folks hit the same bug where the sidebar unread count stays after reading a channel on another device. I could reproduce it twice out of ten tries.\n\nI'll write tickets for all three today.",
	],
	[ada, 7, "This is super useful, thank you. The unread bug is ours, I'll take it."],
	[grace, 3, `+1, and ${mention(margaret)} might know where the read marker goes stale.`],
	[margaret, 11, "Pretty sure it's the read position racing the notification delete. Let me look."],
	[alan, 360, "Who's around for a quick sync on the release checklist?"],
	[dennis, 2, "Me"],
	[ada, 1, "Me too, give me five minutes."],
	[
		grace,
		35,
		"Notes from the sync: ship Wednesday, freeze Tuesday noon, Grace owns the changelog.",
		{ pinnedBy: ada },
	],
	[katherine, 600, "Good morning! It's snowing here, first time this year."],
	[margaret, 3, "Jealous. Still 15 degrees and grey."],
	[alan, 2, "Photos or it didn't happen."],
	[dennis, 140, "Renderer now handles scrolling at 120 fps on the long channel fixture."],
	[
		ada,
		1,
		"!!!",
		{
			reactions: [
				[ada, "🚀"],
				[grace, "🚀"],
				[alan, "🚀"],
				[margaret, "👏"],
			],
		},
	],
	[grace, 1, "That's a big jump. What changed?"],
	[
		dennis,
		4,
		"Two things: we stopped re-measuring rows that didn't change, and text shaping is cached per string and font. The second one did most of the work.",
	],
	[alan, 3, "Caching shaping makes sense, most rows repeat the same names and timestamps."],
	[margaret, 80, "Fixed the unread count bug, PR is up. It was the race I suspected."],
	[ada, 5, "Reviewing now.", { reactions: [[ada, "🙏"]] }],
	[ada, 20, "Approved. Thanks Margaret!"],
	[katherine, 200, "Does anyone have the login for the demo account? It's not in the vault."],
	[grace, 4, "Sent it to you directly."],
	[alan, 330, "Release candidate is up on the staging environment."],
	[margaret, 6, "Smoke tests pass on my side."],
	[dennis, 2, "Native build too."],
	[katherine, 120, `Release notes draft is ready for review ${mention(grace)}.`],
	[grace, 15, "Looks great, two small wording tweaks and it's good to go."],
	[
		ada,
		240,
		"Shipping it. Thanks everyone for a smooth week.",
		{
			reactions: [
				[grace, "🎉"],
				[katherine, "🎉"],
				[margaret, "❤️"],
			],
		},
	],
	[alan, 2, "🎉"],
	[margaret, 1, "Great work all."],
	[dennis, 3, "Off to update the benchmarks with the release build."],
]

const buildGeneral = () => {
	const messages: Array<Wire<typeof Message.Schema>> = []
	const reactions: Array<Wire<typeof MessageReaction.Schema>> = []
	const pins: Array<Wire<typeof PinnedMessage.Schema>> = []
	let at = -3 * DAY
	let previousId: string | null = null
	for (const [index, [author, gap, content, extras = {}]] of GENERAL.entries()) {
		at += gap * MINUTE
		const id = Schema.decodeSync(MessageId)(uuid(9, index + 1))
		messages.push({
			id,
			channelId: general.id,
			conversationId: null,
			authorId: author.id,
			content,
			embeds: null,
			replyToMessageId: extras.replyToPrevious === true ? previousId : null,
			threadChannelId: null,
			createdAt: iso(at),
			updatedAt:
				extras.editedAfterMinutes === undefined ? null : iso(at + extras.editedAfterMinutes * MINUTE),
			deletedAt: null,
		})
		for (const [p, emoji] of extras.reactions ?? []) {
			reactions.push({
				id: uuid(10, reactions.length + 1),
				messageId: id,
				channelId: general.id,
				conversationId: null,
				userId: p.id,
				emoji,
				createdAt: iso(at + (reactions.length + 1) * MINUTE),
			})
		}
		if (extras.pinnedBy !== undefined) {
			pins.push({
				id: uuid(11, pins.length + 1),
				channelId: general.id,
				messageId: id,
				pinnedBy: extras.pinnedBy.id,
				pinnedAt: iso(at + 5 * MINUTE),
			})
		}
		previousId = id
	}
	return { messages, reactions, pins }
}

const generalRows = buildGeneral()
export const generalMessageRows: ReadonlyArray<Wire<typeof Message.Schema>> = generalRows.messages
export const generalReactionRows: ReadonlyArray<Wire<typeof MessageReaction.Schema>> = generalRows.reactions
export const generalPinnedRows: ReadonlyArray<Wire<typeof PinnedMessage.Schema>> = generalRows.pins

// SOURCES

export type FixtureTables = Readonly<Record<string, ReadonlyArray<unknown>>>

/** The tables each source kind streams (the backend's `user-source.ts`, `org-source.ts`, `channel-source.ts`). */
export const SOURCE_TABLES = {
	user: ["notifications", "user_presence_status", "user_organizations"],
	org: [
		"organizations",
		"organization_members",
		"users",
		"user_presence_status",
		"bots",
		"bot_commands",
		"channels",
		"channel_members",
		"channel_sections",
		"custom_emojis",
		"bot_installations",
		"integration_connections",
		"chat_sync_connections",
		"chat_sync_channel_links",
		"connect_conversations",
		"connect_conversation_channels",
		"connect_participants",
	],
	channel: [
		"messages",
		"message_reactions",
		"pinned_messages",
		"attachments",
		"chat_sync_message_links",
		"typing_indicators",
	],
	// The native app has no Customers area.
	customers: [],
} as const satisfies Record<SyncSourceKind, ReadonlyArray<string>>

/** Tables a source pages (`Begin.windows`): a channel's `messages`. */
export const pagedTables = (kind: SyncSourceKind): ReadonlyArray<string> =>
	kind === "channel" ? ["messages"] : []

const withEmpty = (kind: SyncSourceKind, rows: FixtureTables): FixtureTables =>
	Object.fromEntries(SOURCE_TABLES[kind].map((table) => [table, rows[table] ?? []]))

/** Every table of `kind:sourceId` with its rows; `undefined` for a source the fixture does not know. */
export const snapshotFor = (kind: SyncSourceKind, sourceId: string): FixtureTables | undefined => {
	switch (kind) {
		case "user":
			return sourceId === ada.id
				? withEmpty("user", {
						notifications: notificationRows,
						user_presence_status: presenceRows.filter((row) => row.userId === ada.id),
						user_organizations: userOrganizationRows,
					})
				: undefined
		case "org":
			return sourceId === orgId
				? withEmpty("org", {
						organizations: organizationRows,
						organization_members: organizationMemberRows,
						users: userRows,
						user_presence_status: presenceRows,
						channels: channelRows,
						channel_members: channelMemberRows,
						channel_sections: channelSectionRows,
					})
				: undefined
		case "channel":
			if (sourceId === general.id)
				return withEmpty("channel", {
					messages: generalMessageRows,
					message_reactions: generalReactionRows,
					pinned_messages: generalPinnedRows,
				})
			return CHANNELS.some((c) => c.id === sourceId) ? withEmpty("channel", {}) : undefined
	}
}

const isCursor = Schema.is(SyncPageCursor)

/** Where a paged table's history starts: its oldest row, nothing older (`hasMore: false`). */
export const windowsFor = (kind: SyncSourceKind, tables: FixtureTables): ReadonlyArray<SyncWindow> =>
	pagedTables(kind).map((table) => {
		const oldest = (tables[table] ?? [])
			.filter(isCursor)
			.reduce<SyncPageCursor | null>(
				(min, row) =>
					min === null ||
					row.createdAt < min.createdAt ||
					(row.createdAt === min.createdAt && row.id < min.id)
						? { createdAt: row.createdAt, id: row.id }
						: min,
				null,
			)
		return { table, oldest, hasMore: false }
	})
