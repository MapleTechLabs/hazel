import type { Row } from "../../dataset.ts"
import { stableId } from "../../ids.ts"
import { asset, at, channelId, message, messageId, orgId, userId, type BotKey } from "./base.ts"

/**
 * Bot users and their messages: GitHub, Railway and OpenStatus webhook embeds, modelled on the
 * builders in `@hazel/integrations/*` (see `apps/web/src/routes/dev/embeds`), but with fixed
 * timestamps and icons served by the fixture backend. Plus a Discord-synced message.
 */

const bots: ReadonlyArray<{ key: BotKey; name: string; description: string }> = [
	{ key: "github", name: "GitHub", description: "Pull requests, pushes and CI runs" },
	{ key: "railway", name: "Railway", description: "Deployment notifications" },
	{ key: "openstatus", name: "OpenStatus", description: "Uptime monitoring" },
]

export const botUsers: Row[] = bots.map((bot) => ({
	id: userId(bot.key),
	externalId: `bot_${bot.key}`,
	email: `${bot.key}@bots.hazel.test`,
	firstName: bot.name,
	lastName: "",
	avatarUrl: asset(`avatars/${bot.key}-128x128.png`),
	userType: "machine",
	settings: null,
	isOnboarded: true,
	timezone: null,
	createdAt: at(-60, "12:00"),
	updatedAt: null,
	deletedAt: null,
}))

export const botRows: Row[] = bots.map((bot) => ({
	id: stableId(`rich:bot:${bot.key}`),
	userId: userId(bot.key),
	createdBy: userId("ada"),
	name: bot.name,
	description: bot.description,
	webhookUrl: null,
	apiTokenHash: `fixture-token-hash-${bot.key}`,
	scopes: null,
	metadata: null,
	isPublic: false,
	installCount: 1,
	allowedIntegrations: null,
	mentionable: false,
	createdAt: at(-60, "12:00"),
	updatedAt: null,
	deletedAt: null,
}))

const iso = (date: Date) => date.toISOString()
const githubFooter = { text: "hazel/app", iconUrl: asset("icons/github-64x64.png") }
const octocat = {
	name: "octocat",
	url: "https://github.com/octocat",
	iconUrl: asset("avatars/octocat-64x64.png"),
}

export const integrationMessages: Row[] = [
	message({
		key: "github:pr",
		channel: "github",
		author: "github",
		createdAt: at(0, "10:12"),
		content: "",
		embeds: [
			{
				title: "#41 Fix database connection pooling",
				description: "Resolved the connection leak that caused timeouts under high load.",
				url: "https://github.com/hazel/app/pull/41",
				color: 9000933,
				author: octocat,
				footer: githubFooter,
				fields: [
					{ name: "Diff", value: "{green:+89} {red:-23} (112 lines)", inline: true },
					{ name: "Labels", value: "[[bug]]", inline: true },
				],
				timestamp: iso(at(0, "10:12")),
				badge: { text: "Merged", color: 9000933 },
			},
		],
	}),
	message({
		key: "github:push",
		channel: "github",
		author: "github",
		createdAt: at(0, "11:40"),
		content: "",
		embeds: [
			{
				title: "hazel/app",
				description: "**3** commits pushed to [[feature/new-api]]",
				url: "https://github.com/hazel/app/compare/abc...xyz",
				color: 3056719,
				author: octocat,
				footer: { text: "GitHub", iconUrl: asset("icons/github-64x64.png") },
				fields: [
					{ name: "`abc1234`", value: "feat: add user authentication", inline: false },
					{ name: "`def2345`", value: "feat: add API endpoints", inline: false },
					{ name: "`ghi3456`", value: "test: add unit tests", inline: false },
				],
				timestamp: iso(at(0, "11:40")),
				badge: { text: "Push", color: 3056719 },
			},
		],
	}),
	message({
		key: "railway:crashed",
		channel: "deploys",
		author: "railway",
		createdAt: at(0, "12:05"),
		content: "",
		embeds: [
			{
				title: "worker-service in hazel-app",
				description: "Environment: [[info:production]]",
				color: 15680580,
				author: {
					name: "Railway",
					url: "https://railway.app",
					iconUrl: asset("icons/railway-64x64.png"),
				},
				footer: { text: "Hazel Team" },
				fields: [
					{ name: "Branch", value: "main", type: "badge", inline: true },
					{ name: "Commit", value: "`c7d9a2b` - refactor: update dependencies", inline: false },
					{
						name: "Severity",
						value: "ERROR",
						type: "badge",
						options: { intent: "danger" },
						inline: true,
					},
				],
				timestamp: iso(at(0, "12:05")),
				badge: { text: "Crashed", color: 15680580 },
			},
		],
	}),
	message({
		key: "railway:deployed",
		channel: "deploys",
		author: "railway",
		createdAt: at(0, "12:30"),
		content: "",
		embeds: [
			{
				title: "worker-service in hazel-app",
				description: "Environment: [[info:production]]",
				color: 2278750,
				author: {
					name: "Railway",
					url: "https://railway.app",
					iconUrl: asset("icons/railway-64x64.png"),
				},
				footer: { text: "Hazel Team" },
				fields: [
					{ name: "Branch", value: "main", type: "badge", inline: true },
					{ name: "Commit", value: "`d81e4f0` - fix: pin worker memory limit", inline: false },
				],
				timestamp: iso(at(0, "12:30")),
				badge: { text: "Deployed", color: 2278750 },
			},
		],
	}),
	message({
		key: "openstatus:down",
		channel: "status",
		author: "openstatus",
		createdAt: at(0, "13:02"),
		content: "",
		embeds: [
			{
				title: "Monitor Down",
				color: 15680580,
				author: { name: "Web Application", iconUrl: asset("icons/openstatus-64x64.png") },
				fields: [
					{ name: "URL", value: "https://app.example.com", inline: false },
					{ name: "Error", value: "Service Unavailable", inline: false },
				],
				timestamp: iso(at(0, "13:02")),
				badge: { text: "Error", color: 15680580 },
			},
		],
	}),
	message({
		key: "openstatus:recovered",
		channel: "status",
		author: "openstatus",
		createdAt: at(0, "13:09"),
		content: "",
		embeds: [
			{
				title: "Monitor Recovered",
				color: 2278750,
				author: { name: "Web Application", iconUrl: asset("icons/openstatus-64x64.png") },
				fields: [
					{ name: "URL", value: "https://app.example.com", inline: false },
					{ name: "Latency", value: "182ms", inline: true },
				],
				timestamp: iso(at(0, "13:09")),
				badge: { text: "Recovered", color: 2278750 },
			},
		],
	}),
	// URL shares (link previews, tweets, YouTube) need link-preview.hazel.sh or youtube.com, which
	// captures block, so #links only has a rich embed that renders from fixture assets.
	message({
		key: "links:embed",
		channel: "links",
		author: "grace",
		createdAt: at(0, "10:20"),
		content: "Rich embed with a thumbnail and an image, no network needed.",
		embeds: [
			{
				title: "Hazel 2.0 release notes",
				description: "Threads, custom emoji and a faster sync engine.",
				url: "https://hazel.sh/changelog/2-0",
				color: 7506394,
				author: { name: "Hazel Changelog", iconUrl: asset("icons/hazel-64x64.png") },
				thumbnail: { url: asset("embeds/thumbnail-160x160.png") },
				image: { url: asset("embeds/hero-800x400.png") },
				footer: { text: "hazel.sh" },
				timestamp: iso(at(0, "10:20")),
			},
		],
	}),
]

/** Discord bridge: one #launch message arrived from Discord. */
const connectionId = stableId("rich:chat-sync:discord")
const channelLinkId = stableId("rich:chat-sync:discord:launch")

export const chatSyncConnections: Row[] = [
	{
		id: connectionId,
		organizationId: orgId,
		integrationConnectionId: null,
		provider: "discord",
		externalWorkspaceId: "discord-guild-1",
		externalWorkspaceName: "Hazel Community",
		status: "active",
		settings: null,
		metadata: null,
		errorMessage: null,
		lastSyncedAt: at(0, "14:20"),
		createdBy: userId("ada"),
		createdAt: at(-20, "12:00"),
		updatedAt: null,
		deletedAt: null,
	},
]

export const chatSyncChannelLinks: Row[] = [
	{
		id: channelLinkId,
		syncConnectionId: connectionId,
		hazelChannelId: channelId("launch"),
		externalChannelId: "discord-channel-launch",
		externalChannelName: "launch",
		direction: "both",
		isActive: true,
		settings: null,
		lastSyncedAt: at(0, "14:20"),
		createdAt: at(-20, "12:00"),
		updatedAt: null,
		deletedAt: null,
	},
]

export const chatSyncMessageLinks: Row[] = [
	{
		id: stableId("rich:chat-sync:message:launch:discord"),
		channelLinkId,
		hazelMessageId: messageId("launch:discord"),
		externalMessageId: "discord-message-1",
		source: "external",
		rootHazelMessageId: null,
		rootExternalMessageId: null,
		hazelThreadChannelId: null,
		externalThreadId: null,
		lastSyncedAt: at(0, "14:20"),
		createdAt: at(0, "14:20"),
		updatedAt: null,
		deletedAt: null,
	},
]
