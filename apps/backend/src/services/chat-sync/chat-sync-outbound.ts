/**
 * Hazel → provider, from a `ChannelObject`.
 *
 * `enqueueChatSyncOutbound` runs inside a message or reaction write's transaction: one
 * `chatSync.outbound` row per link that sends outbound. The channel's outbox delivers it after the
 * commit, right here (`deliverChatSyncOutbound`, target `chat-sync`): it reads the message and its
 * links from this object, calls the provider, and records the message link and receipt. Rows are
 * delivered in order, so a message's create precedes its update and delete.
 *
 * A failure that may succeed later (rate limits, 5xx, transport) drops the receipt claim and fails,
 * so the outbox retries it; any other failure marks the receipt `failed` and the row done.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, ExternalMessageId, MessageId, MessageReactionId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import type { MessageEventHook } from "../../worker/objects/channel/message-events"
import { enqueueEffect, type EffectReceivers } from "../../worker/objects/effects/registry"
import { orgTarget } from "../../worker/objects/kinds"
import { Directory } from "../directory"
import {
	claimReceipt,
	findMessageLink,
	readChatSyncLinks,
	settleReceipt,
	writeChatSyncLinks,
} from "./chat-sync-channel"
import {
	type ChatSyncChannelTarget,
	ChatSyncDeliveryEffects,
	type ChatSyncLinkedAccount,
	type ChatSyncOutboundEvent,
	type ChatSyncOutboundPayload,
	ChatSyncOrgEffects,
	InboundChatSyncWrite,
} from "./chat-sync-effects"
import { ChatSyncProviders } from "./chat-sync-providers"
import {
	ChatSyncProviderApiError,
	ChatSyncProviderConfigurationError,
	type ChatSyncLinkContext,
	type ChatSyncProviderDefinition,
	ChatSyncProviderNotSupportedError,
	isRetryableStatus,
} from "./provider"
import { definitionOf } from "./providers"

/**
 * Mirror a Hazel write on every outbound link of this channel. Call inside the write's
 * transaction, in a `ChannelObject`; never for a write that came from the provider.
 */
export const enqueueChatSyncOutbound = Effect.fn("ChatSync.enqueueOutbound")(function* (
	event: ChatSyncOutboundEvent,
) {
	const { links } = yield* readChatSyncLinks
	const outbound = links.filter((link) => link.direction !== "external_to_hazel")
	yield* Effect.forEach(
		outbound,
		(link) =>
			enqueueEffect(
				ChatSyncDeliveryEffects.outbound,
				{ kind: "chat-sync" },
				{ channelLinkId: link.channelLinkId, event },
			),
		{ discard: true },
	)
	yield* Effect.annotateCurrentSpan({ "chat_sync.event": event._tag, "chat_sync.links": outbound.length })
})

/** The events a handler passes to `enqueueChatSyncOutbound`. */
export const ChatSyncOutbound = {
	messageCreated: (messageId: MessageId): ChatSyncOutboundEvent => ({ _tag: "MessageCreate", messageId }),
	/** Each edit is its own delivery (`version` keys its receipt). */
	messageUpdated: (messageId: MessageId): ChatSyncOutboundEvent => ({
		_tag: "MessageUpdate",
		messageId,
		version: crypto.randomUUID(),
	}),
	messageDeleted: (messageId: MessageId): ChatSyncOutboundEvent => ({ _tag: "MessageDelete", messageId }),
	reactionCreated: (reaction: {
		readonly id: MessageReactionId
		readonly messageId: MessageId
		readonly emoji: string
	}): ChatSyncOutboundEvent => ({
		_tag: "ReactionCreate",
		reactionId: reaction.id,
		messageId: reaction.messageId,
		emoji: reaction.emoji,
	}),
	reactionDeleted: (reaction: {
		readonly messageId: MessageId
		readonly emoji: string
		readonly userId: UserId
	}): ChatSyncOutboundEvent => ({
		_tag: "ReactionDelete",
		messageId: reaction.messageId,
		emoji: reaction.emoji,
		userId: reaction.userId,
	}),
	threadCreated: (messageId: MessageId, threadChannelId: ChannelId): ChatSyncOutboundEvent => ({
		_tag: "ThreadCreate",
		messageId,
		threadChannelId,
	}),
}

/** The channel's message-event hook (`worker/objects/channel/message-events.ts`). */
export const chatSyncOutboundHook: MessageEventHook = (event) =>
	Effect.gen(function* () {
		if (yield* InboundChatSyncWrite) return
		switch (event._tag) {
			case "MessageCreated":
				return yield* enqueueChatSyncOutbound(ChatSyncOutbound.messageCreated(event.message.id))
			case "MessageUpdated":
				return yield* enqueueChatSyncOutbound(ChatSyncOutbound.messageUpdated(event.message.id))
			case "MessageDeleted":
				return yield* enqueueChatSyncOutbound(ChatSyncOutbound.messageDeleted(event.message.id))
			case "ReactionCreated":
				return yield* enqueueChatSyncOutbound(ChatSyncOutbound.reactionCreated(event.reaction))
			case "ReactionDeleted":
				return yield* enqueueChatSyncOutbound(ChatSyncOutbound.reactionDeleted(event.reaction))
		}
	})

/** Whether another attempt may succeed: database blips, transport failures, 408/429/5xx. */
export const isRetryableSyncFailure = (error: unknown): boolean => {
	if (error instanceof Database.DatabaseError) return true
	if (error instanceof ChatSyncProviderApiError) return isRetryableStatus(error.status)
	return false
}

const dedupeKeyOf = (event: ChatSyncOutboundEvent): string => {
	switch (event._tag) {
		case "MessageCreate":
			return `hazel:message:create:${event.messageId}`
		case "MessageUpdate":
			return `hazel:message:update:${event.messageId}:${event.version}`
		case "MessageDelete":
			return `hazel:message:delete:${event.messageId}`
		case "ReactionCreate":
			return `hazel:reaction:create:${event.reactionId}`
		case "ReactionDelete":
			return `hazel:reaction:delete:${event.messageId}:${event.emoji}:${event.userId}`
		case "ThreadCreate":
			return `hazel:thread:create:${event.threadChannelId}`
	}
}

const MENTION_PATTERN = /@\[userId:([^\]]+)\]/g

/** A provider thread's title: the message's first line, mentions dropped, within the limit. */
const threadNameOf = (definition: ChatSyncProviderDefinition, content: string) =>
	content
		.replace(MENTION_PATTERN, "")
		.split("\n")[0]!
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, definition.maxThreadNameLength) || "Thread"

/** Directory display names for `userIds` (D1 `users`). */
const displayNames = (userIds: ReadonlyArray<UserId>) =>
	Effect.gen(function* () {
		if (userIds.length === 0) return new Map<UserId, { name: string; avatarUrl: string | null }>()
		const directory = yield* Directory
		const rows = yield* directory.db.run(
			SQLite.from(schema.usersTable)
				.select("id", "firstName", "lastName", "avatarUrl")
				.where(($) => [$.id.in_(...new Set(userIds))]),
		)
		return new Map(
			rows.map((row) => [
				row.id,
				{
					name:
						[row.firstName, row.lastName].filter(Boolean).join(" ").trim() ||
						row.firstName.trim(),
					avatarUrl: row.avatarUrl?.trim() ? row.avatarUrl : null,
				},
			]),
		)
	})

/** `@[userId:…]` → the provider's mention for linked accounts, else `@Name`. */
const outboundContent = (
	definition: ChatSyncProviderDefinition,
	content: string,
	accounts: ReadonlyArray<ChatSyncLinkedAccount>,
) =>
	Effect.gen(function* () {
		const userIds = [...content.matchAll(MENTION_PATTERN)].map((match) => match[1] as UserId)
		if (userIds.length === 0) return content
		const linked = new Map(
			accounts
				.filter((account) => account.provider === definition.id)
				.map((account) => [account.userId, account.externalAccountId]),
		)
		const names = yield* displayNames(userIds.filter((id) => !linked.has(id)))
		return content.replace(MENTION_PATTERN, (_match, userId: string) => {
			const external = linked.get(userId as UserId)
			if (external !== undefined) return definition.mention(external)
			const name = names.get(userId as UserId)?.name
			return name ? `@${name}` : "@unknown-user"
		})
	})

/** Store new link settings here at once, and at the org (the owner), which re-projects them. */
const persistLinkSettings = (link: ChatSyncChannelTarget, settings: Record<string, unknown>) =>
	Effect.gen(function* () {
		const current = yield* readChatSyncLinks
		yield* writeChatSyncLinks({
			...current,
			links: current.links.map((entry) =>
				entry.channelLinkId === link.channelLinkId ? { ...entry, settings } : entry,
			),
		})
		yield* enqueueEffect(ChatSyncOrgEffects.chatSyncLinkSettings, orgTarget(link.organizationId), {
			channelLinkId: link.channelLinkId,
			settings,
		})
	}).pipe(
		Effect.catchTag("SqlError", (error) => Effect.fail(Database.toDatabaseError(error))),
		// Our own payload failing its schema is a bug, not a retry.
		Effect.catchIf(Schema.isSchemaError, Effect.die),
	)

const findMessage = (id: string) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.messagesTable)
				.select()
				.where(($) => [$.id.eq(id as never), $.deletedAt.isNull()])
				.limit(1),
		),
	)

const touchMessageLink = (id: string, set: { readonly deletedAt?: Date }) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.update(schema.chatSyncMessageLinksTable)
				.set({ lastSyncedAt: new Date(), updatedAt: new Date(), ...set })
				.where(($) => [$.id.eq(id as never)]),
		),
	)

type Outcome = { readonly status: "synced" } | { readonly status: "ignored"; readonly reason: string }
const synced: Outcome = { status: "synced" }
const ignored = (reason: string): Outcome => ({ status: "ignored", reason })

const deliver = (
	link: ChatSyncChannelTarget,
	accounts: ReadonlyArray<ChatSyncLinkedAccount>,
	event: ChatSyncOutboundEvent,
) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const providers = yield* ChatSyncProviders
		const definition = yield* Option.match(definitionOf(link.provider), {
			onNone: () => Effect.fail(new ChatSyncProviderNotSupportedError({ provider: link.provider })),
			onSome: Effect.succeed,
		})
		const client = yield* providers.client(link.provider)
		const channelLinkId = link.channelLinkId
		const sql = yield* SqlClient
		const context: ChatSyncLinkContext = {
			link,
			saveSettings: (settings) =>
				persistLinkSettings(link, settings).pipe(Effect.provideService(SqlClient, sql)),
		}

		switch (event._tag) {
			case "MessageCreate": {
				const message = yield* findMessage(event.messageId)
				if (Option.isNone(message)) return ignored("missing_message")
				if (
					Option.isSome(yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId }))
				) {
					return ignored("already_linked")
				}
				const reply =
					message.value.replyToMessageId === null
						? Option.none()
						: yield* findMessageLink({
								channelLinkId,
								hazelMessageId: message.value.replyToMessageId,
							})
				const replyToExternalMessageId = Option.getOrUndefined(
					Option.map(reply, (row) => row.externalMessageId as ExternalMessageId),
				)
				const attachmentRows = yield* db.run(
					SQLite.from(schema.attachmentsTable)
						.select("id", "fileName", "fileSize")
						.where(($) => [
							$.messageId.eq(event.messageId),
							$.status.eq("complete"),
							$.deletedAt.isNull(),
						])
						.orderBy(($) => [
							[$.uploadedAt, "asc"],
							[$.id, "asc"],
						]),
				)
				if (attachmentRows.length > 0 && Option.isNone(providers.attachmentPublicUrlBase)) {
					return yield* new ChatSyncProviderConfigurationError({
						provider: link.provider,
						message: "S3_PUBLIC_URL is required for syncing message attachments",
					})
				}
				const base = Option.getOrElse(providers.attachmentPublicUrlBase, () => "").replace(/\/+$/, "")
				const author = (yield* displayNames([message.value.authorId])).get(message.value.authorId)
				const externalMessageId = yield* client.postMessage(context, {
					content: yield* outboundContent(definition, message.value.content, accounts),
					attachments: attachmentRows.map((row) => ({ ...row, publicUrl: `${base}/${row.id}` })),
					replyToExternalMessageId,
					author: { name: author?.name ?? "", avatarUrl: author?.avatarUrl ?? null },
				})
				yield* db.run(
					SQLite.insertInto(schema.chatSyncMessageLinksTable).values({
						channelLinkId,
						hazelMessageId: event.messageId,
						externalMessageId,
						source: "hazel",
						rootHazelMessageId: null,
						rootExternalMessageId: null,
						hazelThreadChannelId: message.value.threadChannelId,
						externalThreadId: null,
						deletedAt: null,
					}),
				)
				return synced
			}
			case "MessageUpdate": {
				const message = yield* findMessage(event.messageId)
				if (Option.isNone(message)) return ignored("missing_message")
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				const externalMessageId = linked.value.externalMessageId as ExternalMessageId
				yield* client.updateMessage(context, {
					externalMessageId,
					content: yield* outboundContent(definition, message.value.content, accounts),
				})
				yield* touchMessageLink(linked.value.id, {})
				return synced
			}
			case "MessageDelete": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				const externalMessageId = linked.value.externalMessageId as ExternalMessageId
				yield* client.deleteMessage(context, { externalMessageId })
				yield* touchMessageLink(linked.value.id, { deletedAt: new Date() })
				return synced
			}
			case "ReactionCreate": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				yield* client.addReaction(context, {
					externalMessageId: linked.value.externalMessageId as ExternalMessageId,
					emoji: event.emoji,
				})
				return synced
			}
			case "ReactionDelete": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				const remaining = yield* db.first(
					SQLite.from(schema.messageReactionsTable)
						.select("id")
						.where(($) => [$.messageId.eq(event.messageId), $.emoji.eq(event.emoji)])
						.limit(1),
				)
				// The provider shows one bot reaction per emoji for all of Hazel: keep it while Hazel
				// users still react with it.
				if (Option.isSome(remaining)) return ignored("remaining_reactions_for_emoji")
				yield* client.removeReaction(context, {
					externalMessageId: linked.value.externalMessageId as ExternalMessageId,
					emoji: event.emoji,
				})
				return synced
			}
			case "ThreadCreate": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				if (linked.value.externalThreadId !== null) return ignored("already_linked")
				const message = yield* findMessage(event.messageId)
				if (Option.isNone(message)) return ignored("missing_message")
				const name = threadNameOf(definition, message.value.content)
				const externalThreadId = yield* client.createThread(context, {
					externalMessageId: linked.value.externalMessageId as ExternalMessageId,
					name,
				})
				yield* db.run(
					SQLite.update(schema.chatSyncMessageLinksTable)
						.set({
							hazelThreadChannelId: event.threadChannelId,
							externalThreadId,
							updatedAt: new Date(),
						})
						.where(($) => [$.id.eq(linked.value.id)]),
				)
				// The org owns channel links: it links the thread like its parent.
				yield* enqueueEffect(ChatSyncOrgEffects.chatSyncLinkThread, orgTarget(link.organizationId), {
					channelLinkId,
					threadChannelId: event.threadChannelId,
					externalThreadId,
					externalThreadName: name,
				})
				return synced
			}
		}
	})

/** The `chatSync.outbound` receiver: runs in the sending `ChannelObject`'s outbox. */
export const deliverChatSyncOutbound = Effect.fn("ChatSync.deliverOutbound")(function* (
	payload: ChatSyncOutboundPayload,
) {
	const { links, accounts } = yield* readChatSyncLinks
	const link = links.find((entry) => entry.channelLinkId === payload.channelLinkId)
	yield* Effect.annotateCurrentSpan({
		"chat_sync.event": payload.event._tag,
		"chat_sync.link_id": payload.channelLinkId,
	})
	// Unlinked (or turned inbound-only) since the write: nothing to mirror.
	if (link === undefined || link.direction === "external_to_hazel") {
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "link_gone" })
		return
	}
	yield* Effect.annotateCurrentSpan({ "chat_sync.provider": link.provider })
	const receipt = {
		syncConnectionId: link.syncConnectionId,
		source: "hazel" as const,
		dedupeKey: dedupeKeyOf(payload.event),
	}
	if (!(yield* claimReceipt({ ...receipt, channelLinkId: link.channelLinkId }))) {
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "deduped" })
		return
	}
	const outcome = yield* deliver(link, accounts, payload.event).pipe(
		Effect.catch((error) =>
			isRetryableSyncFailure(error)
				? settleReceipt(receipt, "release").pipe(Effect.andThen(Effect.fail(error)))
				: Effect.gen(function* () {
						const message = error instanceof Error ? error.message : String(error)
						yield* settleReceipt(receipt, { status: "failed", reason: message.slice(0, 500) })
						yield* Effect.logWarning("Chat sync delivery failed for good", {
							provider: link.provider,
							event: payload.event._tag,
							channelLinkId: link.channelLinkId,
							error: message,
						})
						return ignored("failed")
					}),
		),
	)
	if (outcome.status === "ignored")
		yield* settleReceipt(receipt, { status: "ignored", reason: outcome.reason })
	yield* Effect.annotateCurrentSpan({
		"chat_sync.outcome": outcome.status === "ignored" ? outcome.reason : "synced",
	})
})

export const chatSyncDeliveryReceivers = {
	"chatSync.outbound": deliverChatSyncOutbound,
} satisfies EffectReceivers<
	typeof ChatSyncDeliveryEffects,
	Database.Database | SqlClient | ChatSyncProviders | Directory
>
