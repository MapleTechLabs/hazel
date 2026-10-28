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
import type { ChatSyncChannelLink } from "@hazel/domain/models"
import type { ExternalMessageId, MessageId, MessageReactionId, UserId } from "@hazel/schema"
import { Cause, Effect, Option } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { MessageEventHook } from "../../worker/objects/channel/message-events"
import { enqueueEffect, type EffectReceivers } from "../../worker/objects/effects/registry"
import { orgTarget } from "../../worker/objects/kinds"
import { Directory } from "../directory"
import { formatMessageContentWithAttachments } from "./chat-sync-attachment-content"
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
import { ChatSyncProviderApiError, ChatSyncProviderConfigurationError } from "./chat-sync-provider-registry"
import {
	discordWebhookConfigOf,
	isWebhookStrategyEnabled,
	outboundIdentityOf,
	webhookPermission,
	webhookPermissionOf,
	withOutboundIdentity,
} from "./chat-sync-settings"
import { ChatSyncTransport, type DiscordWebhookTarget } from "./chat-sync-transport"

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
	if (error instanceof ChatSyncProviderApiError) {
		const status = error.status
		return status === undefined || status === 408 || status === 429 || status >= 500
	}
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
	}
}

const MENTION_PATTERN = /@\[userId:([^\]]+)\]/g

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

/** `@[userId:…]` → `<@discordId>` for linked accounts, else `@Name`. */
const translateMentions = (content: string, accounts: ReadonlyArray<ChatSyncLinkedAccount>) =>
	Effect.gen(function* () {
		const userIds = [...content.matchAll(MENTION_PATTERN)].map((match) => match[1] as UserId)
		if (userIds.length === 0) return content
		const linked = new Map(
			accounts
				.filter((account) => account.provider === "discord")
				.map((a) => [a.userId, a.externalAccountId]),
		)
		const names = yield* displayNames(userIds.filter((id) => !linked.has(id)))
		return content.replace(MENTION_PATTERN, (_match, userId: string) => {
			const external = linked.get(userId as UserId)
			if (external !== undefined) return `<@${external}>`
			const name = names.get(userId as UserId)?.name
			return name ? `@${name}` : "@unknown-user"
		})
	})

const outboundContent = (
	link: ChatSyncChannelTarget,
	content: string,
	accounts: ReadonlyArray<ChatSyncLinkedAccount>,
) => (link.provider === "discord" ? translateMentions(content, accounts) : Effect.succeed(content))

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
	})

/**
 * The link's Discord webhook, provisioned on first use when the link posts as each author.
 * `None`: post as the bot (webhooks off, refused, or failing).
 */
const discordWebhookOf = (link: ChatSyncChannelTarget) =>
	Effect.gen(function* () {
		if (link.provider !== "discord") return Option.none<DiscordWebhookTarget>()
		const identity = outboundIdentityOf(link.settings)
		if (!isWebhookStrategyEnabled(identity)) return Option.none<DiscordWebhookTarget>()
		const permission = webhookPermissionOf(link.settings)
		if (permission?.status === "denied") return Option.none<DiscordWebhookTarget>()
		const current = discordWebhookConfigOf(identity)
		if (Option.isSome(current)) return Option.some<DiscordWebhookTarget>(current.value)

		const transport = yield* ChatSyncTransport
		return yield* transport.discordWebhooks.create(link.externalChannelId).pipe(
			Effect.flatMap((created) =>
				persistLinkSettings(
					link,
					withOutboundIdentity(
						link.settings,
						{
							enabled: true,
							strategy: "webhook",
							providers: {
								...identity.providers,
								discord: { kind: "discord.webhook", ...created },
							},
						} as ChatSyncChannelLink.OutboundIdentitySettings,
						webhookPermission("allowed"),
					),
				).pipe(Effect.as(Option.some(created))),
			),
			Effect.catchTag("ChatSyncProviderConfigurationError", () =>
				Effect.succeed(Option.none<DiscordWebhookTarget>()),
			),
			// Discord refusing or failing the webhook leaves the bot identity; database errors propagate.
			Effect.catchTag("ChatSyncProviderApiError", (error) =>
				Effect.gen(function* () {
					const settings =
						error.status === 403
							? withOutboundIdentity(
									link.settings,
									{ ...identity, strategy: "fallback_bot" },
									webhookPermission(
										"denied",
										`Webhook create forbidden (HTTP ${error.status})`,
									),
								)
							: withOutboundIdentity(
									link.settings,
									identity,
									webhookPermission("unknown", error.message),
								)
					yield* persistLinkSettings(link, settings)
					yield* Effect.logWarning(
						"Failed to provision Discord webhook identity",
						Cause.fail(error),
						{
							externalChannelId: link.externalChannelId,
						},
					)
					return Option.none<DiscordWebhookTarget>()
				}),
			),
		)
	})

/** Run `viaWebhook` when the link has a webhook, falling back to the bot when Discord fails it. */
const withWebhookFallback = <A, E, R, E2, R2>(
	link: ChatSyncChannelTarget,
	viaWebhook: (webhook: DiscordWebhookTarget) => Effect.Effect<A, E | ChatSyncProviderApiError, R>,
	viaBot: Effect.Effect<A, E2, R2>,
) =>
	Effect.gen(function* () {
		const webhook = yield* discordWebhookOf(link)
		if (Option.isNone(webhook)) return yield* viaBot
		const sent = yield* viaWebhook(webhook.value).pipe(
			Effect.map(Option.some),
			Effect.catchTag("ChatSyncProviderApiError", (error) =>
				Effect.logWarning(
					"Discord webhook call failed; falling back to the bot",
					Cause.fail(error),
				).pipe(Effect.as(Option.none<A>())),
			),
		)
		return Option.isSome(sent) ? sent.value : yield* viaBot
	})

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
		const transport = yield* ChatSyncTransport
		const adapter = yield* transport.adapter(link.provider)
		const channelLinkId = link.channelLinkId
		const target = { externalChannelId: link.externalChannelId }

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
				if (attachmentRows.length > 0 && Option.isNone(transport.attachmentPublicUrlBase)) {
					return yield* new ChatSyncProviderConfigurationError({
						provider: link.provider,
						message: "S3_PUBLIC_URL is required for syncing message attachments",
					})
				}
				const base = Option.getOrElse(transport.attachmentPublicUrlBase, () => "").replace(/\/+$/, "")
				const attachments = attachmentRows.map((row) => ({ ...row, publicUrl: `${base}/${row.id}` }))
				const content = yield* outboundContent(link, message.value.content, accounts)
				const viaBot =
					attachments.length > 0
						? adapter.createMessageWithAttachments({
								...target,
								content,
								attachments,
								replyToExternalMessageId,
							})
						: adapter.createMessage({ ...target, content, replyToExternalMessageId })
				const externalMessageId = yield* withWebhookFallback(
					link,
					(webhook) =>
						Effect.gen(function* () {
							const author = (yield* displayNames([message.value.authorId])).get(
								message.value.authorId,
							)
							return yield* transport.discordWebhooks.execute({
								...webhook,
								content:
									attachments.length > 0
										? formatMessageContentWithAttachments({ content, attachments })
										: content,
								replyToExternalMessageId,
								username: author?.name || "Discord User",
								...(author?.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
							})
						}),
					viaBot,
				)
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
				const content = yield* outboundContent(link, message.value.content, accounts)
				yield* withWebhookFallback(
					link,
					(webhook) =>
						transport.discordWebhooks.update({
							...webhook,
							messageId: externalMessageId,
							content,
						}),
					adapter.updateMessage({ ...target, externalMessageId, content }),
				)
				yield* touchMessageLink(linked.value.id, {})
				return synced
			}
			case "MessageDelete": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				const externalMessageId = linked.value.externalMessageId as ExternalMessageId
				yield* withWebhookFallback(
					link,
					(webhook) =>
						transport.discordWebhooks.delete({ ...webhook, messageId: externalMessageId }),
					adapter.deleteMessage({ ...target, externalMessageId }),
				)
				yield* touchMessageLink(linked.value.id, { deletedAt: new Date() })
				return synced
			}
			case "ReactionCreate": {
				const linked = yield* findMessageLink({ channelLinkId, hazelMessageId: event.messageId })
				if (Option.isNone(linked)) return ignored("missing_link")
				yield* adapter.addReaction({
					...target,
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
				// Discord shows one bot reaction per emoji: keep it while Hazel users still react.
				if (Option.isSome(remaining)) return ignored("remaining_reactions_for_emoji")
				yield* adapter.removeReaction({
					...target,
					externalMessageId: linked.value.externalMessageId as ExternalMessageId,
					emoji: event.emoji,
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
	Database.Database | SqlClient | ChatSyncTransport | Directory
>
