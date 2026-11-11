import { BotId, ExternalChannelId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import type { Connection } from "../page/settings/chat-sync/model"
import type { ExternalChannel, Workspace } from "../page/settings/chat-sync/providers"
import type { Bot } from "../page/settings/integrations/shared/bots"
import { uuid } from "./pages-fixtures"

/** Fixtures for the chat sync and integrations page tests. */

export const syncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(20))
export const slackSyncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(21))
export const botId = Schema.decodeSync(BotId)(uuid(30))

export const connection: Connection = {
	id: syncConnectionId,
	provider: "discord",
	displayName: "Hazel Community",
	status: "active",
	externalWorkspaceId: "918273645500120",
	errorMessage: null,
	lastSyncedAtMs: null,
}

export const slackConnection: Connection = {
	id: slackSyncConnectionId,
	provider: "slack",
	displayName: "Acme Corp",
	status: "active",
	externalWorkspaceId: "T024BE7LD",
	errorMessage: null,
	lastSyncedAtMs: null,
}

export const guild: Workspace = { id: "918273645500901", name: "Design Systems Guild", owner: true }
export const otherGuild: Workspace = { id: "918273645500902", name: "Rust Hackers", owner: false }

/** The org's Slack install, as the Slack channels endpoint names it. */
export const slackWorkspace: Workspace = { id: "T024BE7LD", name: "Acme Corp", owner: false }

const slackChannel = (id: string, name: string): ExternalChannel => ({
	id: Schema.decodeSync(ExternalChannelId)(id),
	name,
	isPrivate: false,
	isMember: false,
})
export const slackChannels: ReadonlyArray<ExternalChannel> = [
	slackChannel("C01GENERAL", "general"),
	slackChannel("C02DESIGN", "design-reviews"),
	slackChannel("C03LAUNCH", "launch-room"),
]

export const bot: Bot = {
	id: botId,
	name: "Deploy Bot",
	description: "Ships builds from chat.",
	isPublic: true,
	scopes: ["messages:write"],
	allowedIntegrations: [],
	installRedirectUris: [],
	avatarUrl: null,
	installCount: 12,
}
