import type { FixtureServer } from "../fixture-socket"
import type { PageFixture } from "../page-fixture"
import { adaUserId, FIXTURE_BASE_DATE, orgId, userRows } from "../snapshot"

/**
 * The integrations pages (`/hazel/settings/integrations/*`): Linear and GitHub connected, three
 * public bots in the marketplace (one by Ada, one installed), and Ada's own two bots.
 */

const at = (days: number) => new Date(Date.parse(FIXTURE_BASE_DATE) + days * 86_400_000).toISOString()
const id = (group: number, index: number) =>
	`${group.toString(16).padStart(8, "0")}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`

const grace = userRows[1]?.id ?? adaUserId

interface BotSeed {
	readonly n: number
	readonly name: string
	readonly description: string | null
	readonly isPublic: boolean
	readonly createdBy: string
	readonly scopes: ReadonlyArray<string>
	readonly installCount: number
}

const BOTS: ReadonlyArray<BotSeed> = [
	{
		n: 1,
		name: "Standup",
		description: "Collects async standups every morning and posts a summary to the team channel.",
		isPublic: true,
		createdBy: grace,
		scopes: ["messages:read", "messages:write", "channels:read"],
		installCount: 1284,
	},
	{
		n: 2,
		name: "Deploy Notifier",
		description: "Posts a message when a deploy starts, succeeds or fails.",
		isPublic: true,
		createdBy: adaUserId,
		scopes: ["messages:write"],
		installCount: 342,
	},
	{
		n: 3,
		name: "Polls",
		description: null,
		isPublic: true,
		createdBy: grace,
		scopes: ["messages:read", "messages:write", "message-reactions:write"],
		installCount: 57,
	},
	{
		n: 4,
		name: "Triage",
		description: "Labels new support threads and routes them to the right people.",
		isPublic: false,
		createdBy: adaUserId,
		scopes: ["messages:read", "channels:read", "users:read"],
		installCount: 1,
	},
]

const botUserId = (n: number) => id(0x30, n)
const botId = (n: number) => id(0x31, n)

const botUsers = BOTS.map((bot) => ({
	id: botUserId(bot.n),
	email: `bot-${bot.n}@bots.hazel.test`,
	firstName: bot.name,
	lastName: "",
	avatarUrl: null,
	userType: "machine",
	settings: null,
	isOnboarded: true,
	timezone: null,
	createdAt: at(-30 + bot.n),
	updatedAt: null,
	deletedAt: null,
}))

const botRows = BOTS.map((bot) => ({
	id: botId(bot.n),
	userId: botUserId(bot.n),
	createdBy: bot.createdBy,
	name: bot.name,
	description: bot.description,
	webhookUrl: null,
	scopes: bot.scopes,
	metadata: null,
	isPublic: bot.isPublic,
	installCount: bot.installCount,
	allowedIntegrations: null,
	mentionable: false,
	installRedirectUris: null,
	createdAt: at(-30 + bot.n),
	updatedAt: null,
	deletedAt: null,
}))

/** Standup and Triage are installed in the workspace. */
const installationRows = [1, 4].map((n) => ({
	id: id(0x32, n),
	botId: botId(n),
	organizationId: orgId,
	installedBy: adaUserId,
	installedAt: at(-10 + n),
	region: null,
}))

const connection = (n: number, provider: string, name: string) => ({
	id: id(0x33, n),
	provider,
	organizationId: orgId,
	userId: null,
	level: "organization",
	status: "active",
	externalAccountId: `acct-${n}`,
	externalAccountName: name,
	connectedBy: adaUserId,
	settings: null,
	metadata: null,
	errorMessage: null,
	lastUsedAt: null,
	createdAt: at(-20 + n),
	updatedAt: null,
	deletedAt: null,
})

export const seedIntegrations = (server: FixtureServer) => {
	server.write("org", orgId, "users", botUsers)
	server.write("org", orgId, "bots", botRows)
	server.write("org", orgId, "bot_installations", installationRows)
	server.write("org", orgId, "integration_connections", [
		connection(1, "linear", "Hazel Labs"),
		connection(2, "github", "hazel-labs"),
	])
}

/** `/hazel/settings/integrations`. */
const fixture: PageFixture = {
	seed: seedIntegrations,
	rpcs: { "channelWebhook.listByOrganization": () => ({ data: [] }) },
}

export default fixture
