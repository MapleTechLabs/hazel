/**
 * Writes an `OrgObject` asks of a `ChannelObject` (receiver of `channel.postSystemMessage`,
 * `../effects/channel-effects.ts`): a message authored by an integration bot user (RSS items),
 * inserted under the sender's message id, so a redelivery cannot post twice.
 * (`channel.setThreadChannel` is `./thread.ts`.)
 * Its side effects run through `emitMessageEvent` (`./message-events.ts`).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { MessageEmbed } from "@hazel/domain/models"
import { ChannelId, ConnectConversationId, MessageId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { readObjectMeta } from "../meta"
import { emitMessageEvent } from "./message-events"

export const PostSystemMessagePayload = Schema.Struct({
	/** Chosen by the sender: the message's id, and its idempotency key. */
	id: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	embeds: Schema.NullOr(MessageEmbed.MessageEmbeds),
})
export type PostSystemMessagePayload = typeof PostSystemMessagePayload.Type

export const postSystemMessage = Effect.fn("ChannelObject.postSystemMessage")(function* (
	payload: PostSystemMessagePayload,
) {
	const db = yield* Database.Database
	const existing = yield* db.first(
		SQLite.from(schema.messagesTable)
			.select("id")
			.where(($) => [$.id.eq(payload.id)])
			.limit(1),
	)
	if (Option.isSome(existing)) return
	const conversation = yield* readObjectMeta("conversationId")
	yield* db.run(
		SQLite.insertInto(schema.messagesTable).values({
			id: payload.id,
			channelId: payload.channelId,
			conversationId: Option.getOrNull(
				Option.map(conversation, (id) => ConnectConversationId.make(id)),
			),
			authorId: payload.authorId,
			content: payload.content,
			// The table types embeds as mutable; the row is the same JSON.
			embeds: payload.embeds as schema.Message["embeds"],
			replyToMessageId: null,
			threadChannelId: null,
			deletedAt: null,
		}),
	)
	// Bots, notifications and chat-sync, as for `message.create`.
	const created = yield* db.first(
		SQLite.from(schema.messagesTable)
			.select()
			.where(($) => [$.id.eq(payload.id)])
			.limit(1),
	)
	if (Option.isSome(created)) yield* emitMessageEvent({ _tag: "MessageCreated", message: created.value })
})
