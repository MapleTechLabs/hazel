/**
 * Effects applied to the directory (D1) by the sending object's own outbox: the routing index rows
 * it owns. Each is one idempotent upsert (D1 has no transactions), so a retry is harmless.
 */
import { SQLite, schema } from "@hazel/db"
import { ChannelId, ChannelWebhookId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Directory, type DirectoryShape } from "../../../services/directory"
import { DirectoryWireEffects, directoryWireReceivers } from "../directory-wire"
import { ConnectDirectoryEffects, connectDirectoryReceivers } from "../connect-wire"
import { UserProjection } from "../org/projections"
import { ChatSyncDirectoryEffects } from "../../../services/chat-sync/chat-sync-effects"
import { chatSyncDirectoryReceivers } from "../../../services/chat-sync/chat-sync-index"
import { CurrentEffectSender, defineEffect, type EffectReceivers, requireOrgSender } from "./registry"

/** ISO timestamp text, or null. */
const DeletedAt = Schema.NullOr(Schema.String)
const toDate = (value: string | null) => (value === null ? null : new Date(value))

export const UpsertChannelIndexPayload = Schema.Struct({
	channelId: ChannelId,
	organizationId: OrganizationId,
	hostChannelId: Schema.NullOr(ChannelId),
	deletedAt: DeletedAt,
})

export const UpsertMembershipIndexPayload = Schema.Struct({
	userId: UserId,
	organizationId: OrganizationId,
	deletedAt: DeletedAt,
})

export const UpsertOrgIndexPayload = Schema.Struct({
	id: OrganizationId,
	slug: Schema.NullOr(Schema.String),
	name: Schema.String,
	isPublic: Schema.optionalKey(Schema.Boolean),
	deletedAt: DeletedAt,
})

/** A channel webhook's token hash, for the incoming webhook route. `tokenHash: null` removes it. */
export const UpsertWebhookIndexPayload = Schema.Struct({
	webhookId: ChannelWebhookId,
	organizationId: OrganizationId,
	channelId: ChannelId,
	tokenHash: Schema.NullOr(Schema.String),
})

/** A provider installation owned by the org (`integration_index`); `remove` drops the org's row. */
export const UpsertIntegrationIndexPayload = Schema.Struct({
	provider: Schema.String,
	externalId: Schema.String,
	organizationId: OrganizationId,
	remove: Schema.Boolean,
})

export const DirectoryEffects = {
	upsertChannelIndex: defineEffect("directory.upsertChannelIndex", "directory", UpsertChannelIndexPayload),
	upsertMembershipIndex: defineEffect(
		"directory.upsertMembershipIndex",
		"directory",
		UpsertMembershipIndexPayload,
	),
	upsertOrgIndex: defineEffect("directory.upsertOrgIndex", "directory", UpsertOrgIndexPayload),
	upsertWebhookIndex: defineEffect("directory.upsertWebhookIndex", "directory", UpsertWebhookIndexPayload),
	upsertIntegrationIndex: defineEffect(
		"directory.upsertIntegrationIndex",
		"directory",
		UpsertIntegrationIndexPayload,
	),
	/** A machine user an org created (a webhook's bot): the directory owns `users`. */
	upsertBotUser: defineEffect("directory.upsertBotUser", "directory", UserProjection),
	...DirectoryWireEffects,
	...ChatSyncDirectoryEffects,
	...ConnectDirectoryEffects,
}

/** Index rows an org owns are written only by that org's own `OrgObject` (its outbox). */
const asOwningOrg = <A, E, R>(
	kind: string,
	organizationId: string,
	write: (directory: DirectoryShape) => Effect.Effect<A, E, R>,
) => requireOrgSender(kind, organizationId).pipe(Effect.andThen(Effect.flatMap(Directory, write)))

export const directoryReceivers = {
	"directory.upsertChannelIndex": (payload) =>
		asOwningOrg("directory.upsertChannelIndex", payload.organizationId, (directory) =>
			directory.upsertChannel({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
	"directory.upsertMembershipIndex": (payload) =>
		asOwningOrg("directory.upsertMembershipIndex", payload.organizationId, (directory) =>
			directory.upsertMembership({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
	"directory.upsertOrgIndex": (payload) =>
		asOwningOrg("directory.upsertOrgIndex", payload.id, (directory) =>
			directory.upsertOrg({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
	"directory.upsertWebhookIndex": (payload) =>
		asOwningOrg("directory.upsertWebhookIndex", payload.organizationId, (directory) =>
			payload.tokenHash === null
				? directory.deleteWebhook(payload.webhookId)
				: directory.upsertWebhook({ ...payload, tokenHash: payload.tokenHash }),
		),
	"directory.upsertIntegrationIndex": ({ remove, ...row }) =>
		asOwningOrg("directory.upsertIntegrationIndex", row.organizationId, (directory) =>
			remove ? directory.deleteIntegration(row) : directory.upsertIntegration(row),
		),
	"directory.upsertBotUser": (user) =>
		Effect.flatMap(Directory, (directory) => {
			const row = {
				...user,
				createdAt: new Date(user.createdAt),
				updatedAt: new Date(user.updatedAt),
				deletedAt: toDate(user.deletedAt),
			}
			return directory.db
				.run(
					SQLite.insertInto(schema.usersTable)
						.values(row)
						.onConflictDoUpdate({
							target: ["id"],
							set: {
								firstName: row.firstName,
								lastName: row.lastName,
								avatarUrl: row.avatarUrl,
								updatedAt: row.updatedAt,
								deletedAt: row.deletedAt,
							},
						}),
				)
				.pipe(Effect.asVoid)
		}),
	...directoryWireReceivers,
	...chatSyncDirectoryReceivers,
	...connectDirectoryReceivers,
} satisfies EffectReceivers<typeof DirectoryEffects, Directory | CurrentEffectSender>
