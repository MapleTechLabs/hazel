/**
 * Where each old Postgres row goes in the new stores (`infra/durable-object-sync-plan.md` §1), for
 * `import-postgres.ts`. Pure: no database, no network, so it is unit-tested on fixture rows.
 *
 * `buildRouting` reads the small tables that decide ownership (channels, members, Connect, …);
 * `routeRow` then sends one source row to its owner and to each store holding a projection of it.
 * Not imported: `channel_access` (recomputed by the org's finalize), `typing_indicators`
 * (ephemeral) and `message_outbox_events` (gone).
 */
import { createHash } from "node:crypto"
import { Effect, Option } from "effect"
import { encodeImportRow, type ImportRow, type ImportStore, importTableOf } from "../lib/import-rows"

export type SourceRow = Readonly<Record<string, unknown>>

export type ImportTarget =
	| { readonly store: "directory" }
	| { readonly store: "org" | "channel" | "user"; readonly id: string }

export interface Routed {
	readonly target: ImportTarget
	readonly table: string
	readonly row: SourceRow
}

export const targetKey = (target: ImportTarget) =>
	target.store === "directory" ? "directory" : `${target.store}/${target.id}`

/** The source tables, in import order. */
export const IMPORT_PHASES = {
	directory: [
		"users",
		"auth_credentials",
		"auth_identifiers",
		"auth_sessions",
		"auth_pending",
		"auth_passkey_credentials",
		"auth_passkey_flows",
		"auth_oauth_flows",
		"auth_oauth_logins",
		"auth_oauth_identities",
		"auth_oauth_registrations",
		"yielded_browser_login",
		"bots",
		"bot_commands",
		"organization_invitations",
		"connect_invites",
	],
	org: [
		"organizations",
		"organization_members",
		"channels",
		"channel_members",
		"channel_sections",
		"custom_emojis",
		"bot_installations",
		"integration_connections",
		"integration_tokens",
		"integration_requests",
		"chat_sync_connections",
		"chat_sync_channel_links",
		"channel_webhooks",
		"github_subscriptions",
		"rss_subscriptions",
		"rss_posted_items",
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
		"chat_sync_event_receipts",
	],
	user: ["notifications", "user_presence_status"],
} as const satisfies Record<ImportStore, ReadonlyArray<string>>

/** The tables `buildRouting` reads in full before anything is routed. */
export const ROUTING_TABLES = [
	"channels",
	"organization_members",
	"integration_connections",
	"chat_sync_connections",
	"chat_sync_channel_links",
	"rss_subscriptions",
	"bot_installations",
	"connect_conversations",
	"connect_conversation_channels",
	"connect_participants",
] as const

export type RoutingSource = Partial<Record<(typeof ROUTING_TABLES)[number], ReadonlyArray<SourceRow>>>

export interface Routing {
	readonly channelOrg: ReadonlyMap<string, string>
	/** A Connect guest mount → its host channel (whose object holds the messages). */
	readonly hostChannel: ReadonlyMap<string, string>
	readonly integrationConnectionOrg: ReadonlyMap<string, string>
	readonly syncConnectionOrg: ReadonlyMap<string, string>
	readonly syncLinkChannel: ReadonlyMap<string, string>
	readonly rssSubscriptionOrg: ReadonlyMap<string, string>
	/** `organization_members.id` → its user (notifications name the member). */
	readonly memberUser: ReadonlyMap<string, string>
	/** The orgs holding a user's projection: active memberships, and Connect hosts. */
	readonly userOrgs: ReadonlyMap<string, ReadonlySet<string>>
	readonly botOrgs: ReadonlyMap<string, ReadonlySet<string>>
	readonly conversationHost: ReadonlyMap<string, string>
	/** The orgs that mount a conversation (the host's own included). */
	readonly conversationOrgs: ReadonlyMap<string, ReadonlySet<string>>
}

const str = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined

const isLive = (row: SourceRow) => row.deletedAt === null || row.deletedAt === undefined

const addTo = (map: Map<string, Set<string>>, key: string | undefined, value: string | undefined) => {
	if (key === undefined || value === undefined) return
	const set = map.get(key) ?? new Set<string>()
	set.add(value)
	map.set(key, set)
}

const index = (rows: ReadonlyArray<SourceRow> | undefined, key: string, value: string) => {
	const map = new Map<string, string>()
	for (const row of rows ?? []) {
		const k = str(row[key])
		const v = str(row[value])
		if (k !== undefined && v !== undefined) map.set(k, v)
	}
	return map
}

export const buildRouting = (source: RoutingSource): Routing => {
	const conversationHost = index(source.connect_conversations, "id", "hostOrganizationId")
	const conversationHostChannel = index(source.connect_conversations, "id", "hostChannelId")

	const hostChannel = new Map<string, string>()
	const conversationOrgs = new Map<string, Set<string>>()
	for (const [conversationId, orgId] of conversationHost) addTo(conversationOrgs, conversationId, orgId)
	for (const mount of source.connect_conversation_channels ?? []) {
		const conversationId = str(mount.conversationId)
		addTo(conversationOrgs, conversationId, str(mount.organizationId))
		const host = conversationId === undefined ? undefined : conversationHostChannel.get(conversationId)
		const channelId = str(mount.channelId)
		if (mount.role === "guest" && host !== undefined && channelId !== undefined && channelId !== host) {
			hostChannel.set(channelId, host)
		}
	}

	const userOrgs = new Map<string, Set<string>>()
	for (const member of source.organization_members ?? []) {
		if (isLive(member)) addTo(userOrgs, str(member.userId), str(member.organizationId))
	}
	for (const participant of source.connect_participants ?? []) {
		const conversationId = str(participant.conversationId)
		if (!isLive(participant) || conversationId === undefined) continue
		addTo(userOrgs, str(participant.userId), conversationHost.get(conversationId))
	}

	const botOrgs = new Map<string, Set<string>>()
	for (const install of source.bot_installations ?? []) {
		addTo(botOrgs, str(install.botId), str(install.organizationId))
	}

	return {
		channelOrg: index(source.channels, "id", "organizationId"),
		hostChannel,
		integrationConnectionOrg: index(source.integration_connections, "id", "organizationId"),
		syncConnectionOrg: index(source.chat_sync_connections, "id", "organizationId"),
		syncLinkChannel: index(source.chat_sync_channel_links, "id", "hazelChannelId"),
		rssSubscriptionOrg: index(source.rss_subscriptions, "id", "organizationId"),
		memberUser: index(source.organization_members, "id", "userId"),
		userOrgs,
		botOrgs,
		conversationHost,
		conversationOrgs,
	}
}

const directory: ImportTarget = { store: "directory" }
const org = (id: string | undefined): ReadonlyArray<ImportTarget> =>
	id === undefined ? [] : [{ store: "org", id }]
const orgs = (ids: ReadonlySet<string> | undefined): ReadonlyArray<ImportTarget> =>
	[...(ids ?? [])].map((id) => ({ store: "org" as const, id }))

/** The object holding a channel's messages: its host channel for a Connect guest mount. */
const channelOf = (routing: Routing, channelId: string | undefined): ReadonlyArray<ImportTarget> => {
	if (channelId === undefined) return []
	return [{ store: "channel", id: routing.hostChannel.get(channelId) ?? channelId }]
}

const at = (targets: ReadonlyArray<ImportTarget>, table: string, row: SourceRow): ReadonlyArray<Routed> =>
	targets.map((target) => ({ target, table, row }))

/** A participant's id is derived (`org/connect.ts` `participantIdFor`), so every side agrees on it. */
export const participantIdFor = (conversationId: string, userId: string): string => {
	const hex = createHash("sha256").update(`connect:${conversationId}:${userId}`).digest("hex").slice(0, 32)
	const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Every place one source row is written to. Unknown tables and unroutable rows give `[]`. */
export const routeRow = (routing: Routing, table: string, row: SourceRow): ReadonlyArray<Routed> => {
	const orgId = str(row.organizationId)
	switch (table) {
		case "users":
			return [
				...at([directory], table, row),
				...at(orgs(routing.userOrgs.get(str(row.id) ?? "")), table, row),
			]
		case "bots":
			return [
				...at([directory], table, row),
				...at(orgs(routing.botOrgs.get(str(row.id) ?? "")), table, row),
			]
		case "bot_commands":
			return [
				...at([directory], table, row),
				...at(orgs(routing.botOrgs.get(str(row.botId) ?? "")), table, row),
			]
		case "auth_credentials":
		case "auth_identifiers":
		case "auth_sessions":
		case "auth_pending":
		case "auth_passkey_credentials":
		case "auth_passkey_flows":
		case "auth_oauth_flows":
		case "auth_oauth_logins":
		case "auth_oauth_identities":
		case "auth_oauth_registrations":
		case "yielded_browser_login":
		case "organization_invitations":
		case "connect_invites":
			return at([directory], table, row)

		case "organizations":
			return at(org(str(row.id)), table, row)
		case "organization_members": {
			const userId = str(row.userId)
			const memberships =
				isLive(row) && userId !== undefined && orgId !== undefined
					? at([{ store: "user", id: userId }], "user_organizations", { organizationId: orgId })
					: []
			return [...at(org(orgId), table, row), ...memberships]
		}
		case "channels":
		case "channel_sections":
		case "custom_emojis":
		case "bot_installations":
		case "integration_connections":
		case "integration_requests":
		case "chat_sync_connections":
		case "channel_webhooks":
		case "github_subscriptions":
		case "rss_subscriptions":
			return at(org(orgId), table, row)
		case "channel_members":
			return at(org(routing.channelOrg.get(str(row.channelId) ?? "")), table, row)
		case "integration_tokens":
			return at(org(routing.integrationConnectionOrg.get(str(row.connectionId) ?? "")), table, row)
		case "chat_sync_channel_links":
			return at(org(routing.syncConnectionOrg.get(str(row.syncConnectionId) ?? "")), table, row)
		case "rss_posted_items":
			return at(org(routing.rssSubscriptionOrg.get(str(row.subscriptionId) ?? "")), table, row)
		case "connect_conversations":
			return at(orgs(routing.conversationOrgs.get(str(row.id) ?? "")), table, row)
		case "connect_conversation_channels": {
			const host = routing.conversationHost.get(str(row.conversationId) ?? "")
			return at(orgs(new Set([host, orgId].filter((id) => id !== undefined))), table, row)
		}
		case "connect_participants": {
			const conversationId = str(row.conversationId)
			const userId = str(row.userId)
			if (conversationId === undefined || userId === undefined) return []
			const withId = { ...row, id: participantIdFor(conversationId, userId) }
			return at(org(routing.conversationHost.get(conversationId)), table, withId)
		}

		case "messages":
		case "message_reactions":
		case "pinned_messages":
		case "attachments":
			return at(channelOf(routing, str(row.channelId)), table, row)
		case "chat_sync_message_links":
		case "chat_sync_event_receipts":
			return at(
				channelOf(routing, routing.syncLinkChannel.get(str(row.channelLinkId) ?? "")),
				table,
				row,
			)

		case "notifications": {
			const userId = routing.memberUser.get(str(row.memberId) ?? "")
			return userId === undefined ? [] : at([{ store: "user", id: userId }], table, row)
		}
		case "user_presence_status": {
			const userId = str(row.userId)
			if (userId === undefined) return []
			return [
				...at([{ store: "user", id: userId }], table, row),
				...at(orgs(routing.userOrgs.get(userId)), table, row),
			]
		}
		default:
			return []
	}
}

/** A routed row in its target table's encoded form; `None` when the table rejects it. */
export const encodeRouted = (routed: Routed): Effect.Effect<Option.Option<ImportRow>> => {
	const table = importTableOf(routed.target.store, routed.table)
	if (Option.isNone(table)) return Effect.succeedNone
	return encodeImportRow(table.value, routed.row).pipe(
		Effect.map(Option.some),
		Effect.catchTag("SchemaError", () => Effect.succeedNone),
	)
}
