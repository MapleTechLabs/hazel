/**
 * What a `ChannelObject` message or reaction write sets off (the global message outbox and
 * `MessageSideEffectService`, rehomed). Handlers call `emitMessageEvent` inside their
 * `db.transaction`; each hook below enqueues its outbox effects there, so they commit with the
 * write and are delivered after it.
 *
 * - bots: `botGateway.messageEvent` (message create, update, delete);
 * - notifications: `org.messageCreated` to the channel's `OrgObject` (`../org/message-notifications.ts`);
 * - thread naming: `ai.nameThread` once a thread still called "Thread" has more than 3 replies.
 * - search: `org.indexMessages` (message create, update, delete), `./search-index.ts`.
 *
 * - chat sync: `chatSync.outbound` per outbound link (`services/chat-sync/chat-sync-outbound.ts`),
 *   except for writes that came from the provider.
 */
import { Database, type DatabaseError, SQLite, schema } from "@hazel/db"
import { parseMentions } from "@hazel/domain"
import type { Message, MessageReaction } from "@hazel/domain/models"
import { OrganizationId } from "@hazel/schema"
import { Effect, Option, type Schema } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { AI_EFFECT_DELAY_MS, AiEffects, DEFAULT_THREAD_NAME } from "../effects/ai-effects"
import { BotGatewayEffects } from "../effects/bot-gateway-effects"
import { enqueueEffect } from "../effects/registry"
import { MessageNotificationOrgEffects } from "../org/message-notifications"
import { chatSyncOutboundHook } from "../../../services/chat-sync/chat-sync-outbound"
import { SearchOrgEffects } from "../search-wire"
import { toIndexedMessage } from "./search-index"
import { claimThreadNaming, readThreadOrigin } from "./thread"

export type MessageRow = Schema.Schema.Type<typeof Message.Schema>
export type ReactionRow = Schema.Schema.Type<typeof MessageReaction.Schema>

export type MessageEvent =
	| { readonly _tag: "MessageCreated"; readonly message: MessageRow }
	| { readonly _tag: "MessageUpdated"; readonly message: MessageRow }
	| { readonly _tag: "MessageDeleted"; readonly message: MessageRow }
	| { readonly _tag: "ReactionCreated"; readonly reaction: ReactionRow }
	| { readonly _tag: "ReactionDeleted"; readonly reaction: ReactionRow }

export type MessageEventHook = (
	event: MessageEvent,
) => Effect.Effect<void, DatabaseError | Schema.SchemaError, Database.Database | SqlClient>

/** Threads are named once they have more replies than this. */
export const THREAD_NAMING_THRESHOLD = 3

/** The channel's organization, from the last `channel.setViewers`. */
const channelOrganization = Effect.gen(function* () {
	const db = yield* Database.Database
	const rows = yield* db.query(Database.sql`SELECT value FROM _object_meta WHERE key = 'organizationId'`)
	return Option.map(Option.fromNullishOr(rows[0]?.value as string | undefined), (id) =>
		OrganizationId.make(id),
	)
})

const botGatewayHook: MessageEventHook = (event) =>
	Effect.gen(function* () {
		const eventType =
			event._tag === "MessageCreated"
				? "message.create"
				: event._tag === "MessageUpdated"
					? "message.update"
					: event._tag === "MessageDeleted"
						? "message.delete"
						: undefined
		if (eventType === undefined || !("message" in event)) return
		const organizationId = yield* channelOrganization
		if (Option.isNone(organizationId)) return
		yield* enqueueEffect(
			BotGatewayEffects.messageEvent,
			{ kind: "bot-gateway" },
			{ organizationId: organizationId.value, eventType, message: event.message },
		)
	})

const notificationsHook: MessageEventHook = (event) =>
	Effect.gen(function* () {
		if (event._tag !== "MessageCreated") return
		const { message } = event
		const organizationId = yield* channelOrganization
		if (Option.isNone(organizationId)) return
		const db = yield* Database.Database
		const mentions = parseMentions(message.content)
		const replyTo =
			message.replyToMessageId === null
				? Option.none()
				: yield* db.first(
						SQLite.from(schema.messagesTable)
							.select("authorId")
							.where(($) => [$.id.eq(message.replyToMessageId!)])
							.limit(1),
					)
		yield* enqueueEffect(
			MessageNotificationOrgEffects.messageCreated,
			{ kind: "org", id: organizationId.value },
			{
				channelId: message.channelId,
				messageId: message.id,
				authorId: message.authorId,
				mentionedUserIds: mentions.userMentions,
				notifyAll: mentions.hasChannelMention || mentions.hasHereMention,
				replyToAuthorId: Option.getOrNull(Option.map(replyTo, (row) => row.authorId)),
			},
		)
	})

const threadNamingHook: MessageEventHook = (event) =>
	Effect.gen(function* () {
		if (event._tag !== "MessageCreated") return
		const { message } = event
		const origin = yield* readThreadOrigin
		if (Option.isNone(origin)) return
		const db = yield* Database.Database
		const counted = yield* db.first(
			SQLite.from(schema.messagesTable)
				.select(() => ({ count: SQLite.count() }))
				.where(($) => [$.channelId.eq(message.channelId), $.deletedAt.isNull()]),
		)
		const count = Option.match(counted, { onNone: () => 0, onSome: (row) => Number(row.count) })
		if (count <= THREAD_NAMING_THRESHOLD) return
		const organizationId = yield* channelOrganization
		if (Option.isNone(organizationId)) return
		if (!(yield* claimThreadNaming)) return
		yield* requestThreadName(organizationId.value, message.channelId, DEFAULT_THREAD_NAME)
	})

/** The org's search index follows every message write (`../org/message-search.ts`). */
const searchIndexHook: MessageEventHook = (event) =>
	Effect.gen(function* () {
		if (!("message" in event)) return
		const organizationId = yield* channelOrganization
		if (Option.isNone(organizationId)) return
		const { message } = event
		const removed = event._tag === "MessageDeleted" || message.deletedAt !== null
		yield* enqueueEffect(
			SearchOrgEffects.indexMessages,
			{ kind: "org", id: organizationId.value },
			removed
				? { upsert: [], remove: [message.id] }
				: { upsert: [toIndexedMessage(message)], remove: [] },
		)
	})

/** Enqueue `ai.nameThread` for the alarm; `onlyIfName` null renames whatever the name is. */
export const requestThreadName = (
	organizationId: OrganizationId,
	threadChannelId: MessageRow["channelId"],
	onlyIfName: string | null,
) =>
	enqueueEffect(
		AiEffects.nameThread,
		{ kind: "ai" },
		{ organizationId, threadChannelId, requestId: crypto.randomUUID(), onlyIfName },
		{ delayMs: AI_EFFECT_DELAY_MS },
	)

/** Every hook a message or reaction write runs, in order. */
export const onMessageEvent: ReadonlyArray<MessageEventHook> = [
	botGatewayHook,
	notificationsHook,
	threadNamingHook,
	searchIndexHook,
	// Lazy: the chat-sync module imports this one back.
	(event) => chatSyncOutboundHook(event),
]

/**
 * Run every hook for `event`; call it inside the write's `db.transaction`. A payload that does
 * not encode is a bug in the hook, so it is a defect.
 */
export const emitMessageEvent = (
	event: MessageEvent,
): Effect.Effect<void, DatabaseError, Database.Database | SqlClient> =>
	Effect.forEach(onMessageEvent, (hook) => hook(event), { discard: true }).pipe(
		Effect.catchTag("SchemaError", (error) => Effect.die(error)),
		Effect.withSpan("ChannelObject.emitMessageEvent", {
			attributes: { "message_event.tag": event._tag },
		}),
	)
