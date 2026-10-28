/**
 * Hazel Connect inside an `OrgObject` (`../connect-wire.ts` for who owns what).
 *
 * Host side: the conversation, every mount (a copy of each guest's), the participants (host
 * channel members, and each guest org's readers of its mount as that org reports them). The host
 * channel's access is its own `channel_access` plus the participants (`ChannelAccessSyncService`),
 * projected with `setViewers`, so guests pass `ChannelViewers.require` in the host `ChannelObject`.
 *
 * Guest side: its mounted channel (whose `channel_index` row points at the host channel) and the
 * host's snapshot of the conversation. Recomputing the mount's access reports its readers to the
 * host as participants (`./channel-access.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type ChannelId,
	type ConnectConversationId,
	ConnectParticipantId,
	type OrganizationId,
	type UserId,
} from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import {
	ConnectOrgEffects,
	type ConversationSnapshotPayload,
	fromConversationWire,
	fromMountWire,
	type MountWire,
	type SetParticipantsPayload,
	toConversationWire,
	toMountWire,
} from "../connect-wire"
import { type EffectSender, enqueueEffect, isOrgSender } from "../effects/registry"
import { orgTarget } from "../kinds"
import { syncChannelAccess } from "./channel-access"
import { dropMountedSearch, exportToGuest } from "./message-search"
import { removeUserProjection, upsertUserProjection } from "./projections"

/** The participant row id for `userId` in `conversationId`: the same on every side that names it. */
export const participantIdFor = (conversationId: ConnectConversationId, userId: UserId) =>
	Effect.promise(() =>
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(`connect:${conversationId}:${userId}`)),
	).pipe(
		Effect.map((digest) => {
			const hex = [...new Uint8Array(digest).slice(0, 16)]
				.map((byte) => byte.toString(16).padStart(2, "0"))
				.join("")
			// RFC 9562 version 8 (custom), variant 10.
			const variant = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
			const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
			return Schema.decodeSync(ConnectParticipantId)(id)
		}),
	)

export const conversationOf = (conversationId: ConnectConversationId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.connectConversationsTable)
				.select()
				.where(($) => [$.id.eq(conversationId)])
				.limit(1),
		),
	)

/** The live mount of a channel of this org (host or guest). */
export const activeMountOf = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.connectConversationChannelsTable)
				.select()
				.where(($) => [$.channelId.eq(channelId), $.isActive.eq(true), $.deletedAt.isNull()])
				.limit(1),
		),
	)

export const mountsOf = (conversationId: ConnectConversationId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.connectConversationChannelsTable)
				.select()
				.where(($) => [$.conversationId.eq(conversationId)]),
		),
	)

const upsertMount = (row: schema.ConnectConversationChannel) =>
	Effect.flatMap(Database.Database, (db) => {
		const { id: _id, ...set } = row
		return db.run(
			SQLite.insertInto(schema.connectConversationChannelsTable)
				.values(row)
				.onConflictDoUpdate({ target: ["id"], set }),
		)
	})

const upsertConversation = (row: schema.ConnectConversation) =>
	Effect.flatMap(Database.Database, (db) => {
		const { id: _id, ...set } = row
		return db.run(
			SQLite.insertInto(schema.connectConversationsTable)
				.values(row)
				.onConflictDoUpdate({ target: ["id"], set }),
		)
	})

/** Insert or reactivate a participant row (keyed by `participantIdFor`). */
export const upsertParticipant = Effect.fn("OrgObject.connectUpsertParticipant")(function* (row: {
	readonly conversationId: ConnectConversationId
	readonly channelId: ChannelId
	readonly userId: UserId
	readonly homeOrganizationId: OrganizationId
	readonly isExternal: boolean
	readonly addedBy: UserId | null
}) {
	const db = yield* Database.Database
	const id = yield* participantIdFor(row.conversationId, row.userId)
	const now = new Date()
	yield* db.run(
		SQLite.insertInto(schema.connectParticipantsTable)
			.values({ ...row, id, createdAt: now, updatedAt: now, deletedAt: null })
			.onConflictDoUpdate({
				target: ["id"],
				set: {
					channelId: row.channelId,
					homeOrganizationId: row.homeOrganizationId,
					isExternal: row.isExternal,
					updatedAt: now,
					deletedAt: null,
				},
			}),
	)
	return id
})

/** Soft-delete participants; drops their user copies when nothing else here shows them. */
const removeParticipants = Effect.fn("OrgObject.connectRemoveParticipants")(function* (
	rows: ReadonlyArray<{ readonly id: schema.ConnectParticipant["id"]; readonly userId: UserId }>,
) {
	if (rows.length === 0) return
	const db = yield* Database.Database
	const now = new Date()
	yield* db.run(
		SQLite.update(schema.connectParticipantsTable)
			.set({ deletedAt: now, updatedAt: now })
			.where(($) => [$.id.in_(...rows.map((row) => row.id))]),
	)
	yield* Effect.forEach(rows, (row) => removeUserProjection({ userId: row.userId }), { discard: true })
})

/** Host: the live conversation of `hostChannelId`, created (with the host mount) on first share. */
export const ensureConversation = Effect.fn("OrgObject.connectEnsureConversation")(function* (
	channel: { readonly id: ChannelId; readonly organizationId: OrganizationId },
	createdBy: UserId,
) {
	const mount = yield* activeMountOf(channel.id)
	if (Option.isSome(mount)) {
		const conversation = yield* conversationOf(mount.value.conversationId)
		if (Option.isSome(conversation)) {
			return { conversation: conversation.value, mount: mount.value, created: false }
		}
	}
	const now = new Date()
	const conversation: schema.ConnectConversation = {
		id: crypto.randomUUID() as ConnectConversationId,
		hostOrganizationId: channel.organizationId,
		hostChannelId: channel.id,
		status: "active",
		settings: null,
		createdBy,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	}
	const hostMount: schema.ConnectConversationChannel = {
		id: crypto.randomUUID() as schema.ConnectConversationChannel["id"],
		conversationId: conversation.id,
		organizationId: channel.organizationId,
		channelId: channel.id,
		role: "host",
		allowGuestMemberAdds: false,
		isActive: true,
		createdAt: now,
		updatedAt: now,
		deletedAt: null,
	}
	yield* upsertConversation(conversation)
	yield* upsertMount(hostMount)
	yield* Effect.annotateCurrentSpan({ "connect.conversation_id": conversation.id })
	return { conversation, mount: hostMount, created: true }
})

/** Host: send the conversation and its mounts to every guest org that ever mounted it. */
export const publishConversation = Effect.fn("OrgObject.connectPublishConversation")(function* (
	conversationId: ConnectConversationId,
) {
	const conversation = yield* conversationOf(conversationId)
	if (Option.isNone(conversation)) return
	const mounts = yield* mountsOf(conversationId)
	const db = yield* Database.Database
	const hostChannel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("name", "icon", "type")
			.where(($) => [$.id.eq(conversation.value.hostChannelId)])
			.limit(1),
	)
	const payload: ConversationSnapshotPayload = {
		conversation: toConversationWire(conversation.value),
		mounts: mounts.map(toMountWire),
		hostChannel: Option.getOrNull(hostChannel),
	}
	const guests = new Set(mounts.filter((m) => m.role === "guest").map((m) => m.organizationId))
	yield* Effect.forEach(
		guests,
		(organizationId) =>
			enqueueEffect(ConnectOrgEffects.conversationSnapshot, orgTarget(organizationId), payload),
		{ discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "connect.guests": guests.size })
})

/** Recompute and project a channel's access (`./channel-access.ts` imports this module back). */
const syncHostChannel = (channelId: ChannelId) => syncChannelAccess(channelId)

/** Host: a guest org mounted the conversation. Adds the host channel's members as participants. */
export const mountAdded = Effect.fn("OrgObject.connectMountAdded")(function* (payload: {
	readonly mount: MountWire
}) {
	const db = yield* Database.Database
	const conversation = yield* conversationOf(payload.mount.conversationId)
	// Unknown or ended here: a stale delivery.
	if (Option.isNone(conversation) || conversation.value.deletedAt !== null) return
	const { hostChannelId, hostOrganizationId } = conversation.value
	yield* upsertMount(fromMountWire(payload.mount))
	yield* db.run(
		SQLite.update(schema.connectConversationsTable)
			.set({ status: "active", updatedAt: new Date() })
			.where(($) => [$.id.eq(conversation.value.id)]),
	)
	const hostMembers = yield* db.run(
		SQLite.from(schema.channelMembersTable)
			.select("userId")
			.where(($) => [$.channelId.eq(hostChannelId), $.deletedAt.isNull()]),
	)
	yield* Effect.forEach(
		hostMembers,
		(member) =>
			upsertParticipant({
				conversationId: conversation.value.id,
				channelId: hostChannelId,
				userId: member.userId,
				homeOrganizationId: hostOrganizationId,
				isExternal: false,
				addedBy: null,
			}),
		{ discard: true },
	)
	yield* syncHostChannel(hostChannelId)
	yield* publishConversation(conversation.value.id)
	// After the snapshot (same target, FIFO): the guest's search gets the history before the share.
	yield* exportToGuest(hostChannelId, {
		organizationId: payload.mount.organizationId,
		channelId: payload.mount.channelId,
	})
})

/** Host: replace a guest org's participants with the readers of its mount. */
export const setParticipants = Effect.fn("OrgObject.connectSetParticipants")(function* (
	payload: SetParticipantsPayload,
) {
	const db = yield* Database.Database
	const conversation = yield* conversationOf(payload.conversationId)
	if (Option.isNone(conversation) || conversation.value.deletedAt !== null) return
	const mount = yield* db.first(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("id")
			.where(($) => [
				$.conversationId.eq(payload.conversationId),
				$.organizationId.eq(payload.organizationId),
				$.role.eq("guest"),
				$.isActive.eq(true),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	// The org is not (or no longer) mounted here.
	if (Option.isNone(mount)) return

	const current = yield* db.run(
		SQLite.from(schema.connectParticipantsTable)
			.select("id", "userId")
			.where(($) => [
				$.conversationId.eq(payload.conversationId),
				$.homeOrganizationId.eq(payload.organizationId),
				$.deletedAt.isNull(),
			]),
	)
	const next = new Set(payload.users.map((user) => user.id))
	yield* Effect.forEach(payload.users, upsertUserProjection, { discard: true })
	yield* Effect.forEach(
		payload.users,
		(user) =>
			upsertParticipant({
				conversationId: payload.conversationId,
				channelId: payload.channelId,
				userId: user.id,
				homeOrganizationId: payload.organizationId,
				isExternal: true,
				addedBy: payload.addedBy,
			}),
		{ discard: true },
	)
	const removed = current.filter((row) => !next.has(row.userId))
	yield* removeParticipants(removed)
	yield* Effect.annotateCurrentSpan({
		"connect.participants": next.size,
		"connect.participants_removed": removed.length,
	})
	yield* syncHostChannel(conversation.value.hostChannelId)
})

/** Host: take `organizationId` out of the conversation (its mount and its participants). */
export const removeGuestOrg = Effect.fn("OrgObject.connectRemoveGuestOrg")(function* (
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
) {
	const db = yield* Database.Database
	const conversation = yield* conversationOf(conversationId)
	if (Option.isNone(conversation)) return
	const now = new Date()
	yield* db.run(
		SQLite.update(schema.connectConversationChannelsTable)
			.set({ isActive: false, deletedAt: now, updatedAt: now })
			.where(($) => [
				$.conversationId.eq(conversationId),
				$.organizationId.eq(organizationId),
				$.role.eq("guest"),
				$.deletedAt.isNull(),
			]),
	)
	const participants = yield* db.run(
		SQLite.from(schema.connectParticipantsTable)
			.select("id", "userId")
			.where(($) => [
				$.conversationId.eq(conversationId),
				$.homeOrganizationId.eq(organizationId),
				$.deletedAt.isNull(),
			]),
	)
	yield* removeParticipants(participants)
	yield* syncHostChannel(conversation.value.hostChannelId)
	yield* publishConversation(conversationId)
})

/** Host: end the conversation for everyone. Messages keep their `conversationId`. */
export const endConversation = Effect.fn("OrgObject.connectEndConversation")(function* (
	conversationId: ConnectConversationId,
) {
	const db = yield* Database.Database
	const conversation = yield* conversationOf(conversationId)
	if (Option.isNone(conversation)) return
	const now = new Date()
	yield* db.run(
		SQLite.update(schema.connectConversationChannelsTable)
			.set({ isActive: false, deletedAt: now, updatedAt: now })
			.where(($) => [$.conversationId.eq(conversationId), $.deletedAt.isNull()]),
	)
	const participants = yield* db.run(
		SQLite.from(schema.connectParticipantsTable)
			.select("id", "userId")
			.where(($) => [$.conversationId.eq(conversationId), $.deletedAt.isNull()]),
	)
	yield* removeParticipants(participants)
	yield* db.run(
		SQLite.update(schema.connectConversationsTable)
			.set({ status: "disconnected", deletedAt: now, updatedAt: now })
			.where(($) => [$.id.eq(conversationId)]),
	)
	yield* syncHostChannel(conversation.value.hostChannelId)
	yield* publishConversation(conversationId)
})

/**
 * Guest: the host's conversation and mounts replace the copies here; the mounted channel follows
 * the host channel's name, icon and type. When the org's own mount went inactive (or came back),
 * its channel is reprojected (its own `ChannelObject` again, or the host's).
 */
export const conversationSnapshot = Effect.fn("OrgObject.connectConversationSnapshot")(function* (
	payload: ConversationSnapshotPayload,
) {
	const db = yield* Database.Database
	const channelIds = payload.mounts.filter((m) => m.role === "guest").map((m) => m.channelId)
	const local =
		channelIds.length === 0
			? []
			: yield* db.run(
					SQLite.from(schema.channelsTable)
						.select("id", "name", "icon", "type")
						.where(($) => [$.id.in_(...channelIds)]),
				)
	const own = payload.mounts.find((m) => local.some((channel) => channel.id === m.channelId))
	// Not mounted here (a stray delivery): keep nothing.
	if (own === undefined) return
	const before = yield* activeMountOf(own.channelId)

	yield* upsertConversation(fromConversationWire(payload.conversation))
	yield* Effect.forEach(payload.mounts, (mount) => upsertMount(fromMountWire(mount)), { discard: true })

	const channel = local.find((row) => row.id === own.channelId)!
	const host = payload.hostChannel
	const renamed = host !== null && (host.name !== channel.name || host.icon !== channel.icon)
	const retyped = host !== null && host.type !== channel.type
	if (host !== null && (renamed || retyped)) {
		yield* db.run(
			SQLite.update(schema.channelsTable)
				.set({ name: host.name, icon: host.icon, type: host.type, updatedAt: new Date() })
				.where(($) => [$.id.eq(own.channelId)]),
		)
	}
	const activeNow = own.isActive && own.deletedAt === null && payload.conversation.deletedAt === null
	if (retyped || Option.isSome(before) !== activeNow) yield* syncHostChannel(own.channelId)
	// Removed by the host (or the conversation ended): the host channel's messages leave search.
	if (Option.isSome(before) && !activeNow) yield* dropMountedSearch(own.channelId)
})

/** Host: the host channel's name, icon or type changed; guests' mounts mirror it. */
export const publishHostChannel = Effect.fn("OrgObject.connectPublishHostChannel")(function* (
	channelId: ChannelId,
) {
	const mount = yield* activeMountOf(channelId)
	if (Option.isNone(mount) || mount.value.role !== "host") return
	yield* publishConversation(mount.value.conversationId)
})

/**
 * Who may send a Connect effect here (`../effects/deliver.ts` runs it in the receiving
 * transaction): a guest org only about its own mount and readers, the host org only about a
 * conversation it hosts (and never one this org already knows under another host). Other kinds
 * pass. `Some(reason)` refuses.
 */
export const connectSenderRefusal = Effect.fn("OrgObject.connectSenderRefusal")(function* (
	kind: string,
	payload: unknown,
	sender: EffectSender,
) {
	const fromOrg = (organizationId: string, what: string) =>
		isOrgSender(sender, organizationId)
			? Option.none<string>()
			: Option.some(
					`${kind} ${what} ${organizationId} sent by ${sender.kind}${"id" in sender ? `:${sender.id}` : ""}`,
				)
	switch (kind) {
		case ConnectOrgEffects.mountAdded.name: {
			const { mount } = payload as typeof ConnectOrgEffects.mountAdded.payload.Type
			if (mount.role !== "guest") return Option.some(`${kind} must add a guest mount`)
			return fromOrg(mount.organizationId, "for org")
		}
		case ConnectOrgEffects.setParticipants.name:
		case ConnectOrgEffects.mountRemoved.name: {
			const { organizationId } = payload as { readonly organizationId: OrganizationId }
			return fromOrg(organizationId, "for org")
		}
		case ConnectOrgEffects.conversationSnapshot.name: {
			const { conversation } = payload as ConversationSnapshotPayload
			const refused = fromOrg(conversation.hostOrganizationId, "hosted by")
			if (Option.isSome(refused)) return refused
			const known = yield* conversationOf(conversation.id)
			if (
				Option.isSome(known) &&
				(known.value.hostOrganizationId !== conversation.hostOrganizationId ||
					known.value.hostChannelId !== conversation.hostChannelId)
			) {
				return Option.some(`${kind}: conversation ${conversation.id} has another host here`)
			}
			return Option.none()
		}
		default:
			return Option.none()
	}
})

export const connectOrgReceivers = {
	"org.connectMountAdded": mountAdded,
	"org.connectSetParticipants": setParticipants,
	"org.connectMountRemoved": (payload: {
		readonly conversationId: ConnectConversationId
		readonly organizationId: OrganizationId
	}) => removeGuestOrg(payload.conversationId, payload.organizationId),
	"org.connectConversationSnapshot": conversationSnapshot,
}
