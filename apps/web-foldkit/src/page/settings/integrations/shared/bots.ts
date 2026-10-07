import type { IntegrationConnection } from "@hazel/domain/models"
import { BotId, type OrganizationId, type UserId } from "@hazel/schema"
import { and, eq, type InitialQueryBuilder, isNull } from "@tanstack/db"
import { Schema } from "effect"
import { botCollection, botInstallationCollection, userCollection } from "~/db/collections"
import { resolveBotAvatarUrl } from "~/lib/bot-avatar"

/** A bot as the cards render it (`BotWithUser` / `PublicBotWithUser` in `db/hooks.ts`). */
export const Bot = Schema.Struct({
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	scopes: Schema.Array(Schema.String),
	allowedIntegrations: Schema.Array(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	installCount: Schema.Number,
})
export type Bot = typeof Bot.Type

export const PublicBot = Schema.Struct({
	...Bot.fields,
	creatorName: Schema.String,
})
export type PublicBot = typeof PublicBot.Type

interface UserRow {
	readonly avatarUrl?: string | null
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly email?: string
}

export interface BotRow {
	readonly id: BotId
	readonly name: string
	readonly description: string | null
	readonly isPublic: boolean
	readonly scopes: ReadonlyArray<string> | null
	readonly allowedIntegrations: ReadonlyArray<IntegrationConnection.IntegrationProvider> | null
	readonly installCount: number
	readonly user: UserRow
}

export interface PublicBotRow extends BotRow {
	readonly creator?: UserRow | null
}

export const toBot = (row: BotRow): Bot => ({
	id: row.id,
	name: row.name,
	description: row.description,
	isPublic: row.isPublic,
	scopes: row.scopes ?? [],
	allowedIntegrations: row.allowedIntegrations ?? [],
	avatarUrl: resolveBotAvatarUrl(row),
	installCount: row.installCount,
})

/** `usePublicBots`' `creatorName`; `isInstalled` comes from the installations query in the view. */
export const toPublicBot = (row: PublicBotRow): PublicBot => ({
	...toBot(row),
	creatorName: row.creator
		? row.creator.firstName && row.creator.lastName
			? `${row.creator.firstName} ${row.creator.lastName}`
			: (row.creator.email ?? "")
		: "Unknown",
})

/** `useMyBots` */
export const myBotsQuery = (createdBy: UserId) => (q: InitialQueryBuilder) =>
	q
		.from({ bot: botCollection })
		.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
		.where(({ bot }) => and(eq(bot.createdBy, createdBy), isNull(bot.deletedAt)))
		.select(({ bot, user }) => ({ ...bot, user }))
		.orderBy(({ bot }) => bot.createdAt, "desc")

/** `useInstalledBots` */
export const installedBotsQuery = (organizationId: OrganizationId) => (q: InitialQueryBuilder) =>
	q
		.from({ installation: botInstallationCollection })
		.innerJoin({ bot: botCollection }, ({ installation, bot }) => eq(installation.botId, bot.id))
		.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
		.where(({ installation, bot }) =>
			and(eq(installation.organizationId, organizationId), isNull(bot.deletedAt)),
		)
		.select(({ bot, user }) => ({ ...bot, user }))
		.orderBy(({ bot }) => bot.name, "asc")

/** `usePublicBots`, first query. */
export const publicBotsQuery = () => (q: InitialQueryBuilder) =>
	q
		.from({ bot: botCollection })
		.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
		.leftJoin({ creator: userCollection }, ({ bot, creator }) => eq(bot.createdBy, creator.id))
		.where(({ bot }) => and(eq(bot.isPublic, true), isNull(bot.deletedAt)))
		.select(({ bot, user, creator }) => ({ ...bot, user, creator }))
		.orderBy(({ bot }) => bot.installCount, "desc")

/** `usePublicBots`, second query: the bots installed in the org. */
export const installationsQuery = (organizationId: OrganizationId) => (q: InitialQueryBuilder) =>
	q
		.from({ installation: botInstallationCollection })
		.where(({ installation }) => eq(installation.organizationId, organizationId))
		.select(({ installation }) => ({ botId: installation.botId }))
