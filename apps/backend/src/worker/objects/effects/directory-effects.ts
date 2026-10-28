/**
 * Effects applied to the directory (D1) by the sending object's own outbox: the routing index rows
 * it owns. Each is one idempotent upsert (D1 has no transactions), so a retry is harmless.
 */
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Directory } from "../../../services/directory"
import { defineEffect, type EffectReceivers } from "./registry"

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
	deletedAt: DeletedAt,
})

export const DirectoryEffects = {
	upsertChannelIndex: defineEffect("directory.upsertChannelIndex", "directory", UpsertChannelIndexPayload),
	upsertMembershipIndex: defineEffect(
		"directory.upsertMembershipIndex",
		"directory",
		UpsertMembershipIndexPayload,
	),
	upsertOrgIndex: defineEffect("directory.upsertOrgIndex", "directory", UpsertOrgIndexPayload),
}

export const directoryReceivers = {
	"directory.upsertChannelIndex": (payload) =>
		Effect.flatMap(Directory, (directory) =>
			directory.upsertChannel({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
	"directory.upsertMembershipIndex": (payload) =>
		Effect.flatMap(Directory, (directory) =>
			directory.upsertMembership({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
	"directory.upsertOrgIndex": (payload) =>
		Effect.flatMap(Directory, (directory) =>
			directory.upsertOrg({ ...payload, deletedAt: toDate(payload.deletedAt) }),
		),
} satisfies EffectReceivers<typeof DirectoryEffects, Directory>
