/**
 * What crosses between the directory (D1) and the `OrgObject`s for bots and invitations
 * (`infra/durable-object-sync-plan.md` §4): payload schemas, effect kinds, and the directory's
 * receivers. The directory owns `bots`, `bot_commands`, the bot's machine user and invitations;
 * each `OrgObject` holding an installation keeps a copy of the bot (without its token hash) and
 * its commands (`./org/bot-installs.ts`), and applies accepted invitations
 * (`./org/invitation-accept.ts`).
 *
 * A leaf module (no object or effect-module imports), so the effect registries can spread its
 * kinds at load time whatever imports first.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { IntegrationConnection } from "@hazel/domain/models"
import { BotCommandId, BotId, InvitationId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Directory } from "../../services/directory"
import { defineEffect } from "./effects/registry"
import { UserProjection } from "./org/projections"

/** ISO timestamp text. */
const Timestamp = Schema.String
const toDate = (value: string | null) => (value === null ? null : new Date(value))
const toIso = (value: Date | null) => (value === null ? null : value.toISOString())

/** A `bots` row as it crosses the outbox (timestamps as ISO text). */
export const BotWire = Schema.Struct({
	id: BotId,
	userId: UserId,
	createdBy: UserId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	webhookUrl: Schema.NullOr(Schema.String),
	apiTokenHash: Schema.String,
	scopes: Schema.NullOr(Schema.Array(Schema.String)),
	metadata: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	isPublic: Schema.Boolean,
	installCount: Schema.Number,
	mentionable: Schema.Boolean,
	allowedIntegrations: Schema.NullOr(Schema.Array(IntegrationConnection.IntegrationProvider)),
	createdAt: Timestamp,
	updatedAt: Timestamp,
	deletedAt: Schema.NullOr(Timestamp),
})
export type BotWire = typeof BotWire.Type

const BotCommandArgumentWire = Schema.Struct({
	name: Schema.String,
	description: Schema.optional(Schema.NullOr(Schema.String)),
	required: Schema.Boolean,
	placeholder: Schema.optional(Schema.NullOr(Schema.String)),
	type: Schema.Literals(["string", "number", "user", "channel"]),
})

/** A `bot_commands` row as it crosses the outbox. */
export const BotCommandWire = Schema.Struct({
	id: BotCommandId,
	botId: BotId,
	name: Schema.String,
	description: Schema.String,
	arguments: Schema.NullOr(Schema.Array(BotCommandArgumentWire)),
	usageExample: Schema.NullOr(Schema.String),
	isEnabled: Schema.Boolean,
	createdAt: Timestamp,
	updatedAt: Timestamp,
})

/** The org's copy of a bot; `commands: null` leaves the org's copy of its commands alone. */
export const BotProjectionPayload = Schema.Struct({
	bot: BotWire,
	commands: Schema.NullOr(Schema.Array(BotCommandWire)),
})
export type BotProjectionPayload = typeof BotProjectionPayload.Type

export const RefreshBotInstallCountPayload = Schema.Struct({ botId: BotId })

export const toBotWire = (row: schema.Bot): BotWire => ({
	...row,
	scopes: row.scopes,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	deletedAt: toIso(row.deletedAt),
})

export const fromBotWire = (bot: BotWire): schema.NewBot => ({
	...bot,
	scopes: bot.scopes === null ? null : [...bot.scopes],
	allowedIntegrations: bot.allowedIntegrations === null ? null : [...bot.allowedIntegrations],
	createdAt: new Date(bot.createdAt),
	updatedAt: new Date(bot.updatedAt),
	deletedAt: toDate(bot.deletedAt),
})

export const toBotCommandWire = (row: schema.BotCommand): typeof BotCommandWire.Type => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
})

/** The projection of a directory bot: its token hash stays in the directory. */
export const botProjection = (
	bot: schema.Bot,
	commands: ReadonlyArray<schema.BotCommand> | null,
): BotProjectionPayload => ({
	bot: { ...toBotWire(bot), apiTokenHash: "" },
	commands: commands === null ? null : commands.map(toBotCommandWire),
})

/** The bot and its commands, read from the directory. */
export const readDirectoryBot = Effect.fn("Bots.readDirectoryBot")(function* (botId: BotId) {
	const directory = yield* Directory
	const bot = yield* directory.db.first(
		SQLite.from(schema.botsTable)
			.select()
			.where(($) => [$.id.eq(botId), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isNone(bot)) return Option.none<{ bot: schema.Bot; commands: Array<schema.BotCommand> }>()
	const commands = yield* directory.db.run(
		SQLite.from(schema.botCommandsTable)
			.select()
			.where(($) => [$.botId.eq(botId)]),
	)
	return Option.some({ bot: bot.value, commands })
})

/** A bot an org created (`bot.create`): its directory row. Idempotent. */
export const createDirectoryBot = Effect.fn("Directory.createBot")(function* (bot: BotWire) {
	const directory = yield* Directory
	yield* directory.db.run(
		SQLite.insertInto(schema.botsTable).values(fromBotWire(bot)).onConflictDoNothing(),
	)
})

/** `installCount` = the orgs the bot user is an active member of (`membership_index`). Idempotent. */
export const refreshDirectoryInstallCount = Effect.fn("Directory.refreshBotInstallCount")(
	function* (payload: { readonly botId: BotId }) {
		const directory = yield* Directory
		yield* directory.db.query(
			Database.sql`UPDATE "bots" SET "installCount" = (
			SELECT count(*) FROM "membership_index" mi
			WHERE mi."userId" = "bots"."userId" AND mi."deletedAt" IS NULL
		) WHERE "id" = ${payload.botId}`,
		)
	},
)

// ---- Invitations ----

/** An accepted invitation, applied by the org (`org.acceptInvitation`). */
export const AcceptInvitationPayload = Schema.Struct({
	invitationId: InvitationId,
	organizationId: OrganizationId,
	role: Schema.Literals(["admin", "member"]),
	invitedBy: UserId,
	/** The accepting user's directory row, for the org's copy. */
	user: UserProjection,
})
export type AcceptInvitationPayload = typeof AcceptInvitationPayload.Type

// ---- Kinds ----

/** Received by `OrgObject`s (receivers in `./effects/org-effects.ts`). */
export const DirectoryWireOrgEffects = {
	/** A bot's directory row (and commands) changed: replace the org's copy. */
	upsertBotProjection: defineEffect("org.upsertBotProjection", "org", BotProjectionPayload),
	/** Add the invited user as a member (and to `#general`). */
	acceptInvitation: defineEffect("org.acceptInvitation", "org", AcceptInvitationPayload),
}

/** Applied to the directory by the sending object (receivers below). */
export const DirectoryWireEffects = {
	/** A bot an org created: its directory row (its machine user is `directory.upsertBotUser`). */
	createBot: defineEffect("directory.createBot", "directory", BotWire),
	refreshBotInstallCount: defineEffect(
		"directory.refreshBotInstallCount",
		"directory",
		RefreshBotInstallCountPayload,
	),
}

export const directoryWireReceivers = {
	"directory.createBot": createDirectoryBot,
	"directory.refreshBotInstallCount": refreshDirectoryInstallCount,
}
