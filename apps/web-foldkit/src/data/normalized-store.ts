import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ChatAuthor, ChatMessage, ChatReaction } from "../page/chat/rows"
import { type MessageQueryRow, toChatMessage, toChatReaction } from "../page/chat/queries"

/**
 * S2 option (b), prototype for measurement only: every synced message, user and reaction held in
 * the Foldkit Model as a normalized store, updated incrementally from Electric shape change rows.
 * Not wired into the app; `scripts/bench-s2-data.ts` drives it against the heavy dataset.
 */

export const Store = Schema.Struct({
	messagesById: Schema.Record(Schema.String, ChatMessage),
	/** Message ids per channel, oldest first. */
	messageIdsByChannel: Schema.Record(Schema.String, Schema.Array(Schema.String)),
	usersById: Schema.Record(Schema.String, ChatAuthor),
	reactionsByMessage: Schema.Record(Schema.String, Schema.Array(ChatReaction)),
})
export type Store = typeof Store.Type

export const emptyStore: Store = {
	messagesById: {},
	messageIdsByChannel: {},
	usersById: {},
	reactionsByMessage: {},
}

/** One decoded Electric change message (`headers.operation` + `value`), reduced to what the store reads. */
export type ShapeChange =
	| { readonly table: "users"; readonly operation: "insert" | "update"; readonly row: UserRow }
	| {
			readonly table: "messages"
			readonly operation: "insert" | "update" | "delete"
			readonly row: MessageRow
	  }
	| {
			readonly table: "message_reactions"
			readonly operation: "insert" | "delete"
			readonly row: ReactionRow
	  }

export interface UserRow {
	readonly id: string
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl: string | null
	readonly userType: string
}
export type MessageRow = Omit<MessageQueryRow, "author" | "pinnedMessage">
export interface ReactionRow {
	readonly id: string
	readonly messageId: MessageQueryRow["id"]
	readonly userId: MessageQueryRow["authorId"]
	readonly emoji: string
}

const UserRowSchema = Schema.Struct({
	id: Schema.String,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.String,
})
const MessageRowSchema = Schema.Struct({
	id: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	embeds: Schema.NullOr(Schema.Array(Schema.Unknown)),
	replyToMessageId: Schema.NullOr(MessageId),
	threadChannelId: Schema.NullOr(ChannelId),
	createdAt: Schema.Date,
	updatedAt: Schema.NullOr(Schema.Date),
})
const ReactionRowSchema = Schema.Struct({
	id: Schema.String,
	messageId: MessageId,
	userId: UserId,
	emoji: Schema.String,
})

/** The Message that would carry shape changes into update (validated on construction, like every Message). */
export const StoreMessage = defineMessageUnion({
	ReceivedShapeChanges: {
		changes: Schema.Array(
			Schema.Union([
				Schema.Struct({
					table: Schema.Literal("users"),
					operation: Schema.Literals(["insert", "update"]),
					row: UserRowSchema,
				}),
				Schema.Struct({
					table: Schema.Literal("messages"),
					operation: Schema.Literals(["insert", "update", "delete"]),
					row: MessageRowSchema,
				}),
				Schema.Struct({
					table: Schema.Literal("message_reactions"),
					operation: Schema.Literals(["insert", "delete"]),
					row: ReactionRowSchema,
				}),
			]),
		),
	},
})

/** Applies a batch of changes with copy-on-write records, so unchanged branches keep their references. */
export const applyChanges = (store: Store, changes: ReadonlyArray<ShapeChange>): Store => {
	const usersById = { ...store.usersById }
	let messagesById: Record<string, ChatMessage> | undefined
	let messageIdsByChannel: Record<string, ReadonlyArray<string>> | undefined
	// Channel id lists touched by this batch: copied once, appended to, sorted once at the end.
	const touchedChannels = new Map<string, string[]>()
	const idsFor = (channelId: string) => {
		let ids = touchedChannels.get(channelId)
		if (ids === undefined)
			touchedChannels.set(channelId, (ids = [...(store.messageIdsByChannel[channelId] ?? [])]))
		return ids
	}
	let reactionsByMessage: Record<string, ReadonlyArray<ChatReaction>> | undefined
	let usersChanged = false
	for (const change of changes) {
		if (change.table === "users") {
			usersById[change.row.id] = {
				firstName: change.row.firstName,
				lastName: change.row.lastName,
				avatarUrl: change.row.avatarUrl,
				userType: change.row.userType,
			}
			usersChanged = true
		} else if (change.table === "messages") {
			messagesById ??= { ...store.messagesById }
			messageIdsByChannel ??= { ...store.messageIdsByChannel }
			const { row } = change
			if (change.operation === "delete") {
				delete messagesById[row.id]
				const ids = idsFor(row.channelId)
				ids.splice(ids.indexOf(row.id), 1)
			} else {
				const isNew = messagesById[row.id] === undefined
				messagesById[row.id] = toChatMessage({
					...row,
					author: usersById[row.authorId] ?? null,
					pinnedMessage: null,
				})
				if (isNew) idsFor(row.channelId).push(row.id)
			}
		} else {
			reactionsByMessage ??= { ...store.reactionsByMessage }
			const current = reactionsByMessage[change.row.messageId] ?? []
			reactionsByMessage[change.row.messageId] =
				change.operation === "delete"
					? current.filter((reaction) => reaction.id !== change.row.id)
					: [...current, toChatReaction(change.row)]
		}
	}
	for (const [channelId, ids] of touchedChannels) {
		const byId = messagesById ?? store.messagesById
		// Usually already in order (a new message is the newest), so the check skips the sort.
		if (ids.some((id, index) => index > 0 && byId[ids[index - 1]!]!.createdAtMs > byId[id]!.createdAtMs))
			ids.sort((a, b) => byId[a]!.createdAtMs - byId[b]!.createdAtMs)
		messageIdsByChannel![channelId] = ids
	}
	return {
		usersById: usersChanged ? usersById : store.usersById,
		messagesById: messagesById ?? store.messagesById,
		messageIdsByChannel: messageIdsByChannel ?? store.messageIdsByChannel,
		reactionsByMessage: reactionsByMessage ?? store.reactionsByMessage,
	}
}

/** The page's view of the store: the newest `limit` messages of a channel, newest first. */
export const channelWindow = (store: Store, channelId: string, limit: number): ReadonlyArray<ChatMessage> => {
	const ids = store.messageIdsByChannel[channelId] ?? []
	const window: ChatMessage[] = []
	for (let index = ids.length - 1; index >= 0 && window.length < limit; index--)
		window.push(store.messagesById[ids[index]!]!)
	return window
}

/** Reactions of the messages in a window, in arrival order per message. */
export const windowReactions = (
	store: Store,
	window: ReadonlyArray<ChatMessage>,
): ReadonlyArray<ChatReaction> => window.flatMap((message) => store.reactionsByMessage[message.id] ?? [])
