/**
 * A channel's access, inside its `OrgObject`: recompute the org-local `channel_access`
 * (`ChannelAccessSyncService`, which reads only org tables), then project it, in the same
 * transaction, through the outbox:
 *
 * - `channel.setViewers` to the channel's `ChannelObject` (its readers, their roles, the bots that
 *   get its events, its org and conversation);
 * - `directory.upsertChannelIndex`, so the api Worker routes the channel's RPCs.
 *
 * A Connect guest mount instead reports its readers to the host org (`./connect.ts`), and its
 * index row points at the host channel.
 *
 * The object delivers `setViewers` right after the commit, before the RPC answers, even while
 * another request's drain runs; the alarm retries whatever failed. Call `syncChannelAccess` (or `syncChannelTree` for a channel and
 * its threads) wherever a handler called `channelAccessSync.syncChannel`, and `syncMemberAccess`
 * where it called `syncUserInOrganization` (membership and org member changes).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"
import { ChannelAccessSyncService } from "../../../services/channel-access-sync"
import { ChannelEffects, type SetViewersPayload } from "../effects/channel-effects"
import { DirectoryEffects } from "../effects/directory-effects"
import { enqueueEffect } from "../effects/registry"
import { readObjectMeta, writeObjectMeta } from "../meta"
import { UserEffects } from "../effects/user-effects"
import { ConnectOrgEffects } from "../connect-wire"
import { channelTarget, orgTarget, userTarget } from "../kinds"
import { activeMountOf, conversationOf, mountsOf } from "./connect"
import { toUserProjection } from "./projections"

/** The channel's `setViewers` payload from the org's current tables; `None` for an unknown channel. */
export const channelViewersPayload = Effect.fn("OrgObject.channelViewersPayload")(function* (
	channelId: ChannelId,
) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("id", "organizationId", "deletedAt")
			.where(($) => [$.id.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(channel)) {
		return Option.none<{
			payload: SetViewersPayload
			deletedAt: Date | null
			role: "host" | "guest" | null
		}>()
	}
	const organizationId = channel.value.organizationId
	const org = yield* db.first(
		SQLite.from(schema.organizationsTable)
			.select("deletedAt")
			.where(($) => [$.id.eq(organizationId)])
			.limit(1),
	)
	// A deleted org's channels are gone with it (`publishOrgChannelsRemoval`).
	const deletedAt = channel.value.deletedAt ?? Option.getOrUndefined(org)?.deletedAt ?? null

	const mount = yield* activeMountOf(channelId)
	// A host channel's other mounts: guest channel ids routed to this channel's object.
	const mountChannelIds = Option.isNone(mount)
		? []
		: (yield* mountsOf(mount.value.conversationId))
				.filter((row) => row.channelId !== channelId && row.isActive && row.deletedAt === null)
				.map((row) => row.channelId)

	const access = yield* db.run(
		SQLite.from(schema.channelAccessTable)
			.select("userId")
			.where(($) => [$.channelId.eq(channelId)]),
	)
	const members = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("userId", "role")
			.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
	)
	const participants = Option.isNone(mount)
		? []
		: yield* db.run(
				SQLite.from(schema.connectParticipantsTable)
					.select("userId", "homeOrganizationId")
					.where(($) => [$.conversationId.eq(mount.value.conversationId), $.deletedAt.isNull()]),
			)
	const roleOf = new Map(members.map((member) => [member.userId, member.role]))
	const homeOf = new Map(participants.map((p) => [p.userId, p.homeOrganizationId]))

	const installed = yield* db.run(
		SQLite.from(schema.botInstallationsTable)
			.select("botId")
			.where(($) => [$.organizationId.eq(organizationId)]),
	)
	const bots =
		installed.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.botsTable)
						.select("id", "userId")
						.where(($) => [$.id.in_(...installed.map((row) => row.botId)), $.deletedAt.isNull()]),
				)

	const deleted = deletedAt !== null
	const payload: SetViewersPayload = {
		organizationId,
		conversationId: Option.isSome(mount) ? mount.value.conversationId : null,
		mountChannelIds: deleted ? [] : mountChannelIds,
		viewers: deleted
			? []
			: access.map(({ userId }) => {
					const role = roleOf.get(userId)
					return role === undefined
						? {
								userId,
								organizationId: homeOf.get(userId) ?? organizationId,
								role: "guest" as const,
							}
						: { userId, organizationId, role }
				}),
		bots: deleted ? [] : bots.map((bot) => ({ botId: bot.id, botUserId: bot.userId })),
	}
	return Option.some({
		payload,
		deletedAt,
		role: Option.isSome(mount) ? mount.value.role : null,
	})
})

const VIEWERS_VERSION_KEY = "viewersVersion"

/**
 * The next `setViewers` version: past the last one and at least the clock, so it keeps increasing
 * even if the org's meta were lost. Inside the write's transaction, so writes can't share one.
 */
const nextViewersVersion = Effect.gen(function* () {
	const last = Option.getOrElse(Option.map(yield* readObjectMeta(VIEWERS_VERSION_KEY), Number), () => 0)
	const version = Math.max(last + 1, yield* Clock.currentTimeMillis)
	yield* writeObjectMeta(VIEWERS_VERSION_KEY, String(version))
	return version
}).pipe(Effect.mapError(Database.toDatabaseError))

/**
 * Project the channel's current access: `setViewers` and its directory index row (outbox). The
 * object delivers `setViewers` right after the commit, before it answers, even while a drain is
 * running (`urgentKinds` in `../runtime.ts`), so a removed member loses access in the request.
 */
export const publishChannelAccess = Effect.fn("OrgObject.publishChannelAccess")(function* (
	channelId: ChannelId,
) {
	const computed = yield* channelViewersPayload(channelId)
	if (Option.isNone(computed)) return
	const { payload, deletedAt, role } = computed.value
	const hostChannelId = role === "guest" ? yield* publishGuestMount(channelId, payload) : null
	// A guest mount's messages live in the host channel's object; its own object stays unused.
	if (hostChannelId === null) {
		const version = yield* nextViewersVersion
		yield* enqueueEffect(ChannelEffects.setViewers, channelTarget(channelId), { ...payload, version })
	}
	yield* enqueueEffect(
		DirectoryEffects.upsertChannelIndex,
		{ kind: "directory" },
		{
			channelId,
			organizationId: payload.organizationId,
			hostChannelId,
			deletedAt: deletedAt === null ? null : deletedAt.toISOString(),
		},
	)
})

/**
 * A Connect guest mount: report its readers to the host org as participants (they become viewers
 * of the host channel). Returns the host channel, which the mount's `channel_index` row names.
 */
const publishGuestMount = Effect.fn("OrgObject.publishGuestMount")(function* (
	channelId: ChannelId,
	payload: SetViewersPayload,
) {
	const db = yield* Database.Database
	if (payload.conversationId === null) return null
	const conversation = yield* conversationOf(payload.conversationId)
	if (Option.isNone(conversation)) return null
	const userIds = payload.viewers.map((viewer) => viewer.userId)
	const users =
		userIds.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.usersTable)
						.select()
						.where(($) => [$.id.in_(...userIds), $.userType.eq("user")]),
				)
	yield* enqueueEffect(
		ConnectOrgEffects.setParticipants,
		orgTarget(conversation.value.hostOrganizationId),
		{
			conversationId: payload.conversationId,
			organizationId: payload.organizationId,
			channelId,
			users: users.map(toUserProjection),
			addedBy: null,
		},
	)
	return conversation.value.hostChannelId
})

/** Recompute the channel's `channel_access`, then project it. Inside the handler's transaction. */
export const syncChannelAccess = Effect.fn("OrgObject.syncChannelAccess")(function* (channelId: ChannelId) {
	const channelAccess = yield* ChannelAccessSyncService
	yield* channelAccess.syncChannel(channelId)
	yield* publishChannelAccess(channelId)
})

/** The channel and its threads: a parent's access is its threads' too. */
export const syncChannelTree = Effect.fn("OrgObject.syncChannelTree")(function* (channelId: ChannelId) {
	const db = yield* Database.Database
	yield* syncChannelAccess(channelId)
	const threads = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.parentChannelId.eq(channelId), $.type.eq("thread")]),
	)
	yield* Effect.forEach(threads, (thread) => syncChannelAccess(thread.id), { discard: true })
})

const accessOf = (userId: UserId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.channelAccessTable)
				.select("channelId")
				.where(($) => [$.userId.eq(userId)]),
		),
	).pipe(Effect.map((rows) => new Set(rows.map((row) => row.channelId))))

/**
 * Project `userId`'s membership of `organizationId` (active or removed): the directory's
 * `membership_index` row and the user's `user_organizations` (which `OrgObject`s the client opens).
 */
export const publishMembership = Effect.fn("OrgObject.publishMembership")(function* (
	userId: UserId,
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const member = yield* db.first(
		SQLite.from(schema.organizationMembersTable)
			.select("deletedAt")
			.where(($) => [$.organizationId.eq(organizationId), $.userId.eq(userId)])
			.orderBy(($) => [[$.deletedAt, "asc"]])
			.limit(1),
	)
	const deletedAt = Option.match(member, {
		onNone: () => new Date().toISOString(),
		onSome: (row) => (row.deletedAt === null ? null : row.deletedAt.toISOString()),
	})
	yield* enqueueEffect(
		DirectoryEffects.upsertMembershipIndex,
		{ kind: "directory" },
		{ userId, organizationId, deletedAt },
	)
	yield* enqueueEffect(UserEffects.setOrganization, userTarget(userId), { organizationId, deletedAt })
})

/**
 * After `userId`'s membership (org or channel) changed: recompute their `channel_access`, project
 * every channel whose readers changed (all of theirs with `republish`, e.g. a role change), and
 * their membership. Inside the handler's transaction.
 */
export const syncMemberAccess = Effect.fn("OrgObject.syncMemberAccess")(function* (
	userId: UserId,
	organizationId: OrganizationId,
	options?: { readonly republish?: boolean; readonly membership?: boolean },
) {
	const channelAccess = yield* ChannelAccessSyncService
	const before = yield* accessOf(userId)
	yield* channelAccess.syncUserInOrganization(userId, organizationId)
	const after = yield* accessOf(userId)
	const changed = new Set<ChannelId>()
	for (const id of before) if (!after.has(id) || options?.republish) changed.add(id)
	for (const id of after) if (!before.has(id) || options?.republish) changed.add(id)
	yield* Effect.forEach(changed, publishChannelAccess, { discard: true })
	if (options?.membership !== false) yield* publishMembership(userId, organizationId)
	yield* Effect.annotateCurrentSpan({ "org.channels_republished": changed.size })
})

/**
 * The organization was deleted: every channel and thread of it loses its viewers (closing their
 * sockets) and its index row, as `channelViewersPayload` treats them as deleted now.
 */
export const publishOrgChannelsRemoval = Effect.fn("OrgObject.publishOrgChannelsRemoval")(function* (
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const channels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.organizationId.eq(organizationId), $.deletedAt.isNull()]),
	)
	yield* Effect.forEach(channels, (channel) => publishChannelAccess(channel.id), { discard: true })
	yield* Effect.annotateCurrentSpan({ "org.channels_removed": channels.length })
})
