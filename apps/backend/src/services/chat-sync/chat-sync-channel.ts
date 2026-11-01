/**
 * Chat sync inside a `ChannelObject`: it owns the channel's messages, their provider links
 * (`chat_sync_message_links`) and the dedupe receipts (`chat_sync_event_receipts`), and keeps a
 * copy of the channel's active links (`channel.setChatSyncLinks`, from its `OrgObject`).
 *
 * `channel.chatSyncIngest` writes an inbound provider event (its link and author resolved by the
 * org) once per dedupe key; `channel.chatSyncAttachThread` hangs a provider-made thread off the
 * synced message it was started on. Inbound writes run the channel's message events (bots, notifications)
 * like any write, flagged `InboundChatSyncWrite` so they produce no `chatSync.outbound`: a
 * provider message is not echoed back.
 */
import { MessageReactionRepo, MessageRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	ConnectConversationId,
	type ExternalMessageId,
	type MessageId,
	type SyncChannelLinkId,
	type SyncConnectionId,
} from "@hazel/schema"
import { Effect, Layer, Option, Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { emitMessageEvent, type MessageEvent } from "../../worker/objects/channel/message-events"
import { setThreadChannel } from "../../worker/objects/channel/thread"
import type { EffectReceivers } from "../../worker/objects/effects/registry"
import { readObjectMeta, writeObjectMeta } from "../../worker/objects/meta"
import {
	type AttachThreadPayload,
	type ChannelChatSyncIngestPayload,
	ChatSyncChannelEffects,
	InboundChatSyncWrite,
	type ReassignAuthorsPayload,
	SetChatSyncLinksPayload,
} from "./chat-sync-effects"

/** `_object_meta` key of the channel's links (the last `channel.setChatSyncLinks`). */
const LINKS_KEY = "chatSyncLinks"
/** Written by `channel.setViewers` (`worker/objects/effects/channel-effects.ts`). */
const CONVERSATION_KEY = "conversationId"

const decodeLinks = Schema.decodeUnknownOption(SetChatSyncLinksPayload)
const noLinks: SetChatSyncLinksPayload = { links: [], accounts: [] }

/** The channel's active links and the org's linked accounts, as last projected. */
export const readChatSyncLinks: Effect.Effect<SetChatSyncLinksPayload, never, SqlClient> = readObjectMeta(
	LINKS_KEY,
).pipe(
	Effect.map((raw) =>
		Option.getOrElse(
			Option.flatMap(raw, (value) => decodeLinks(JSON.parse(value))),
			() => noLinks,
		),
	),
	Effect.orDie,
)

export const writeChatSyncLinks = (payload: SetChatSyncLinksPayload) =>
	writeObjectMeta(LINKS_KEY, JSON.stringify(Schema.encodeSync(SetChatSyncLinksPayload)(payload)))

const setChatSyncLinks = Effect.fn("ChannelObject.setChatSyncLinks")(function* (
	payload: SetChatSyncLinksPayload,
) {
	yield* writeChatSyncLinks(payload)
	yield* Effect.annotateCurrentSpan({ "chat_sync.links": payload.links.length })
})

/** Claim `dedupeKey` for `source`; false when another delivery already did. */
export const claimReceipt = (params: {
	readonly syncConnectionId: SyncConnectionId
	readonly channelLinkId: SyncChannelLinkId
	readonly source: "hazel" | "external"
	readonly dedupeKey: string
}) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.insertInto(schema.chatSyncEventReceiptsTable)
				.values({
					...params,
					externalEventId: null,
					payloadHash: null,
					status: "processed",
					errorMessage: null,
				})
				.onConflictDoNothing({ target: ["syncConnectionId", "source", "dedupeKey"] })
				.returning("id"),
		),
	).pipe(Effect.map((rows) => rows.length > 0))

/** Mark a claimed receipt (ignored, failed), or drop it so a retry can claim it again. */
export const settleReceipt = (
	params: {
		readonly syncConnectionId: SyncConnectionId
		readonly source: "hazel" | "external"
		readonly dedupeKey: string
	},
	outcome: { readonly status: "ignored" | "failed"; readonly reason?: string } | "release",
) =>
	Effect.flatMap(Database.Database, (db) =>
		outcome === "release"
			? db.run(
					SQLite.deleteFrom(schema.chatSyncEventReceiptsTable).where(($) => [
						$.syncConnectionId.eq(params.syncConnectionId),
						$.source.eq(params.source),
						$.dedupeKey.eq(params.dedupeKey),
					]),
				)
			: db.run(
					SQLite.update(schema.chatSyncEventReceiptsTable)
						.set({
							status: outcome.status,
							errorMessage: outcome.reason ?? null,
							processedAt: new Date(),
						})
						.where(($) => [
							$.syncConnectionId.eq(params.syncConnectionId),
							$.source.eq(params.source),
							$.dedupeKey.eq(params.dedupeKey),
						]),
				),
	).pipe(Effect.asVoid)

/** The live link between this channel's message and the provider's, by either side. */
export const findMessageLink = (
	by:
		| { readonly channelLinkId: SyncChannelLinkId; readonly externalMessageId: ExternalMessageId }
		| { readonly channelLinkId: SyncChannelLinkId; readonly hazelMessageId: MessageId },
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.chatSyncMessageLinksTable)
				.select()
				.where(($) => [
					$.channelLinkId.eq(by.channelLinkId),
					"externalMessageId" in by
						? $.externalMessageId.eq(by.externalMessageId)
						: $.hazelMessageId.eq(by.hazelMessageId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		),
	)

const conversationIdOf = readObjectMeta(CONVERSATION_KEY).pipe(
	Effect.map((value) => Option.getOrNull(Option.map(value, (id) => ConnectConversationId.make(id)))),
)

const ingest = Effect.fn("ChannelObject.chatSyncIngest")(function* (payload: ChannelChatSyncIngestPayload) {
	const db = yield* Database.Database
	const messages = yield* MessageRepo
	const reactions = yield* MessageReactionRepo
	const { event, channelLinkId, organizationId } = payload
	const receipt = {
		syncConnectionId: payload.syncConnectionId,
		source: "external" as const,
		dedupeKey: payload.dedupeKey,
	}
	yield* Effect.annotateCurrentSpan({
		"chat_sync.event": event._tag,
		"chat_sync.link_id": channelLinkId,
		"chat_sync.dedupe_key": payload.dedupeKey,
	})
	if (!(yield* claimReceipt({ ...receipt, channelLinkId }))) {
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "deduped" })
		return
	}
	const ignore = (reason: string) =>
		settleReceipt(receipt, { status: "ignored", reason }).pipe(
			Effect.andThen(Effect.annotateCurrentSpan({ "chat_sync.outcome": reason })),
		)
	const emit = (messageEvent: MessageEvent) =>
		emitMessageEvent(messageEvent).pipe(Effect.provideService(InboundChatSyncWrite, true))

	const linked = yield* findMessageLink({ channelLinkId, externalMessageId: event.externalMessageId })

	if (event._tag === "MessageCreate") {
		if (Option.isSome(linked)) return yield* ignore("already_linked")
		const replyTo =
			event.externalReplyToMessageId === null
				? Option.none()
				: yield* findMessageLink({ channelLinkId, externalMessageId: event.externalReplyToMessageId })
		const [message] = yield* messages.insert({
			channelId: payload.channelId,
			conversationId: yield* conversationIdOf,
			authorId: event.authorId,
			content: event.content,
			embeds: null,
			replyToMessageId: Option.getOrNull(Option.map(replyTo, (link) => link.hazelMessageId)),
			threadChannelId: null,
			deletedAt: null,
		})
		const attachments = event.attachments.filter(
			(attachment) => attachment.fileName.trim() !== "" && attachment.publicUrl.trim() !== "",
		)
		if (attachments.length > 0) {
			const uploadedAt = Date.now()
			yield* db.run(
				SQLite.insertInto(schema.attachmentsTable).values(
					attachments.map((attachment, index) => ({
						organizationId,
						channelId: payload.channelId,
						messageId: message!.id,
						fileName: attachment.fileName.trim(),
						fileSize:
							Number.isFinite(attachment.fileSize) && attachment.fileSize >= 0
								? attachment.fileSize
								: 0,
						externalUrl: attachment.publicUrl.trim(),
						uploadedBy: event.authorId,
						status: "complete" as const,
						uploadedAt: new Date(uploadedAt + index),
						deletedAt: null,
					})),
				),
			)
		}
		yield* db.run(
			SQLite.insertInto(schema.chatSyncMessageLinksTable).values({
				channelLinkId,
				hazelMessageId: message!.id,
				externalMessageId: event.externalMessageId,
				source: "external",
				rootHazelMessageId: null,
				rootExternalMessageId: null,
				hazelThreadChannelId: null,
				externalThreadId: null,
				deletedAt: null,
			}),
		)
		yield* emit({ _tag: "MessageCreated", message: message! })
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "created", "message.id": message!.id })
		return
	}

	if (Option.isNone(linked)) return yield* ignore("missing_link")
	const hazelMessageId = linked.value.hazelMessageId

	switch (event._tag) {
		case "MessageUpdate": {
			const updated = yield* messages.update({
				id: hazelMessageId,
				content: event.content,
				updatedAt: new Date(),
			})
			yield* db.run(
				SQLite.update(schema.chatSyncMessageLinksTable)
					.set({ lastSyncedAt: new Date(), updatedAt: new Date() })
					.where(($) => [$.id.eq(linked.value.id)]),
			)
			yield* emit({ _tag: "MessageUpdated", message: updated })
			break
		}
		case "MessageDelete": {
			const deleted = yield* messages.update({
				id: hazelMessageId,
				deletedAt: new Date(),
				updatedAt: new Date(),
			})
			yield* emit({ _tag: "MessageDeleted", message: deleted })
			break
		}
		case "ReactionAdd": {
			const existing = yield* reactions.findByMessageUserEmoji(
				hazelMessageId,
				event.userId,
				event.emoji,
			)
			if (Option.isSome(existing)) return yield* ignore("already_exists")
			const [reaction] = yield* reactions.insert({
				messageId: hazelMessageId,
				channelId: payload.channelId,
				conversationId: yield* conversationIdOf,
				userId: event.userId,
				emoji: event.emoji,
			})
			yield* emit({ _tag: "ReactionCreated", reaction: reaction! })
			break
		}
		case "ReactionRemove": {
			const existing = yield* reactions.findByMessageUserEmoji(
				hazelMessageId,
				event.userId,
				event.emoji,
			)
			if (Option.isNone(existing)) return yield* ignore("already_deleted")
			yield* reactions.deleteById(existing.value.id)
			yield* emit({ _tag: "ReactionDeleted", reaction: existing.value })
			break
		}
	}
	yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "applied", "message.id": hazelMessageId })
})

/** Point the synced message at its thread, as an inbound write (nothing goes back out). */
const attachThread = Effect.fn("ChannelObject.chatSyncAttachThread")(function* (
	payload: AttachThreadPayload,
) {
	const linked = yield* findMessageLink({
		channelLinkId: payload.channelLinkId,
		externalMessageId: payload.externalMessageId,
	})
	yield* Effect.annotateCurrentSpan({
		"chat_sync.link_id": payload.channelLinkId,
		"chat_sync.outcome": Option.isSome(linked) ? "attached" : "missing_link",
	})
	if (Option.isNone(linked)) return
	const db = yield* Database.Database
	yield* db.run(
		SQLite.update(schema.chatSyncMessageLinksTable)
			.set({
				hazelThreadChannelId: payload.threadChannelId,
				externalThreadId: payload.externalThreadId,
				updatedAt: new Date(),
			})
			.where(($) => [$.id.eq(linked.value.id)]),
	)
	yield* setThreadChannel({
		messageId: linked.value.hazelMessageId,
		threadChannelId: payload.threadChannelId,
	}).pipe(Effect.provideService(InboundChatSyncWrite, true))
})

/** Move the channel's provider-synced messages from one author to another. */
const reassignAuthors = Effect.fn("ChannelObject.chatSyncReassignAuthors")(function* (
	payload: ReassignAuthorsPayload,
) {
	if (payload.channelLinkIds.length === 0 || payload.fromAuthorId === payload.toAuthorId) return
	const db = yield* Database.Database
	const synced = SQLite.from(schema.chatSyncMessageLinksTable)
		.select(($) => ({ hazelMessageId: $.hazelMessageId }))
		.where(($) => [
			$.channelLinkId.in_(...payload.channelLinkIds),
			$.source.eq("external"),
			$.deletedAt.isNull(),
		])
	const updated = yield* db.run(
		SQLite.update(schema.messagesTable)
			.set({ authorId: payload.toAuthorId, updatedAt: new Date() })
			.where(($) => [
				$.authorId.eq(payload.fromAuthorId),
				$.deletedAt.isNull(),
				SQLite.inSubquery($.id, synced),
			])
			.returning("id"),
	)
	yield* Effect.annotateCurrentSpan({ "chat_sync.reassigned": updated.length })
})

const repos = Layer.mergeAll(MessageRepo.layer, MessageReactionRepo.layer)

export const chatSyncChannelReceivers = {
	"channel.setChatSyncLinks": setChatSyncLinks,
	"channel.chatSyncIngest": (payload) => ingest(payload).pipe(Effect.provide(repos)),
	"channel.chatSyncReassignAuthors": reassignAuthors,
	"channel.chatSyncAttachThread": attachThread,
} satisfies EffectReceivers<typeof ChatSyncChannelEffects, Database.Database | SqlClient>
