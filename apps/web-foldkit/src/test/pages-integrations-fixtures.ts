import { ExternalChannelId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import type { Connection } from "../page/settings/chat-sync/model"
import type { ExternalChannel } from "../page/settings/chat-sync/providers"
import { uuid } from "./pages-fixtures"

/** Fixtures for the chat sync page tests. */

export const syncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(20))
export const slackSyncConnectionId = Schema.decodeSync(SyncConnectionId)(uuid(21))

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
