/**
 * Chat sync in the directory (D1): the `chat_sync_index` rows that route a provider event to its
 * `OrgObject`, and the provider users' shadow identities. Each write is one idempotent statement.
 *
 * A row's id is derived from its key: a link row (`provider:workspace:channel`) belongs to one org,
 * the first to link that channel (another org's link to it is never indexed, so it cannot take
 * the channel's events); a connection row (`provider:workspace::org`) is per org.
 */
import { SQLite, schema } from "@hazel/db"
import type { ExternalChannelId, ExternalUserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { EffectReceivers } from "../../worker/objects/effects/registry"
import { toUserProjection } from "../../worker/objects/org/projections"
import { Directory } from "../directory"
import type { ChatSyncDirectoryEffects, ChatSyncIndexPayload } from "./chat-sync-effects"
import { definitionOf } from "./providers"

const indexId = (row: ChatSyncIndexPayload) =>
	row.externalChannelId === null
		? `${row.provider}:${row.externalWorkspaceId}::${row.organizationId}`
		: `${row.provider}:${row.externalWorkspaceId}:${row.externalChannelId}`

const upsertIndex = (row: ChatSyncIndexPayload) =>
	Effect.flatMap(Directory, (directory) => {
		const insert = SQLite.insertInto(schema.chatSyncIndexTable).values({ id: indexId(row), ...row })
		return directory.db.run(
			row.externalChannelId === null
				? insert.onConflictDoUpdate({ target: ["id"], set: { channelId: row.channelId } })
				: insert.onConflictDoNothing({ target: ["id"] }),
		)
	}).pipe(
		Effect.asVoid,
		Effect.withSpan("ChatSync.upsertIndex", { attributes: { "chat_sync.index": indexId(row) } }),
	)

/** Removes the row only while it is still this org's (another org may have taken the channel). */
const deleteIndex = (row: ChatSyncIndexPayload) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.run(
			SQLite.deleteFrom(schema.chatSyncIndexTable).where(($) => [
				$.id.eq(indexId(row)),
				$.organizationId.eq(row.organizationId),
			]),
		),
	).pipe(
		Effect.asVoid,
		Effect.withSpan("ChatSync.deleteIndex", { attributes: { "chat_sync.index": indexId(row) } }),
	)

export const chatSyncDirectoryReceivers = {
	"directory.upsertChatSyncIndex": upsertIndex,
	"directory.deleteChatSyncIndex": deleteIndex,
} satisfies EffectReceivers<typeof ChatSyncDirectoryEffects, Directory>

/**
 * The orgs (and their Hazel channels) linked to a provider channel, in one of the workspaces the
 * event came from: a link to the same channel id under another workspace gets nothing.
 */
export const indexedLinks = (
	provider: string,
	externalChannelId: ExternalChannelId,
	externalWorkspaceIds: ReadonlyArray<string>,
) =>
	externalWorkspaceIds.length === 0
		? Effect.succeed([])
		: Effect.flatMap(Directory, (directory) =>
				directory.db.run(
					SQLite.from(schema.chatSyncIndexTable)
						.select("organizationId", "channelId")
						.where(($) => [
							$.provider.eq(provider),
							$.externalChannelId.eq(externalChannelId),
							$.externalWorkspaceId.in_(...externalWorkspaceIds),
						]),
				),
			).pipe(Effect.withSpan("ChatSync.indexedLinks"))

/** The org that has `externalChannelId` indexed in a workspace, if any (first link wins). */
export const indexedLinkOwner = (provider: string, externalWorkspaceId: string, externalChannelId: string) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.first(
			SQLite.from(schema.chatSyncIndexTable)
				.select("organizationId")
				.where(($) => [$.id.eq(`${provider}:${externalWorkspaceId}:${externalChannelId}`)]),
		),
	).pipe(Effect.map(Option.map((row) => row.organizationId)))

/** The orgs connected to a provider workspace (or to any, without `externalWorkspaceId`). */
export const indexedConnections = (provider: string, externalWorkspaceId?: string) =>
	Effect.flatMap(Directory, (directory) =>
		directory.db.run(
			SQLite.from(schema.chatSyncIndexTable)
				.select("organizationId", "externalWorkspaceId")
				.where(($) => [
					$.provider.eq(provider),
					$.externalChannelId.isNull(),
					...(externalWorkspaceId === undefined
						? []
						: [$.externalWorkspaceId.eq(externalWorkspaceId)]),
				]),
		),
	).pipe(Effect.withSpan("ChatSync.indexedConnections"))

/**
 * Upsert a machine user in the directory by its external id and return it as a projection: a
 * provider user's shadow (`discord-user-<id>`) or the provider's integration bot.
 */
export const upsertExternalUser = (params: {
	readonly externalId: string
	readonly email: string
	readonly displayName: string
	readonly avatarUrl: string | null
}) =>
	Effect.gen(function* () {
		const directory = yield* Directory
		const now = new Date()
		const rows = yield* directory.db.run(
			SQLite.insertInto(schema.usersTable)
				.values({
					externalId: params.externalId,
					email: params.email,
					firstName: params.displayName,
					lastName: "",
					avatarUrl: params.avatarUrl ?? "",
					userType: "machine",
					settings: null,
					isOnboarded: true,
					timezone: null,
					deletedAt: null,
				})
				.onConflictDoUpdate({
					target: ["externalId"],
					set: {
						firstName: params.displayName,
						...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
						updatedAt: now,
					},
				})
				.returning(),
		)
		return toUserProjection(rows[0]!)
	}).pipe(Effect.withSpan("ChatSync.upsertExternalUser"))

/** A provider user's shadow identity. */
export const upsertShadowUser = (
	provider: string,
	externalUserId: ExternalUserId,
	displayName: string,
	avatarUrl: string | null,
) =>
	upsertExternalUser({
		externalId: `${provider}-user-${externalUserId}`,
		email: `${provider}-user-${externalUserId}@${provider}.internal`,
		displayName,
		avatarUrl,
	})

/** The provider's integration bot (authors events that name nobody). */
export const upsertIntegrationBot = (provider: string) =>
	upsertExternalUser({
		externalId: `integration-bot-${provider}`,
		email: `integration-bot-${provider}@${provider}.internal`,
		displayName: Option.match(definitionOf(provider), {
			onNone: () => provider,
			onSome: (definition) => definition.displayName,
		}),
		avatarUrl: null,
	})
