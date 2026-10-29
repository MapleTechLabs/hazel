/**
 * Effects a `ChannelObject` receives. Its projections (`channel_viewers`, `channel_bots`) are
 * written only through these, by the channel's `OrgObject`.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { BotId, ChannelId, ConnectConversationId, OrganizationId, UserId } from "@hazel/schema"
import { StoredBotId } from "../wire-ids"
import { Effect, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { postSystemMessage, PostSystemMessagePayload } from "../channel/system-messages"
import { setThreadChannel, SetThreadChannelPayload, threadReceivers, ThreadEffects } from "../channel/thread"
import { AttachmentEffects, attachmentReceivers } from "../channel/attachments"
import { deleteObjectMeta, readObjectMeta, writeObjectMeta } from "../meta"
import { chatSyncChannelReceivers } from "../../../services/chat-sync/chat-sync-channel"
import { ChatSyncChannelEffects } from "../../../services/chat-sync/chat-sync-effects"
import { exportSearchMessages } from "../channel/search-index"
import { SearchChannelEffects } from "../search-wire"
import { defineEffect, type EffectReceivers, type EffectSender, isOrgSender } from "./registry"

export const ViewerRole = Schema.Literals(["owner", "admin", "member", "guest"])

export const ChannelViewer = Schema.Struct({
	userId: UserId,
	/** The viewer's own organization (a Connect guest's differs from the channel's). */
	organizationId: OrganizationId,
	role: ViewerRole,
})

/**
 * The channel's whole access, replacing the previous one: who may read it (its computed
 * `channel_access`), which bots receive its events, and the channel's org and conversation.
 * No viewers means the channel was deleted (or nobody may read it).
 */
export const SetViewersPayload = Schema.Struct({
	organizationId: OrganizationId,
	conversationId: Schema.NullOr(ConnectConversationId),
	viewers: Schema.Array(ChannelViewer),
	bots: Schema.Array(Schema.Struct({ botId: StoredBotId, botUserId: UserId })),
	/** A Connect host channel's guest mounts: their ids are routed here (`ChannelViewers.require`). */
	mountChannelIds: Schema.optionalKey(Schema.Array(ChannelId)),
	/**
	 * Increases with every `setViewers` the org sends (`publishChannelAccess`). The org delivers
	 * them out of order (right after its commit, retries later), so an older one is dropped.
	 */
	version: Schema.optionalKey(Schema.Number),
})
export type SetViewersPayload = typeof SetViewersPayload.Type

export const ChannelEffects = {
	setViewers: defineEffect("channel.setViewers", "channel", SetViewersPayload),
	/** From the `OrgObject`: a bot-authored message (RSS items), `../channel/system-messages.ts`. */
	postSystemMessage: defineEffect("channel.postSystemMessage", "channel", PostSystemMessagePayload),
	/** From the `OrgObject`'s `channel.createThread`: link the parent message to its thread. */
	setThreadChannel: defineEffect("channel.setThreadChannel", "channel", SetThreadChannelPayload),
	/** Thread origins, from the parent's object (`../channel/thread.ts`). */
	...ThreadEffects,
	/** From the api Worker's upload route (`../channel/attachments.ts`). */
	...AttachmentEffects,
	/** Chat sync, from the `OrgObject` (`services/chat-sync/chat-sync-channel.ts`). */
	...ChatSyncChannelEffects,
	/** The org's search backfill (`../channel/search-index.ts`). */
	...SearchChannelEffects,
}

/** Meta keys the channel's handlers read (see `../channel/channel-scope.ts`). */
export const CHANNEL_ORG_KEY = "organizationId"
export const CHANNEL_CONVERSATION_KEY = "conversationId"
/** JSON array of the guest mount channel ids served by this (host) channel's object. */
export const CHANNEL_MOUNTS_KEY = "mountChannelIds"
/** The `version` of the last applied `setViewers`. */
export const CHANNEL_VIEWERS_VERSION_KEY = "viewersVersion"

/** Set `conversationId` on the messages and reactions written before the channel was shared. */
const tagConversation = Effect.fn("ChannelEffects.tagConversation")(function* (
	conversationId: ConnectConversationId,
) {
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.messagesTable)
			.set({ conversationId })
			.where(($) => [$.conversationId.isNull()]),
	)
	yield* db.run(
		SQLite.update(schema.messageReactionsTable)
			.set({ conversationId })
			.where(($) => [$.conversationId.isNull()]),
	)
})

/** Writes only what changed, so an unchanged viewer's sockets are not resnapshotted. */
const setViewers = Effect.fn("ChannelEffects.setViewers")(function* (payload: SetViewersPayload) {
	const db = yield* Database.Database
	const applied = Option.map(yield* readObjectMeta(CHANNEL_VIEWERS_VERSION_KEY), Number)
	// Unversioned payloads predate versions, so any versioned one applied is newer.
	if (Option.isSome(applied) && (payload.version ?? -1) < applied.value) {
		yield* Effect.annotateCurrentSpan({ "channel.viewers_stale": true })
		return
	}
	if (payload.version !== undefined) {
		yield* writeObjectMeta(CHANNEL_VIEWERS_VERSION_KEY, String(payload.version))
	}
	const current = yield* db.run(SQLite.from(schema.channelViewersTable).select())
	const next = new Map(payload.viewers.map((viewer) => [viewer.userId, viewer]))
	const removed = current.filter((viewer) => !next.has(viewer.userId)).map((viewer) => viewer.userId)
	if (removed.length > 0) {
		yield* db.run(SQLite.deleteFrom(schema.channelViewersTable).where(($) => [$.userId.in_(...removed)]))
	}
	const byUser = new Map(current.map((viewer) => [viewer.userId, viewer]))
	const added = payload.viewers.filter((viewer) => !byUser.has(viewer.userId))
	const changed = payload.viewers.filter((viewer) => {
		const before = byUser.get(viewer.userId)
		return (
			before !== undefined &&
			(before.role !== viewer.role || before.organizationId !== viewer.organizationId)
		)
	})
	if (added.length > 0) {
		yield* db.run(
			SQLite.insertInto(schema.channelViewersTable).values(added.map((viewer) => ({ ...viewer }))),
		)
	}
	for (const viewer of changed) {
		yield* db.run(
			SQLite.update(schema.channelViewersTable)
				.set({ organizationId: viewer.organizationId, role: viewer.role })
				.where(($) => [$.userId.eq(viewer.userId)]),
		)
	}

	yield* db.run(SQLite.deleteFrom(schema.channelBotsTable).allRows())
	if (payload.bots.length > 0) {
		yield* db.run(
			SQLite.insertInto(schema.channelBotsTable).values(payload.bots.map((bot) => ({ ...bot }))),
		)
	}

	yield* writeObjectMeta(CHANNEL_ORG_KEY, payload.organizationId)
	if (payload.conversationId === null) yield* deleteObjectMeta(CHANNEL_CONVERSATION_KEY)
	else {
		const before = yield* readObjectMeta(CHANNEL_CONVERSATION_KEY)
		yield* writeObjectMeta(CHANNEL_CONVERSATION_KEY, payload.conversationId)
		// Shared just now: the channel's earlier messages join the conversation.
		if (Option.getOrUndefined(before) !== payload.conversationId) {
			yield* tagConversation(payload.conversationId)
		}
	}
	const mounts = payload.mountChannelIds ?? []
	if (mounts.length === 0) yield* deleteObjectMeta(CHANNEL_MOUNTS_KEY)
	else yield* writeObjectMeta(CHANNEL_MOUNTS_KEY, JSON.stringify(mounts))
	yield* Effect.annotateCurrentSpan({
		"channel.viewers": payload.viewers.length,
		"channel.viewers_removed": removed.length,
		"channel.viewers_added": added.length,
		"channel.viewers_changed": changed.length,
	})
})

/** Sent by a `ChannelObject` (the thread's parent), not by the owning org. */
const CHANNEL_SENT = new Set<string>([ThreadEffects.setThreadOrigin.name])
/** Sent by the api Worker (the upload route), which authorizes the uploader itself. */
const WORKER_SENT = new Set<string>([AttachmentEffects.createAttachment.name])

/**
 * Who may write to this channel. The first `setViewers` pins the owning org (`CHANNEL_ORG_KEY`);
 * after that only that org's `OrgObject` may send org effects, and `setViewers` may never move
 * the channel to another org (a Connect host channel stays its host org's: guests reach it
 * through the host org's `setViewers`). `Some(reason)` refuses.
 */
export const channelSenderRefusal = Effect.fn("ChannelEffects.senderRefusal")(function* (
	kind: string,
	payload: unknown,
	sender: EffectSender,
) {
	if (CHANNEL_SENT.has(kind)) {
		return sender.kind === "channel" ? Option.none() : Option.some(`${kind} must come from a channel`)
	}
	if (WORKER_SENT.has(kind)) {
		return sender.kind === "worker" ? Option.none() : Option.some(`${kind} must come from the api Worker`)
	}
	if (sender.kind !== "org") return Option.some(`${kind} must come from the channel's org`)
	const pinned = yield* readObjectMeta(CHANNEL_ORG_KEY)
	if (kind === ChannelEffects.setViewers.name) {
		const { organizationId } = payload as SetViewersPayload
		if (!isOrgSender(sender, organizationId)) {
			return Option.some(`setViewers for org ${organizationId} sent by org ${sender.id}`)
		}
		if (Option.isSome(pinned) && pinned.value !== organizationId) {
			return Option.some(`Channel belongs to org ${pinned.value}, not ${organizationId}`)
		}
		return Option.none()
	}
	if (Option.isNone(pinned)) {
		// The receiver answers an unclaimed channel with an empty page (it sends no messages).
		if (kind === SearchChannelEffects.exportSearchMessages.name) return Option.none()
		return Option.some(`${kind} before the channel's first setViewers`)
	}
	return pinned.value === sender.id
		? Option.none()
		: Option.some(`Channel belongs to org ${pinned.value}, not ${sender.id}`)
})

export const channelReceivers = {
	"channel.setViewers": setViewers,
	"channel.postSystemMessage": postSystemMessage,
	"channel.setThreadChannel": setThreadChannel,
	...threadReceivers,
	...attachmentReceivers,
	// Called lazily: the chat-sync module imports the effect registries back.
	"channel.setChatSyncLinks": (payload) => chatSyncChannelReceivers["channel.setChatSyncLinks"](payload),
	"channel.chatSyncIngest": (payload) => chatSyncChannelReceivers["channel.chatSyncIngest"](payload),
	"channel.chatSyncReassignAuthors": (payload) =>
		chatSyncChannelReceivers["channel.chatSyncReassignAuthors"](payload),
	"channel.exportSearchMessages": (payload) => exportSearchMessages(payload),
} satisfies EffectReceivers<typeof ChannelEffects, Database.Database | SqlClient>
