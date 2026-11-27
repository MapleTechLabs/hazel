/**
 * What the integrations pages read: bots as their cards draw them, the workspace's connections, and
 * the live queries behind both (`web-foldkit/src/page/settings/integrations/shared/{bots,connections}.ts`).
 */
import type { IntegrationConnection } from "@hazel/domain/models"
import { BotId, type OrganizationId, type UserId } from "@hazel/schema"
import { and, eq, isNull } from "@tanstack/db"
import { Schema, type Stream } from "effect"
import type { ClientData } from "@hazel/client-data"
import { withData } from "../../app/live"

/** A bot as the cards draw it (`BotWithUser` / `PublicBotWithUser` in `db/hooks.ts`). */
export const Bot = Schema.Struct({
	id: BotId,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	isPublic: Schema.Boolean,
	scopes: Schema.Array(Schema.String),
	allowedIntegrations: Schema.Array(Schema.String),
	/** Where its install link may send a grant (`@hazel/domain/bot-install`). */
	installRedirectUris: Schema.Array(Schema.String),
	avatarUrl: Schema.NullOr(Schema.String),
	installCount: Schema.Finite,
})
export type Bot = typeof Bot.Type

export const PublicBot = Schema.Struct({ ...Bot.fields, creatorName: Schema.String })
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
	/** Absent on a copy from an org that has not migrated yet. */
	readonly installRedirectUris?: ReadonlyArray<string> | null
	readonly installCount: number
	readonly user: UserRow
}

export interface PublicBotRow extends BotRow {
	readonly creator?: UserRow | null
}

/** The machine user's avatar, else none (the card draws the name's initial). */
export const toBot = (row: BotRow): Bot => ({
	id: row.id,
	name: row.name,
	description: row.description,
	isPublic: row.isPublic,
	scopes: row.scopes ?? [],
	allowedIntegrations: row.allowedIntegrations ?? [],
	installRedirectUris: row.installRedirectUris ?? [],
	avatarUrl: row.user.avatarUrl || null,
	installCount: row.installCount,
})

/** `usePublicBots`' `creatorName`. */
export const toPublicBot = (row: PublicBotRow): PublicBot => ({
	...toBot(row),
	creatorName: row.creator
		? row.creator.firstName && row.creator.lastName
			? `${row.creator.firstName} ${row.creator.lastName}`
			: (row.creator.email ?? "")
		: "Unknown",
})

/**
 * Maple's bots in production Hazel: they come with the Maple integration and are installed, shown and
 * removed on its page, so Installed apps and the Marketplace leave them out. The second is the EU
 * region's bot from before regions; it stays listed until its installs have moved over.
 */
export const MAPLE_BOT_IDS: ReadonlyArray<string> = [
	"ca08852a-fb2e-4df9-8602-519e7ec3b9bf",
	"de89c591-fcf9-4ff7-a13e-0118180bfc99",
]

export const isIntegrationBot = (botId: string): boolean => MAPLE_BOT_IDS.includes(botId)

/** The connection fields the pages read (`useIntegrationConnection(s)` in `db/hooks.ts`). */
export const Connection = Schema.Struct({
	provider: Schema.String,
	isActive: Schema.Boolean,
	externalAccountName: Schema.NullOr(Schema.String),
	hasInstallationId: Schema.Boolean,
})
export type Connection = typeof Connection.Type

export interface ConnectionRow {
	readonly provider: IntegrationConnection.IntegrationProvider
	readonly status: IntegrationConnection.ConnectionStatus
	readonly externalAccountName?: string | null
	readonly metadata?: Readonly<Record<string, unknown>> | null
}

export const toConnection = (row: ConnectionRow): Connection => ({
	provider: row.provider,
	isActive: row.status === "active",
	externalAccountName: row.externalAccountName ?? null,
	hasInstallationId: Boolean(row.metadata?.installationId),
})

type Live<M> = Stream.Stream<M, never, ClientData>

/** `useMyBots`: the bots `createdBy` made, newest first. */
export const myBotsStream = <M>(createdBy: UserId, toMessage: (bots: ReadonlyArray<Bot>) => M): Live<M> =>
	withData((data) =>
		data.liveQueryStream<BotRow, M>(
			(q) =>
				q
					.from({ bot: data.collections.botCollection })
					.innerJoin({ user: data.collections.userCollection }, ({ bot, user }) =>
						eq(bot.userId, user.id),
					)
					.where(({ bot }) => and(eq(bot.createdBy, createdBy), isNull(bot.deletedAt)))
					.select(({ bot, user }) => ({ ...bot, user }))
					.orderBy(({ bot }) => bot.createdAt, "desc"),
			(rows) => toMessage(rows.map(toBot)),
		),
	)

/** `useInstalledBots`, without the integrations' own bots, by name. */
export const installedBotsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (bots: ReadonlyArray<Bot>) => M,
): Live<M> =>
	withData((data) =>
		data.liveQueryStream<BotRow, M>(
			(q) =>
				q
					.from({ installation: data.collections.botInstallationCollection })
					.innerJoin({ bot: data.collections.botCollection }, ({ installation, bot }) =>
						eq(installation.botId, bot.id),
					)
					.innerJoin({ user: data.collections.userCollection }, ({ bot, user }) =>
						eq(bot.userId, user.id),
					)
					.where(({ installation, bot }) =>
						and(eq(installation.organizationId, organizationId), isNull(bot.deletedAt)),
					)
					.select(({ bot, user }) => ({ ...bot, user }))
					.orderBy(({ bot }) => bot.name, "asc"),
			(rows) => toMessage(rows.filter((row) => !isIntegrationBot(row.id)).map(toBot)),
		),
	)

/** `usePublicBots`: every public bot but the integrations' own, most installed first. */
export const publicBotsStream = <M>(toMessage: (bots: ReadonlyArray<PublicBot>) => M): Live<M> =>
	withData((data) =>
		data.liveQueryStream<PublicBotRow, M>(
			(q) =>
				q
					.from({ bot: data.collections.botCollection })
					.innerJoin({ user: data.collections.userCollection }, ({ bot, user }) =>
						eq(bot.userId, user.id),
					)
					.leftJoin({ creator: data.collections.userCollection }, ({ bot, creator }) =>
						eq(bot.createdBy, creator.id),
					)
					.where(({ bot }) => and(eq(bot.isPublic, true), isNull(bot.deletedAt)))
					.select(({ bot, user, creator }) => ({ ...bot, user, creator }))
					.orderBy(({ bot }) => bot.installCount, "desc"),
			(rows) => toMessage(rows.filter((row) => !isIntegrationBot(row.id)).map(toPublicBot)),
		),
	)

/** The ids of the bots installed in the workspace. */
export const installedBotIdsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (botIds: ReadonlyArray<BotId>) => M,
): Live<M> =>
	withData((data) =>
		data.liveQueryStream<{ readonly botId: BotId }, M>(
			(q) =>
				q
					.from({ installation: data.collections.botInstallationCollection })
					.where(({ installation }) => eq(installation.organizationId, organizationId))
					.select(({ installation }) => ({ botId: installation.botId })),
			(rows) => toMessage(rows.map((row) => row.botId)),
		),
	)

/**
 * `useIntegrationConnections`: the workspace's connections, or with `userId` the member's own (T3 Code
 * links are per member).
 */
export const connectionsStream = <M>(
	organizationId: OrganizationId,
	userId: UserId | null,
	toMessage: (connections: ReadonlyArray<Connection>) => M,
): Live<M> =>
	withData((data) =>
		data.liveQueryStream<ConnectionRow, M>(
			(q) =>
				q
					.from({ connection: data.collections.integrationConnectionCollection })
					.where(({ connection }) =>
						userId === null
							? and(
									eq(connection.organizationId, organizationId),
									eq(connection.level, "organization"),
									isNull(connection.userId),
									isNull(connection.deletedAt),
								)
							: and(
									eq(connection.organizationId, organizationId),
									eq(connection.level, "user"),
									eq(connection.userId, userId),
									isNull(connection.deletedAt),
								),
					),
			(rows) => toMessage(rows.map(toConnection)),
		),
	)
