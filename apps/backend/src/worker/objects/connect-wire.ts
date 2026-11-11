/**
 * What crosses between objects for Hazel Connect (shared channels, `infra/durable-object-sync-plan.md`
 * §1 "Connect"): wire schemas, effect kinds, and the directory's receiver.
 *
 * - The host `OrgObject` owns the conversation, its participants and every mount row (its own and
 *   a copy of each guest's); the host channel's `ChannelObject` holds every message.
 * - A guest `OrgObject` owns its mounted channel; it writes its own mount row when it joins or
 *   leaves, and otherwise keeps the host's snapshot of the conversation and its mounts.
 * - Invites are the directory's (`connect_invites`); objects write them through the outbox.
 *
 * A leaf module (no object or effect-module imports), like `./directory-wire.ts`.
 */
import { SQLite, schema } from "@hazel/db"
import {
	ChannelIcon,
	ChannelId,
	ConnectConversationChannelId,
	ConnectConversationId,
	ConnectInviteId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Directory } from "../../services/directory"
import { defineEffect } from "./effects/registry"
import { UserProjection } from "./org/projections"

/** ISO timestamp text. */
const Timestamp = Schema.String
const toDate = (value: string | null) => (value === null ? null : new Date(value))
const toIso = (value: Date | null) => (value === null ? null : value.toISOString())

export const ConnectInviteWire = Schema.Struct({
	id: ConnectInviteId,
	conversationId: ConnectConversationId,
	hostOrganizationId: OrganizationId,
	hostChannelId: ChannelId,
	targetKind: Schema.Literals(["slug", "email"]),
	targetValue: Schema.String,
	guestOrganizationId: Schema.NullOr(OrganizationId),
	status: Schema.Literals(["pending", "accepted", "declined", "revoked", "expired"]),
	allowGuestMemberAdds: Schema.Boolean,
	invitedBy: UserId,
	acceptedBy: Schema.NullOr(UserId),
	acceptedAt: Schema.NullOr(Timestamp),
	expiresAt: Schema.NullOr(Timestamp),
	createdAt: Timestamp,
	updatedAt: Timestamp,
	deletedAt: Schema.NullOr(Timestamp),
})
export type ConnectInviteWire = typeof ConnectInviteWire.Type

export const ConversationWire = Schema.Struct({
	id: ConnectConversationId,
	hostOrganizationId: OrganizationId,
	hostChannelId: ChannelId,
	status: Schema.Literals(["active", "disconnected"]),
	settings: Schema.NullOr(Schema.Record(Schema.String, Schema.Unknown)),
	createdBy: UserId,
	createdAt: Timestamp,
	updatedAt: Timestamp,
	deletedAt: Schema.NullOr(Timestamp),
})
export type ConversationWire = typeof ConversationWire.Type

export const MountWire = Schema.Struct({
	id: ConnectConversationChannelId,
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	channelId: ChannelId,
	role: Schema.Literals(["host", "guest"]),
	allowGuestMemberAdds: Schema.Boolean,
	isActive: Schema.Boolean,
	createdAt: Timestamp,
	updatedAt: Timestamp,
	deletedAt: Schema.NullOr(Timestamp),
})
export type MountWire = typeof MountWire.Type

export const toInviteWire = (row: schema.ConnectInvite): ConnectInviteWire => ({
	...row,
	acceptedAt: toIso(row.acceptedAt),
	expiresAt: toIso(row.expiresAt),
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	deletedAt: toIso(row.deletedAt),
})

export const fromInviteWire = (wire: ConnectInviteWire): schema.ConnectInvite => ({
	...wire,
	acceptedAt: toDate(wire.acceptedAt),
	expiresAt: toDate(wire.expiresAt),
	createdAt: new Date(wire.createdAt),
	updatedAt: new Date(wire.updatedAt),
	deletedAt: toDate(wire.deletedAt),
})

export const toConversationWire = (row: schema.ConnectConversation): ConversationWire => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	deletedAt: toIso(row.deletedAt),
})

export const fromConversationWire = (wire: ConversationWire): schema.ConnectConversation => ({
	...wire,
	settings: wire.settings === null ? null : { ...wire.settings },
	createdAt: new Date(wire.createdAt),
	updatedAt: new Date(wire.updatedAt),
	deletedAt: toDate(wire.deletedAt),
})

export const toMountWire = (row: schema.ConnectConversationChannel): MountWire => ({
	...row,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
	deletedAt: toIso(row.deletedAt),
})

export const fromMountWire = (wire: MountWire): schema.ConnectConversationChannel => ({
	...wire,
	createdAt: new Date(wire.createdAt),
	updatedAt: new Date(wire.updatedAt),
	deletedAt: toDate(wire.deletedAt),
})

/** To the host: a guest org mounted the conversation (`connectShare.invite.accept`). */
export const MountAddedPayload = Schema.Struct({ mount: MountWire })

/**
 * To the host: who in the guest org may read its mounted channel (that channel's `channel_access`),
 * replacing the org's previous participants. Sent whenever the guest recomputes the mount's access.
 */
export const SetParticipantsPayload = Schema.Struct({
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	channelId: ChannelId,
	users: Schema.Array(UserProjection),
	addedBy: Schema.NullOr(UserId),
})
export type SetParticipantsPayload = typeof SetParticipantsPayload.Type

/** To the host: the guest org left the conversation (`connectShare.organization.disconnect`). */
export const MountRemovedPayload = Schema.Struct({
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
})

/** To a guest: the host's conversation row and every mount, replacing the guest's copies. */
export const ConversationSnapshotPayload = Schema.Struct({
	conversation: ConversationWire,
	mounts: Schema.Array(MountWire),
	/** What the guest's mounted channel mirrors; null once the host channel is gone. */
	hostChannel: Schema.NullOr(
		Schema.Struct({
			name: Schema.String,
			icon: Schema.NullOr(ChannelIcon),
			type: Schema.Literals(["public", "private", "thread", "direct", "single"]),
		}),
	),
})
export type ConversationSnapshotPayload = typeof ConversationSnapshotPayload.Type

/** Received by `OrgObject`s (receivers in `./org/connect.ts`). */
export const ConnectOrgEffects = {
	mountAdded: defineEffect("org.connectMountAdded", "org", MountAddedPayload),
	setParticipants: defineEffect("org.connectSetParticipants", "org", SetParticipantsPayload),
	mountRemoved: defineEffect("org.connectMountRemoved", "org", MountRemovedPayload),
	conversationSnapshot: defineEffect("org.connectConversationSnapshot", "org", ConversationSnapshotPayload),
}

/** Applied to the directory by the sending object. */
export const ConnectDirectoryEffects = {
	/** The whole invite row; idempotent upsert by id. */
	upsertInvite: defineEffect("directory.upsertConnectInvite", "directory", ConnectInviteWire),
}

const upsertInvite = Effect.fn("Directory.upsertConnectInvite")(function* (wire: ConnectInviteWire) {
	const directory = yield* Directory
	const row = fromInviteWire(wire)
	const { id: _id, ...set } = row
	yield* directory.db.run(
		SQLite.insertInto(schema.connectInvitesTable)
			.values(row)
			.onConflictDoUpdate({ target: ["id"], set }),
	)
})

export const connectDirectoryReceivers = {
	"directory.upsertConnectInvite": upsertInvite,
}
