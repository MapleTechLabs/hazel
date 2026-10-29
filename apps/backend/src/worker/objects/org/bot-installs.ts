/**
 * Bot installations in the `OrgObject`: `bot_installations` and the bot user's member row are the
 * org's; the bot, its commands and its user are copies of the directory's rows. Installing or
 * removing a bot re-projects every channel (`channel_bots` follow the installed bots), the bot
 * user's `membership_index` row and the directory's install count, all through the outbox.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { BotId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import {
	type BotProjectionPayload,
	botProjection,
	DirectoryWireEffects,
	fromBotWire,
} from "../directory-wire"
import { enqueueEffect } from "../effects/registry"
import { publishChannelAccess, syncMemberAccess } from "./channel-access"
import { projectUsers, removeUserProjection } from "./projections"

/** Replace the org's copy of the bot (and its commands, when given). */
export const upsertBotProjection = Effect.fn("OrgObject.upsertBotProjection")(function* (
	payload: BotProjectionPayload,
) {
	const db = yield* Database.Database
	const row = fromBotWire(payload.bot)
	const { id: _id, ...set } = row
	yield* db.run(
		SQLite.insertInto(schema.botsTable)
			.values(row)
			.onConflictDoUpdate({ target: ["id"], set }),
	)
	if (payload.commands !== null) {
		yield* db.run(SQLite.deleteFrom(schema.botCommandsTable).where(($) => [$.botId.eq(payload.bot.id)]))
		if (payload.commands.length > 0) {
			yield* db.run(
				SQLite.insertInto(schema.botCommandsTable).values(
					payload.commands.map((command) => ({
						...command,
						// The wire's optional nulls are the stored shape (`BotCommandArgument`).
						arguments: command.arguments as schema.BotCommandArgument[] | null,
						createdAt: new Date(command.createdAt),
						updatedAt: new Date(command.updatedAt),
					})),
				),
			)
		}
	}
	// A deleted bot leaves every channel's `channel_bots`.
	if (row.deletedAt !== null) yield* publishAllChannels
})

/** Every channel's access, re-projected: their `channel_bots` follow the installed bots. */
export const publishAllChannels = Effect.gen(function* () {
	const db = yield* Database.Database
	const channels = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [$.deletedAt.isNull()]),
	)
	yield* Effect.forEach(channels, (channel) => publishChannelAccess(channel.id), { discard: true })
	yield* Effect.annotateCurrentSpan({ "org.channels_republished": channels.length })
}).pipe(Effect.withSpan("OrgObject.publishAllChannels"))

const refreshInstallCount = (botId: BotId) =>
	enqueueEffect(DirectoryWireEffects.refreshBotInstallCount, { kind: "directory" }, { botId })

/**
 * Install `bot` in this org: the installation, the bot user's membership (reactivated if it left),
 * the copies of the bot, its commands and its user, then access everywhere (its `channel_bots`),
 * its `membership_index` row and the directory's install count. Inside the handler's transaction.
 */
export const installBotHere = Effect.fn("OrgObject.installBot")(function* (input: {
	readonly bot: schema.Bot
	readonly commands: ReadonlyArray<schema.BotCommand>
	readonly organizationId: OrganizationId
	readonly installedBy: UserId
}) {
	const db = yield* Database.Database
	const { bot, organizationId } = input
	yield* upsertBotProjection(botProjection(bot, input.commands))
	yield* projectUsers([bot.userId])
	yield* db.run(
		SQLite.insertInto(schema.botInstallationsTable).values({
			botId: bot.id,
			organizationId,
			installedBy: input.installedBy,
		}),
	)
	yield* db.run(
		SQLite.insertInto(schema.organizationMembersTable)
			.values({
				organizationId,
				userId: bot.userId,
				role: "member",
			})
			.onConflictDoUpdate({ target: ["organizationId", "userId"], set: { deletedAt: null } }),
	)
	yield* syncMemberAccess(bot.userId, organizationId)
	yield* publishAllChannels
	yield* refreshInstallCount(bot.id)
})

/** Uninstall: the reverse of `installBotHere`. Returns false when the bot is not installed here. */
export const uninstallBotHere = Effect.fn("OrgObject.uninstallBot")(function* (
	botId: BotId,
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const installation = yield* db.first(
		SQLite.from(schema.botInstallationsTable)
			.select("id")
			.where(($) => [$.botId.eq(botId), $.organizationId.eq(organizationId)])
			.limit(1),
	)
	if (Option.isNone(installation)) return false
	yield* db.run(
		SQLite.deleteFrom(schema.botInstallationsTable).where(($) => [$.id.eq(installation.value.id)]),
	)
	const bot = yield* db.first(
		SQLite.from(schema.botsTable)
			.select("userId")
			.where(($) => [$.id.eq(botId)])
			.limit(1),
	)
	if (Option.isSome(bot)) {
		const botUserId = bot.value.userId
		yield* db.run(
			SQLite.update(schema.organizationMembersTable)
				.set({ deletedAt: new Date() })
				.where(($) => [$.organizationId.eq(organizationId), $.userId.eq(botUserId)]),
		)
		yield* syncMemberAccess(botUserId, organizationId)
		yield* removeUserProjection({ userId: botUserId })
	}
	yield* db.run(SQLite.deleteFrom(schema.botCommandsTable).where(($) => [$.botId.eq(botId)]))
	yield* db.run(SQLite.deleteFrom(schema.botsTable).where(($) => [$.id.eq(botId)]))
	yield* publishAllChannels
	yield* refreshInstallCount(botId)
	return true
})
