/**
 * A channel's access, inside its `OrgObject`: recompute the org-local `channel_access`
 * (`ChannelAccessSyncService`, which reads only org tables), then project it, in the same
 * transaction, through the outbox:
 *
 * - `channel.setViewers` to the channel's `ChannelObject` (its readers, their roles, the bots that
 *   get its events, its org and conversation);
 * - `directory.upsertChannelIndex`, so the api Worker routes the channel's RPCs.
 *
 * The object drains its outbox right after the commit, so both land before the RPC answers; the
 * alarm retries whatever failed. Call `syncChannelAccess` wherever a handler called
 * `channelAccessSync.syncChannel` (channel create/update/delete, membership, org member changes).
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { ChannelAccessSyncService } from "../../../services/channel-access-sync"
import { ChannelEffects, type SetViewersPayload } from "../effects/channel-effects"
import { DirectoryEffects } from "../effects/directory-effects"
import { enqueueEffect } from "../effects/registry"
import { channelTarget } from "../kinds"

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
	if (Option.isNone(channel)) return Option.none<{ payload: SetViewersPayload; deletedAt: Date | null }>()
	const organizationId = channel.value.organizationId

	const mount = yield* db.first(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("conversationId")
			.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()])
			.limit(1),
	)

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
	const participants = yield* db.run(
		SQLite.from(schema.connectParticipantsTable)
			.select("userId", "homeOrganizationId")
			.where(($) => [$.channelId.eq(channelId), $.deletedAt.isNull()]),
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

	const deleted = channel.value.deletedAt !== null
	const payload: SetViewersPayload = {
		organizationId,
		conversationId: Option.isSome(mount) ? mount.value.conversationId : null,
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
	return Option.some({ payload, deletedAt: channel.value.deletedAt })
})

/** Project the channel's current access: `setViewers` and its directory index row (outbox). */
export const publishChannelAccess = Effect.fn("OrgObject.publishChannelAccess")(function* (
	channelId: ChannelId,
) {
	const computed = yield* channelViewersPayload(channelId)
	if (Option.isNone(computed)) return
	const { payload, deletedAt } = computed.value
	yield* enqueueEffect(ChannelEffects.setViewers, channelTarget(channelId), payload)
	yield* enqueueEffect(
		DirectoryEffects.upsertChannelIndex,
		{ kind: "directory" },
		{
			channelId,
			organizationId: payload.organizationId,
			// TODO(do-sync): a guest org's Connect mount points at its host channel.
			hostChannelId: null,
			deletedAt: deletedAt === null ? null : deletedAt.toISOString(),
		},
	)
})

/** Recompute the channel's `channel_access`, then project it. Inside the handler's transaction. */
export const syncChannelAccess = Effect.fn("OrgObject.syncChannelAccess")(function* (channelId: ChannelId) {
	const channelAccess = yield* ChannelAccessSyncService
	yield* channelAccess.syncChannel(channelId)
	yield* publishChannelAccess(channelId)
})
