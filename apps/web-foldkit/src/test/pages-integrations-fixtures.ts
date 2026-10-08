import { BotId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import type { Connection } from "../page/settings/chat-sync/model"
import type { DiscordGuild } from "../page/settings/chat-sync/discord"
import type { Bot, PublicBot } from "../page/settings/integrations/shared/bots"
import { uuid } from "./pages-fixtures"

/** Fixtures for the chat sync and integrations page tests. */

export const syncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(20))
export const otherSyncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(21))
export const botId = Schema.decodeSync(BotId)(uuid(30))

export const connection: Connection = {
	id: syncConnectionId,
	displayName: "Hazel Community",
	status: "active",
	externalWorkspaceId: "918273645500120",
	errorMessage: null,
	lastSyncedAtMs: null,
}

export const guild: DiscordGuild = { id: "918273645500901", name: "Design Systems Guild", icon: null, owner: true }
export const otherGuild: DiscordGuild = { id: "918273645500902", name: "Rust Hackers", icon: null, owner: false }

export const bot: Bot = {
	id: botId,
	name: "Deploy Bot",
	description: "Ships builds from chat.",
	isPublic: true,
	scopes: ["messages:write"],
	allowedIntegrations: [],
	avatarUrl: null,
	installCount: 12,
}

export const publicBot: PublicBot = { ...bot, creatorName: "Ada Lovelace" }
