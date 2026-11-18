/**
 * Discord gateway dispatches → `ChatSyncInbound`: decode and validate the payload, drop bot and
 * self-authored events, and build the stable dedupe key. Where the event goes
 * (`routeChatSyncInbound`) is the caller's `ingest`.
 */
import { createHash } from "node:crypto"
import type { Discord } from "@hazel/integrations"
import {
	ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	ExternalUserId,
	ExternalWebhookId,
} from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { ChatSyncAttachment, ChatSyncMention } from "../../chat-sync-effects"
import type { ChatSyncInbound } from "../../chat-sync-inbound"
import type { DiscordThreadInfo } from "./thread-parents"

export interface DiscordMessageAuthor {
	id?: string
	username?: string
	global_name?: string | null
	discriminator?: string
	avatar?: string | null
	bot?: boolean
}

export interface DiscordReadyEvent {
	user?: { id?: string }
}

export interface DiscordMessageCreateEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	id?: string
	channel_id?: string
	content?: string
	webhook_id?: string
	attachments?: ReadonlyArray<DiscordMessageAttachment>
	author?: DiscordMessageAuthor
	mentions?: ReadonlyArray<DiscordMessageAuthor>
	message_reference?: {
		message_id?: string
		channel_id?: string
	}
}

interface DiscordMessageAttachment {
	id?: string
	filename?: string
	size?: number
	url?: string
}

export interface DiscordMessageUpdateEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	id?: string
	channel_id?: string
	content?: string
	webhook_id?: string
	author?: DiscordMessageAuthor
	mentions?: ReadonlyArray<DiscordMessageAuthor>
	edited_timestamp?: string | null
}

export interface DiscordMessageDeleteEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	id?: string
	channel_id?: string
	webhook_id?: string
}

interface DiscordReactionEmoji {
	id?: string | null
	name?: string | null
}

export interface DiscordMessageReactionAddEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	channel_id?: string
	message_id?: string
	user_id?: string
	user?: DiscordMessageAuthor
	member?: {
		user?: DiscordMessageAuthor
	}
	emoji?: DiscordReactionEmoji
}

export interface DiscordMessageReactionRemoveEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	channel_id?: string
	message_id?: string
	user_id?: string
	user?: DiscordMessageAuthor
	member?: {
		user?: DiscordMessageAuthor
	}
	emoji?: DiscordReactionEmoji
}

export interface DiscordThreadCreateEvent {
	/** The guild (workspace) it happened in; absent in DMs. */
	guild_id?: string
	id?: string
	parent_id?: string
	name?: string
	type?: number
	/** Who started it; our bot for a thread mirrored from Hazel. */
	owner_id?: string
}

const formatDiscordDisplayName = (author?: DiscordMessageAuthor): string => {
	if (!author) return "Discord User"
	if (author.global_name) return author.global_name
	if (author.discriminator && author.discriminator !== "0") {
		return `${author.username ?? "discord-user"}#${author.discriminator}`
	}
	return author.username ?? "Discord User"
}

const buildAuthorAvatarUrl = (author?: DiscordMessageAuthor): string | null => {
	if (!author?.id || !author.avatar) return null
	return `https://cdn.discordapp.com/avatars/${author.id}/${author.avatar}.png`
}

export const normalizeDiscordMessageAttachments = (
	attachments: ReadonlyArray<DiscordMessageAttachment> | undefined,
): ReadonlyArray<ChatSyncAttachment> => {
	if (!attachments || attachments.length === 0) {
		return []
	}

	const normalized: Array<ChatSyncAttachment> = []
	for (const attachment of attachments) {
		const fileName = typeof attachment.filename === "string" ? attachment.filename.trim() : ""
		const publicUrl = typeof attachment.url === "string" ? attachment.url.trim() : ""
		if (!fileName || !publicUrl) {
			continue
		}

		normalized.push({
			externalAttachmentId:
				typeof attachment.id === "string" && attachment.id.trim().length > 0 ? attachment.id : null,
			fileName,
			fileSize:
				typeof attachment.size === "number" &&
				Number.isFinite(attachment.size) &&
				attachment.size >= 0
					? attachment.size
					: 0,
			publicUrl,
		})
	}

	return normalized
}

/** The users a message mentions, for names when they map to no Hazel user. */
export const normalizeDiscordMentions = (
	mentions: ReadonlyArray<DiscordMessageAuthor> | undefined,
): ReadonlyArray<ChatSyncMention> =>
	(mentions ?? []).flatMap((user) => {
		const id = decodeExternalUserId(user.id)
		return Option.isSome(id)
			? [{ externalUserId: id.value, displayName: formatDiscordDisplayName(user) }]
			: []
	})

export const extractReactionAuthor = (event: {
	member?: { user?: DiscordMessageAuthor }
	user?: DiscordMessageAuthor
}) => {
	const author = event.member?.user ?? event.user
	return {
		externalAuthorDisplayName: author ? formatDiscordDisplayName(author) : undefined,
		externalAuthorAvatarUrl: author ? buildAuthorAvatarUrl(author) : undefined,
	}
}

const formatDiscordEmoji = (emoji?: DiscordReactionEmoji): string | null => {
	if (!emoji?.name) return null
	if (emoji.id) return `${emoji.name}:${emoji.id}`
	return emoji.name
}

type ExternalIdDecoder<A> = (value: unknown) => Option.Option<A>

const decodeExternalChannelId: ExternalIdDecoder<ExternalChannelId> = (value) =>
	Schema.decodeUnknownOption(ExternalChannelId)(value)
const decodeExternalMessageId: ExternalIdDecoder<ExternalMessageId> = (value) =>
	Schema.decodeUnknownOption(ExternalMessageId)(value)
const decodeExternalThreadId: ExternalIdDecoder<ExternalThreadId> = (value) =>
	Schema.decodeUnknownOption(ExternalThreadId)(value)
const decodeExternalUserId: ExternalIdDecoder<ExternalUserId> = (value) =>
	Schema.decodeUnknownOption(ExternalUserId)(value)
const decodeExternalWebhookId: ExternalIdDecoder<ExternalWebhookId> = (value) =>
	Schema.decodeUnknownOption(ExternalWebhookId)(value)

export const decodeRequiredExternalId = <A>(value: unknown, decode: ExternalIdDecoder<A>): Option.Option<A> =>
	decode(value)

export const decodeOptionalExternalId = <A>(value: unknown, decode: ExternalIdDecoder<A>): A | undefined => {
	if (value === undefined) return undefined
	const decoded = decode(value)
	return Option.isSome(decoded) ? decoded.value : undefined
}

const getValueType = (value: unknown): string => (value === null ? "null" : typeof value)

const decodeRequiredExternalIdOrWarn = <A>(params: {
	eventType: string
	field: string
	value: unknown
	decode: ExternalIdDecoder<A>
}) =>
	Effect.gen(function* () {
		const decoded = decodeRequiredExternalId(params.value, params.decode)
		if (Option.isNone(decoded)) {
			yield* Effect.logWarning("Discord gateway dropped event: invalid external id", {
				eventType: params.eventType,
				field: params.field,
				valueType: getValueType(params.value),
			})
		}
		return decoded
	})

const decodeOptionalExternalIdOrWarn = <A>(params: {
	eventType: string
	field: string
	value: unknown
	decode: ExternalIdDecoder<A>
}) =>
	Effect.gen(function* () {
		const decoded = decodeOptionalExternalId(params.value, params.decode)
		if (params.value !== undefined && decoded === undefined) {
			yield* Effect.logWarning("Discord gateway ignored optional invalid external id", {
				eventType: params.eventType,
				field: params.field,
				valueType: getValueType(params.value),
			})
		}
		return decoded
	})

/** The event's guild, the workspace its channel link must be under. */
const guildOf = (event: { readonly guild_id?: string }): ReadonlyArray<string> =>
	typeof event.guild_id === "string" && event.guild_id.length > 0 ? [event.guild_id] : []

/** Discord message types a person writes: 0 (default) and 19 (reply). The rest are system notices. */
const PERSON_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19])

/**
 * A message from a channel's history as the `MessageCreate` its live event would have been, sent
 * at its own time (`sentAt`); `None` for a bot's, a webhook's (Hazel's own included) or a system
 * message. Keyed apart from live events: the channel's message link dedupes the two.
 */
export const discordHistoryInbound = (
	message: Discord.DiscordChannelMessage,
	guildId: string,
): Option.Option<ChatSyncInbound> => {
	if (!PERSON_MESSAGE_TYPES.has(message.type)) return Option.none()
	if (message.author.bot || message.webhook_id !== undefined) return Option.none()
	const channelId = decodeExternalChannelId(message.channel_id)
	const messageId = decodeExternalMessageId(message.id)
	const authorId = decodeExternalUserId(message.author.id)
	if (Option.isNone(channelId) || Option.isNone(messageId) || Option.isNone(authorId)) return Option.none()
	const sentAt = Date.parse(message.timestamp)
	const replyTo = decodeOptionalExternalId(message.message_reference?.message_id, decodeExternalMessageId)
	return Option.some<ChatSyncInbound>({
		provider: "discord",
		externalWorkspaceIds: [guildId],
		externalChannelId: channelId.value,
		dedupeKey: `discord:history:${messageId.value}`,
		author: {
			externalUserId: authorId.value,
			displayName: formatDiscordDisplayName(message.author),
			avatarUrl: buildAuthorAvatarUrl(message.author),
		},
		event: {
			_tag: "MessageCreate",
			externalMessageId: messageId.value,
			externalWebhookId: null,
			content: message.content,
			externalReplyToMessageId: replyTo ?? null,
			attachments: normalizeDiscordMessageAttachments(message.attachments),
			mentions: normalizeDiscordMentions(message.mentions),
			sentAt: Number.isNaN(sentAt) ? undefined : sentAt,
		},
	})
}

export const createDiscordGatewayDispatchHandlers = <E, R>(deps: {
	readonly ingest: (inbound: ChatSyncInbound) => Effect.Effect<void, E, R>
	readonly isCurrentBotAuthor: (authorId?: string) => Effect.Effect<boolean>
	/** The channel as a thread (its parent, name, starter); none for a channel that is not one. */
	readonly threadOf: (channelId: string) => Effect.Effect<Option.Option<DiscordThreadInfo>>
}) => {
	const required = <A>(eventType: string, field: string, value: unknown, decode: ExternalIdDecoder<A>) =>
		decodeRequiredExternalIdOrWarn({ eventType, field, value, decode })
	const optional = <A>(eventType: string, field: string, value: unknown, decode: ExternalIdDecoder<A>) =>
		decodeOptionalExternalIdOrWarn({ eventType, field, value, decode })

	/**
	 * Where an event in `channelId` routes: a thread's events go by their parent channel and name
	 * the thread (`inExternalThreadId`), so the org finds, or makes, the thread's link. A thread our
	 * bot started mirrors a Hazel thread, which Hazel links itself: its events keep its own id, so
	 * an early reply never makes a second Hazel thread.
	 */
	const routeOf = (channelId: ExternalChannelId) =>
		Effect.gen(function* () {
			const thread = yield* deps.threadOf(channelId)
			if (
				Option.isNone(thread) ||
				(yield* deps.isCurrentBotAuthor(thread.value.ownerId ?? undefined))
			) {
				return { externalChannelId: channelId, thread: {}, threadName: {} }
			}
			return {
				externalChannelId: thread.value.parentId,
				thread: { inExternalThreadId: ExternalThreadId.make(channelId) },
				threadName: thread.value.name === null ? {} : { externalThreadName: thread.value.name },
			}
		})

	const ingestMessageCreateEvent = Effect.fn("DiscordGateway.ingestMessageCreateEvent")(function* (
		event: DiscordMessageCreateEvent,
	) {
		if (!event.id || !event.channel_id || typeof event.content !== "string") return
		if (event.author?.bot) return
		if (yield* deps.isCurrentBotAuthor(event.author?.id)) return
		const channelId = yield* required(
			"MESSAGE_CREATE",
			"channel_id",
			event.channel_id,
			decodeExternalChannelId,
		)
		if (Option.isNone(channelId)) return
		const messageId = yield* required("MESSAGE_CREATE", "id", event.id, decodeExternalMessageId)
		if (Option.isNone(messageId)) return
		const authorId = yield* optional(
			"MESSAGE_CREATE",
			"author.id",
			event.author?.id,
			decodeExternalUserId,
		)
		const replyTo = yield* optional(
			"MESSAGE_CREATE",
			"message_reference.message_id",
			event.message_reference?.message_id,
			decodeExternalMessageId,
		)
		const webhookId = yield* optional(
			"MESSAGE_CREATE",
			"webhook_id",
			event.webhook_id,
			decodeExternalWebhookId,
		)
		const route = yield* routeOf(channelId.value)
		yield* deps.ingest({
			provider: "discord",
			externalWorkspaceIds: guildOf(event),
			externalChannelId: route.externalChannelId,
			dedupeKey: `discord:gateway:create:${messageId.value}`,
			author:
				authorId === undefined
					? null
					: {
							externalUserId: authorId,
							displayName: formatDiscordDisplayName(event.author),
							avatarUrl: buildAuthorAvatarUrl(event.author),
						},
			event: {
				_tag: "MessageCreate",
				externalMessageId: messageId.value,
				externalWebhookId: webhookId ?? null,
				content: event.content,
				externalReplyToMessageId: replyTo ?? null,
				attachments: normalizeDiscordMessageAttachments(event.attachments),
				mentions: normalizeDiscordMentions(event.mentions),
				...route.thread,
				...route.threadName,
			},
		})
	})

	const ingestMessageUpdateEvent = Effect.fn("DiscordGateway.ingestMessageUpdateEvent")(function* (
		event: DiscordMessageUpdateEvent,
	) {
		if (!event.id || !event.channel_id || typeof event.content !== "string") return
		if (event.author?.bot) return
		if (yield* deps.isCurrentBotAuthor(event.author?.id)) return
		const channelId = yield* required(
			"MESSAGE_UPDATE",
			"channel_id",
			event.channel_id,
			decodeExternalChannelId,
		)
		if (Option.isNone(channelId)) return
		const messageId = yield* required("MESSAGE_UPDATE", "id", event.id, decodeExternalMessageId)
		if (Option.isNone(messageId)) return
		const webhookId = yield* optional(
			"MESSAGE_UPDATE",
			"webhook_id",
			event.webhook_id,
			decodeExternalWebhookId,
		)
		const version =
			event.edited_timestamp ??
			createHash("sha256").update(`${messageId.value}:${event.content}`).digest("hex").slice(0, 16)
		const route = yield* routeOf(channelId.value)
		yield* deps.ingest({
			provider: "discord",
			externalWorkspaceIds: guildOf(event),
			externalChannelId: route.externalChannelId,
			dedupeKey: `discord:gateway:update:${messageId.value}:${version}`,
			author: null,
			event: {
				_tag: "MessageUpdate",
				externalMessageId: messageId.value,
				externalWebhookId: webhookId ?? null,
				content: event.content,
				mentions: normalizeDiscordMentions(event.mentions),
				...route.thread,
			},
		})
	})

	const ingestMessageDeleteEvent = Effect.fn("DiscordGateway.ingestMessageDeleteEvent")(function* (
		event: DiscordMessageDeleteEvent,
	) {
		if (!event.id || !event.channel_id) return
		const channelId = yield* required(
			"MESSAGE_DELETE",
			"channel_id",
			event.channel_id,
			decodeExternalChannelId,
		)
		if (Option.isNone(channelId)) return
		const messageId = yield* required("MESSAGE_DELETE", "id", event.id, decodeExternalMessageId)
		if (Option.isNone(messageId)) return
		const webhookId = yield* optional(
			"MESSAGE_DELETE",
			"webhook_id",
			event.webhook_id,
			decodeExternalWebhookId,
		)
		const route = yield* routeOf(channelId.value)
		yield* deps.ingest({
			provider: "discord",
			externalWorkspaceIds: guildOf(event),
			externalChannelId: route.externalChannelId,
			dedupeKey: `discord:gateway:delete:${messageId.value}`,
			author: null,
			event: {
				_tag: "MessageDelete",
				externalMessageId: messageId.value,
				externalWebhookId: webhookId ?? null,
				...route.thread,
			},
		})
	})

	const ingestReaction = (eventType: "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE") =>
		Effect.fn(`DiscordGateway.ingest${eventType}`)(function* (
			event: DiscordMessageReactionAddEvent | DiscordMessageReactionRemoveEvent,
		) {
			if (!event.channel_id || !event.message_id || !event.user_id) return
			if (yield* deps.isCurrentBotAuthor(event.user_id)) return
			const emoji = formatDiscordEmoji(event.emoji)
			if (!emoji) return
			const channelId = yield* required(
				eventType,
				"channel_id",
				event.channel_id,
				decodeExternalChannelId,
			)
			if (Option.isNone(channelId)) return
			const messageId = yield* required(
				eventType,
				"message_id",
				event.message_id,
				decodeExternalMessageId,
			)
			if (Option.isNone(messageId)) return
			const userId = yield* required(eventType, "user_id", event.user_id, decodeExternalUserId)
			if (Option.isNone(userId)) return
			const { externalAuthorDisplayName, externalAuthorAvatarUrl } = extractReactionAuthor(event)
			const add = eventType === "MESSAGE_REACTION_ADD"
			const route = yield* routeOf(channelId.value)
			yield* deps.ingest({
				provider: "discord",
				externalWorkspaceIds: guildOf(event),
				externalChannelId: route.externalChannelId,
				dedupeKey: `discord:gateway:reaction:${add ? "add" : "remove"}:${channelId.value}:${messageId.value}:${userId.value}:${emoji}`,
				author: {
					externalUserId: userId.value,
					displayName: externalAuthorDisplayName ?? "Discord User",
					avatarUrl: externalAuthorAvatarUrl ?? null,
				},
				event: {
					_tag: add ? "ReactionAdd" : "ReactionRemove",
					externalMessageId: messageId.value,
					emoji,
					...route.thread,
				},
			})
		})

	const ingestThreadCreateEvent = Effect.fn("DiscordGateway.ingestThreadCreateEvent")(function* (
		event: DiscordThreadCreateEvent,
	) {
		if (!event.id || !event.parent_id) return
		// 11: public thread, 12: private thread.
		if (event.type !== undefined && event.type !== 11 && event.type !== 12) return
		// Our own thread (mirrored from Hazel): the org links it when the creating delivery reports.
		if (yield* deps.isCurrentBotAuthor(event.owner_id)) return
		const parentId = yield* required(
			"THREAD_CREATE",
			"parent_id",
			event.parent_id,
			decodeExternalChannelId,
		)
		if (Option.isNone(parentId)) return
		const threadId = yield* required("THREAD_CREATE", "id", event.id, decodeExternalThreadId)
		if (Option.isNone(threadId)) return
		yield* deps.ingest({
			provider: "discord",
			externalWorkspaceIds: guildOf(event),
			externalChannelId: parentId.value,
			dedupeKey: `discord:gateway:thread:create:${threadId.value}`,
			author: null,
			event: {
				_tag: "ThreadCreate",
				externalThreadId: threadId.value,
				name: event.name ?? "Thread",
				// A public thread may be started on a message, and then takes the message's id (the
				// parent channel ignores one with no synced message). Private threads never are.
				...(event.type === 12
					? {}
					: { externalParentMessageId: ExternalMessageId.make(threadId.value) }),
			},
		})
	})

	return {
		ingestMessageCreateEvent,
		ingestMessageUpdateEvent,
		ingestMessageDeleteEvent,
		ingestMessageReactionAddEvent: ingestReaction("MESSAGE_REACTION_ADD"),
		ingestMessageReactionRemoveEvent: ingestReaction("MESSAGE_REACTION_REMOVE"),
		ingestThreadCreateEvent,
	}
}
