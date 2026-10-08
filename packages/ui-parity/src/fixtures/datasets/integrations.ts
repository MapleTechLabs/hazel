import type { Dataset, Row } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"
import { integrationsRpc } from "./integrations-rpc.ts"

/**
 * The default workspace plus rich settings data: custom emojis, an active Linear connection,
 * bots (created, installed, public), connected organizations, chat sync and webhooks.
 * Kept out of `default` so existing captures never change.
 */

const now = defaultDataset.now
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000)
const { orgId, user } = defaultIds

/** 64 characters, the maximum the emoji name field accepts. */
export const LONG_EMOJI_NAME = "extremely_long_custom_emoji_name_that_fills_every_allowed_slot64"
export const LONG_CHANNEL_NAME =
	"product-roadmap-and-quarterly-planning-for-the-entire-organization-across-every-team-2026"
export const LONG_BOT_NAME = "Release Train Coordinator With An Unusually Long Application Name"

const emojiSvg = (fill: string, glyph: string) =>
	`data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${fill}"/><text x="16" y="22" font-size="16" text-anchor="middle" fill="#fff" font-family="sans-serif">${glyph}</text></svg>`,
	)}`

const customEmojis: Row[] = [
	{ key: "party_parrot", by: "ada", days: 2, fill: "#16a34a", glyph: "P" },
	{ key: "shipit", by: "grace", days: 9, fill: "#2563eb", glyph: "S" },
	{ key: LONG_EMOJI_NAME, by: "ada", days: 40, fill: "#9333ea", glyph: "L" },
].map((emoji) => ({
	id: stableId(`emoji:${emoji.key}`),
	organizationId: orgId,
	name: emoji.key,
	imageUrl: emojiSvg(emoji.fill, emoji.glyph),
	createdBy: user(emoji.by as "ada" | "grace"),
	createdAt: daysAgo(emoji.days),
	updatedAt: null,
	deletedAt: null,
}))

const integrationConnections: Row[] = [
	{
		id: stableId("integration:linear"),
		provider: "linear",
		organizationId: orgId,
		userId: null,
		level: "organization",
		status: "active",
		externalAccountId: "lin_hazel",
		externalAccountName: "Hazel Labs workspace",
		connectedBy: user("ada"),
		settings: null,
		metadata: null,
		errorMessage: null,
		lastUsedAt: daysAgo(1),
		createdAt: daysAgo(30),
		updatedAt: null,
		deletedAt: null,
	},
]

const botDefs = [
	{
		key: "deploy",
		name: "Deploy Bot",
		description: "Posts deploy status and rollbacks to the channels you choose.",
		by: "ada",
		isPublic: true,
		installCount: 1284,
		scopes: ["messages:read", "messages:write", "channels:read"],
	},
	{
		key: "standup",
		name: "Standup Helper",
		description: null,
		by: "ada",
		isPublic: false,
		installCount: 0,
		scopes: [],
	},
	{
		key: "release",
		name: LONG_BOT_NAME,
		description:
			"Coordinates release trains across every team, collects sign-offs, posts the changelog and reminds owners about blockers until the train leaves the station.",
		by: "ada",
		isPublic: true,
		installCount: 37,
		scopes: ["messages:write"],
	},
	{
		key: "triage",
		name: "Triage Assistant",
		description: "Labels incoming bug reports and routes them to the right team.",
		by: "grace",
		isPublic: true,
		installCount: 512,
		scopes: ["messages:read", "channels:read"],
	},
] as const

const botUserId = (key: string) => stableId(`user:bot:${key}`)

const botUsers: Row[] = botDefs.map((bot) => ({
	id: botUserId(bot.key),
	externalId: `bot_${bot.key}`,
	email: `${bot.key}@bots.hazel.test`,
	firstName: bot.name,
	lastName: "",
	avatarUrl: null,
	userType: "machine",
	settings: null,
	isOnboarded: true,
	timezone: "UTC",
	createdAt: daysAgo(20),
	updatedAt: null,
	deletedAt: null,
}))

const bots: Row[] = botDefs.map((bot, index) => ({
	id: stableId(`bot:${bot.key}`),
	userId: botUserId(bot.key),
	createdBy: user(bot.by),
	name: bot.name,
	description: bot.description,
	webhookUrl: null,
	apiTokenHash: "parity-hash",
	scopes: [...bot.scopes],
	metadata: null,
	isPublic: bot.isPublic,
	installCount: bot.installCount,
	allowedIntegrations: null,
	mentionable: true,
	createdAt: daysAgo(20 - index),
	updatedAt: null,
	deletedAt: null,
}))

const botInstallations: Row[] = (["deploy", "triage"] as const).map((key) => ({
	id: stableId(`bot-installation:${key}`),
	botId: stableId(`bot:${key}`),
	organizationId: orgId,
	installedBy: user("ada"),
	installedAt: daysAgo(5),
}))

/** Other workspaces that appear as connect partners and invite senders. */
export const partnerOrgs = [
	{ key: "acme", name: "Acme Corporation", slug: "acme" },
	{ key: "globex", name: "Globex", slug: "globex" },
	{ key: "initech", name: "Initech", slug: "initech" },
] as const
export const partnerOrgId = (key: (typeof partnerOrgs)[number]["key"]) => stableId(`org:${key}`)

const organizations: Row[] = [
	...(defaultDataset.tables.organizations ?? []),
	...partnerOrgs.map((org) => ({
		id: partnerOrgId(org.key),
		name: org.name,
		slug: org.slug,
		logoUrl: null,
		settings: null,
		isPublic: false,
		createdAt: daysAgo(200),
		updatedAt: null,
		deletedAt: null,
	})),
]

/** #design is shared with Acme. */
const sharedConversationId = stableId("connect-conversation:design-acme")
const connectConversationChannels: Row[] = [
	{ key: "hazel", organizationId: orgId, channelId: defaultIds.channel("design"), role: "host" },
	{ key: "acme", organizationId: partnerOrgId("acme"), channelId: stableId("channel:acme:design"), role: "guest" },
].map((mount) => ({
	id: stableId(`connect-mount:${mount.key}`),
	conversationId: sharedConversationId,
	organizationId: mount.organizationId,
	channelId: mount.channelId,
	role: mount.role,
	allowGuestMemberAdds: false,
	isActive: true,
	createdAt: daysAgo(12),
	updatedAt: null,
	deletedAt: null,
}))

export const longChannelId = stableId("channel:long-name")
const channels: Row[] = [
	...(defaultDataset.tables.channels ?? []),
	{
		id: longChannelId,
		name: LONG_CHANNEL_NAME,
		icon: null,
		type: "public",
		organizationId: orgId,
		parentChannelId: null,
		sectionId: null,
		createdAt: daysAgo(10),
		updatedAt: null,
		deletedAt: null,
	},
]

export const integrationsTables: Dataset["tables"] = {
	...defaultDataset.tables,
	users: [...(defaultDataset.tables.users ?? []), ...botUsers],
	organizations,
	channels,
	custom_emojis: customEmojis,
	integration_connections: integrationConnections,
	bots,
	bot_installations: botInstallations,
	connect_conversation_channels: connectConversationChannels,
}

export const integrationsDataset: Dataset = {
	...defaultDataset,
	name: "integrations",
	tables: integrationsTables,
	rpc: integrationsRpc(now),
}
