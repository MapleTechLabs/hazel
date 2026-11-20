/**
 * Suggested customer links, on the `OrgObject` side (`docs/customers/channels.md`). The org's
 * `CustomersObject` asks, never streams:
 *
 * - `org.channelEvidence`: for each live `public` / `private` channel, where it comes from (a
 *   Connect share, a Slack or Discord mirror, or Hazel), the provider workspaces behind it, and
 *   the people from outside the org seen in it (Connect guests with their email, Slack Connect
 *   authors from `chat_sync_channel_authors`).
 * - `org.visibleChannels`: which of some channels a member sees (`channel_access`), so suggestion
 *   reads never name a channel the caller cannot see.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	ChannelEvidence,
	EvidenceMember,
	type EvidenceWorkspace,
	MAX_EVIDENCE_MEMBERS,
	workspaceKey,
} from "@hazel/domain/customers"
import { ChannelId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { defineCall } from "../calls"
import { inList } from "../customers/sql"

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export const ChannelEvidenceCall = defineCall("org.channelEvidence", "org", {
	payload: Schema.Struct({
		organizationId: OrganizationId,
		/** Only these channels; absent: every linkable channel of the org. */
		channelIds: Schema.optionalKey(Schema.Array(ChannelId)),
		/**
		 * Only channels with one of these workspaces (`workspaceKey`): a channel-scoped refresh asks
		 * this for the linked channels that could be its siblings, not for every linked channel.
		 */
		workspaceKeys: Schema.optionalKey(Schema.Array(Schema.String)),
	}),
	success: Schema.Array(ChannelEvidence),
	error: Schema.Never,
})

const LINKABLE_TYPES = ["public", "private"] as const

type Provider = "slack" | "discord"
const isProvider = (value: string): value is Provider => value === "slack" || value === "discord"

/** A person seen in a channel, with when (most recent first wins the cap). */
interface Seen {
	readonly member: EvidenceMember
	readonly at: number
}

export const channelEvidence = Effect.fn("OrgObject.channelEvidence")(function* (payload: {
	readonly organizationId: OrganizationId
	readonly channelIds?: ReadonlyArray<ChannelId>
	readonly workspaceKeys?: ReadonlyArray<string>
}) {
	const db = yield* Database.Database
	const { organizationId } = payload
	if (payload.channelIds?.length === 0 || payload.workspaceKeys?.length === 0) return []
	const allChannels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id", "name")
			.where(($) => [
				$.organizationId.eq(organizationId),
				$.deletedAt.isNull(),
				$.type.in_(...LINKABLE_TYPES),
				payload.channelIds === undefined ? undefined : inList($.id, payload.channelIds),
			])
			.orderBy(($) => [[$.id, "asc"]]),
	)
	if (allChannels.length === 0) return []
	const allIds = allChannels.map((channel) => channel.id)

	// Active chat-sync links and their connection's workspace.
	const links = yield* db.run(
		SQLite.from(schema.chatSyncChannelLinksTable, "link")
			.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
				connection.id.eq(link.syncConnectionId),
			)
			.select(($) => ({
				channelId: $.hazelChannelId,
				provider: $.connection.provider,
				workspaceId: $.connection.externalWorkspaceId,
				workspaceName: $.connection.externalWorkspaceName,
				linkId: $.id,
			}))
			.where(($) => [
				$.isActive.eq(true),
				$.deletedAt.isNull(),
				$.connection.organizationId.eq(organizationId),
				$.connection.deletedAt.isNull(),
				inList($.hazelChannelId, allIds),
			])
			.orderBy(($) => [[$.createdAt, "asc"]]),
	)
	const linksOf = new Map<ChannelId, Array<{ provider: Provider; id: string; name: string | null }>>()
	for (const link of links) {
		if (!isProvider(link.provider)) continue
		const list = linksOf.get(link.channelId) ?? []
		list.push({ provider: link.provider, id: link.workspaceId, name: link.workspaceName })
		linksOf.set(link.channelId, list)
	}

	// Slack authors from another team than the org's own, only of channels with a live Slack link
	// (rows outlive their link). The org's own teams are filtered out in SQL.
	const slackLinked = [...linksOf].flatMap(([channelId, list]) =>
		list.some((link) => link.provider === "slack") ? [channelId] : [],
	)
	// Only authors seen through a live Slack mirror: a replaced mirror's authors stay behind.
	const liveSlackLinks = links.flatMap((link) => (link.provider === "slack" ? [link.linkId] : []))
	const ownTeams = [
		...new Set(links.flatMap((link) => (link.provider === "slack" ? [link.workspaceId] : []))),
	]
	const authorRows =
		slackLinked.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.chatSyncChannelAuthorsTable)
						.select("hazelChannelId", "externalWorkspaceId", "email", "lastSeenAt")
						.where(($) => [
							$.provider.eq("slack"),
							inList($.syncChannelLinkId, liveSlackLinks),
							$.externalWorkspaceId.isNotNull(),
							SQLite.sql
								.cond`${$.externalWorkspaceId} NOT IN (SELECT value FROM json_each(${JSON.stringify(ownTeams)}))`,
							inList($.hazelChannelId, slackLinked),
						])
						.orderBy(($) => [[$.lastSeenAt, "desc"]]),
				)
	const authors = authorRows
	const externalTeamsOf = new Map<ChannelId, Set<string>>()
	for (const author of authors) {
		if (author.externalWorkspaceId === null) continue
		const teams = externalTeamsOf.get(author.hazelChannelId) ?? new Set<string>()
		teams.add(author.externalWorkspaceId)
		externalTeamsOf.set(author.hazelChannelId, teams)
	}

	const workspacesOf = (channelId: ChannelId) => {
		const workspaces = new Map<string, EvidenceWorkspace>()
		for (const link of linksOf.get(channelId) ?? []) {
			workspaces.set(workspaceKey(link.provider, link.id), {
				provider: link.provider,
				id: link.id,
				name: link.name,
				external: false,
			})
		}
		for (const team of externalTeamsOf.get(channelId) ?? []) {
			const key = workspaceKey("slack", team)
			if (!workspaces.has(key)) {
				workspaces.set(key, { provider: "slack", id: team, name: null, external: true })
			}
		}
		return workspaces
	}
	const wanted = payload.workspaceKeys === undefined ? undefined : new Set(payload.workspaceKeys)
	const channels = allChannels.flatMap((channel) => {
		const workspaces = workspacesOf(channel.id)
		return wanted === undefined || [...workspaces.keys()].some((key) => wanted.has(key))
			? [{ ...channel, workspaces: [...workspaces.values()] }]
			: []
	})
	yield* Effect.annotateCurrentSpan({ "evidence.channels": channels.length })
	if (channels.length === 0) return []
	const ids = channels.map((channel) => channel.id)

	// Connect mounts (host or guest) of these channels.
	const mounts = yield* db.run(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("channelId", "conversationId", "role")
			.where(($) => [
				$.organizationId.eq(organizationId),
				$.isActive.eq(true),
				$.deletedAt.isNull(),
				inList($.channelId, ids),
			]),
	)
	const conversationChannel = new Map(mounts.map((mount) => [mount.conversationId, mount.channelId]))
	// A guest mount's people are the host's participants: the conversation snapshot names its host.
	const guestMounts = mounts.filter((mount) => mount.role === "guest")
	const hosts =
		guestMounts.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.connectConversationsTable)
						.select("id", "hostOrganizationId")
						.where(($) => [
							inList(
								$.id,
								guestMounts.map((mount) => mount.conversationId),
							),
							$.deletedAt.isNull(),
						]),
				)
	const hostOf = new Map(hosts.map((row) => [row.id, row.hostOrganizationId] as const))
	const guestOf = new Map(
		guestMounts.flatMap((mount) => {
			const hostOrganizationId = hostOf.get(mount.conversationId)
			return hostOrganizationId === undefined || hostOrganizationId === organizationId
				? []
				: [[mount.channelId, { hostOrganizationId, conversationId: mount.conversationId }] as const]
		}),
	)

	// Connect participants from another org. `isExternal` is relative to the host (true: a guest
	// org's reader), so "not from this org" is `homeOrganizationId`, right on either side.
	const conversationIds = [...conversationChannel.keys()]
	const participants =
		conversationIds.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.connectParticipantsTable, "p")
						.innerJoin(schema.usersTable, "u", (p, u) => u.id.eq(p.userId))
						.select(($) => ({
							conversationId: $.conversationId,
							userId: $.userId,
							email: $.u.email,
							updatedAt: $.updatedAt,
						}))
						.where(($) => [
							inList($.conversationId, conversationIds),
							$.deletedAt.isNull(),
							$.homeOrganizationId.neq(organizationId),
							$.u.userType.eq("user"),
							$.u.deletedAt.isNull(),
						])
						.orderBy(($) => [[$.updatedAt, "desc"]]),
				)

	const seenOf = new Map<ChannelId, Array<Seen>>()
	const see = (channelId: ChannelId, seen: Seen) => {
		const list = seenOf.get(channelId) ?? []
		list.push(seen)
		seenOf.set(channelId, list)
	}
	const participantSeen = new Set<string>()
	for (const row of participants) {
		const channelId = conversationChannel.get(row.conversationId)
		if (channelId === undefined || participantSeen.has(`${channelId}:${row.userId}`)) continue
		participantSeen.add(`${channelId}:${row.userId}`)
		const email = row.email.trim().toLowerCase()
		see(channelId, {
			member: { source: "connect", email: email.length > 0 ? email : null },
			at: row.updatedAt.getTime(),
		})
	}
	for (const author of authors) {
		see(author.hazelChannelId, {
			member: { source: "slack", email: author.email },
			at: author.lastSeenAt.getTime(),
		})
	}

	const connected = new Set(mounts.map((mount) => mount.channelId))
	return channels.map((channel): ChannelEvidence => {
		const all = (seenOf.get(channel.id) ?? []).sort((a, b) => b.at - a.at)
		const seen = all.slice(0, MAX_EVIDENCE_MEMBERS)
		const entry: ChannelEvidence = {
			externalMemberCount: all.length,
			channelId: channel.id,
			channelName: channel.name,
			origin: connected.has(channel.id)
				? "connect"
				: (linksOf.get(channel.id)?.[0]?.provider ?? "hazel"),
			workspaces: channel.workspaces,
			externalMembers: seen.map((member) => member.member),
		}
		const guest = guestOf.get(channel.id)
		return guest === undefined ? entry : { ...entry, connect: guest }
	})
}, Effect.orDie)

// ---------------------------------------------------------------------------
// A guest org's Connect channel, answered by the host
// ---------------------------------------------------------------------------

export const ConnectGuestEvidenceCall = defineCall("org.connectGuestEvidence", "org", {
	payload: Schema.Struct({
		/** This org: the conversations' host. */
		organizationId: OrganizationId,
		guestOrganizationId: OrganizationId,
		conversationIds: Schema.Array(ConnectConversationId),
	}),
	success: Schema.Array(
		Schema.Struct({
			conversationId: ConnectConversationId,
			/** At most `MAX_EVIDENCE_MEMBERS`, most recently updated first. */
			members: Schema.Array(EvidenceMember),
			/** Every such participant, the sample or not. */
			memberCount: Schema.Finite,
		}),
	),
	error: Schema.Never,
})

/**
 * The people of conversations this org hosts, as seen from a guest org: participants from any org
 * but the guest. Only for conversations the guest has an active mount on (anything else is
 * answered with nothing), so an org learns only about shares it is part of.
 */
export const connectGuestEvidence = Effect.fn("OrgObject.connectGuestEvidence")(function* (payload: {
	readonly organizationId: OrganizationId
	readonly guestOrganizationId: OrganizationId
	readonly conversationIds: ReadonlyArray<ConnectConversationId>
}) {
	if (payload.conversationIds.length === 0) return []
	const db = yield* Database.Database
	const hosted = yield* db.run(
		SQLite.from(schema.connectConversationsTable)
			.select("id")
			.where(($) => [
				$.hostOrganizationId.eq(payload.organizationId),
				$.deletedAt.isNull(),
				inList($.id, payload.conversationIds),
			]),
	)
	const mounted = yield* db.run(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("conversationId")
			.where(($) => [
				$.organizationId.eq(payload.guestOrganizationId),
				$.role.eq("guest"),
				$.isActive.eq(true),
				$.deletedAt.isNull(),
				inList(
					$.conversationId,
					hosted.map((row) => row.id),
				),
			]),
	)
	const conversationIds = [...new Set(mounted.map((row) => row.conversationId))]
	yield* Effect.annotateCurrentSpan({ "evidence.conversations": conversationIds.length })
	if (conversationIds.length === 0) return []
	const participants = yield* db.run(
		SQLite.from(schema.connectParticipantsTable, "p")
			.innerJoin(schema.usersTable, "u", (p, u) => u.id.eq(p.userId))
			.select(($) => ({ conversationId: $.conversationId, userId: $.userId, email: $.u.email }))
			.where(($) => [
				inList($.conversationId, conversationIds),
				$.deletedAt.isNull(),
				$.homeOrganizationId.neq(payload.guestOrganizationId),
				$.u.userType.eq("user"),
				$.u.deletedAt.isNull(),
			])
			.orderBy(($) => [[$.updatedAt, "desc"]]),
	)
	return conversationIds.map((conversationId) => {
		const users = new Set<string>()
		const members: Array<EvidenceMember> = []
		for (const row of participants) {
			if (row.conversationId !== conversationId || users.has(row.userId)) continue
			users.add(row.userId)
			const email = row.email.trim().toLowerCase()
			members.push({ source: "connect", email: email.length > 0 ? email : null })
		}
		return {
			conversationId,
			members: members.slice(0, MAX_EVIDENCE_MEMBERS),
			memberCount: members.length,
		}
	})
}, Effect.orDie)

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export const VisibleChannelsCall = defineCall("org.visibleChannels", "org", {
	payload: Schema.Struct({
		organizationId: OrganizationId,
		userId: UserId,
		channelIds: Schema.Array(ChannelId),
	}),
	success: Schema.Array(ChannelId),
	error: Schema.Never,
})

/** The channels of `channelIds` the user sees here (`channel_access`). */
export const visibleChannels = Effect.fn("OrgObject.visibleChannels")(function* (payload: {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly channelIds: ReadonlyArray<ChannelId>
}) {
	if (payload.channelIds.length === 0) return []
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.channelAccessTable)
			.select("channelId")
			.where(($) => [
				$.organizationId.eq(payload.organizationId),
				$.userId.eq(payload.userId),
				inList($.channelId, [...new Set(payload.channelIds)]),
			]),
	)
	return rows.map((row) => row.channelId)
}, Effect.orDie)
