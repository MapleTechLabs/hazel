import { ChatSyncChannelLinkExistsError, ChatSyncChannelLinkResponse, ChatSyncConnectionExistsError, ChatSyncConnectionResponse } from "@hazel/domain/rpc"
import { ChannelId, ExternalChannelId, OrganizationId, SyncConnectionId, TransactionId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { Dataset } from "../dataset.ts"
import { defaultIds } from "./default.ts"
import { integrationsDataset } from "./integrations.ts"
import { channelLinkRows, chatSyncIds, connectionRows } from "./integrations-rpc.ts"

/**
 * The integrations workspace with Discord authorized: the add-connection and link-channel modals
 * list guilds and channels from the HTTP API. Creating answers per pick, so one dataset shows every
 * outcome: success, a typed "already exists" error, and a request that never settles (submitting).
 */

const now = integrationsDataset.now
const { orgId } = defaultIds

/** The community connection's guild (see `connectionRows`). */
const COMMUNITY_GUILD_ID = "918273645500120"

export const discordGuilds = {
	existing: { id: COMMUNITY_GUILD_ID, name: "Hazel Community", icon: null, owner: true },
	created: { id: "918273645500901", name: "Design Systems Guild", icon: null, owner: true },
	pending: { id: "918273645500902", name: "Weekend Gamers", icon: null, owner: false },
}

const discordChannel = (id: string, name: string) => ({
	id,
	guildId: COMMUNITY_GUILD_ID,
	name,
	type: 0,
	parentId: null,
})

/** `general` is already linked to #general (`channelLinkRows`), so linking it again fails. */
export const discordChannels = {
	existing: discordChannel("555000111222330", "general"),
	created: discordChannel("555000111222401", "announcements"),
	pending: discordChannel("555000111222402", "voice-chat-text"),
}

const transactionId = Schema.decodeSync(TransactionId)(1)
const field = (payload: unknown, key: string): unknown =>
	typeof payload === "object" && payload !== null && key in payload ? Reflect.get(payload, key) : undefined

const createConnection = (payload: unknown) => {
	const externalWorkspaceId = field(payload, "externalWorkspaceId")
	if (externalWorkspaceId === discordGuilds.pending.id) return Effect.never
	if (externalWorkspaceId === discordGuilds.existing.id)
		return Effect.fail(
			new ChatSyncConnectionExistsError({
				organizationId: Schema.decodeSync(OrganizationId)(orgId),
				provider: "discord",
				externalWorkspaceId: COMMUNITY_GUILD_ID,
			}),
		)
	const [row] = connectionRows(now)
	return new ChatSyncConnectionResponse({ data: row, transactionId })
}

const createChannelLink = (payload: unknown) => {
	const externalChannelId = field(payload, "externalChannelId")
	if (externalChannelId === discordChannels.pending.id) return Effect.never
	if (externalChannelId === discordChannels.existing.id)
		return Effect.fail(
			new ChatSyncChannelLinkExistsError({
				syncConnectionId: Schema.decodeSync(SyncConnectionId)(chatSyncIds.community),
				hazelChannelId: Schema.decodeSync(ChannelId)(String(field(payload, "hazelChannelId"))),
				externalChannelId: Schema.decodeSync(ExternalChannelId)(discordChannels.existing.id),
			}),
		)
	const [row] = channelLinkRows(now)
	return new ChatSyncChannelLinkResponse({ data: row, transactionId })
}

const resources = `/integrations/resources/${orgId}/discord`

export const chatSyncDiscordDataset: Dataset = {
	...integrationsDataset,
	name: "chat-sync-discord",
	rpc: {
		...integrationsDataset.rpc,
		"chatSync.connection.create": createConnection,
		"chatSync.channelLink.create": createChannelLink,
	},
	http: {
		[`GET ${resources}/guilds`]: () => ({ guilds: Object.values(discordGuilds) }),
		[`GET ${resources}/guilds/${COMMUNITY_GUILD_ID}/channels`]: () => ({
			channels: Object.values(discordChannels),
		}),
	},
}
