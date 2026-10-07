import { ChannelId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, Subscription } from "foldkit"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as MessageList from "../../mount/message-list"
import { ChannelInfo, channelStream, messagesStream, PAGE_SIZE, reactionsStream } from "./data"
import {
	aggregateReactions,
	ChatMessage,
	ChatReaction,
	DisplayRow,
	shareKeys,
	shareMessages,
	toDisplayRows,
} from "./rows"

/** Channel page (`routes/_app/$orgSlug/chat/$id.tsx` + `$id/index.tsx`), read path. */

// MODEL

export const Model = Schema.Struct({
	channelId: ChannelId,
	currentUserId: Schema.NullOr(UserId),
	channel: Schema.NullOr(ChannelInfo),
	hasLoadedMessages: Schema.Boolean,
	/** Newest first, as the query returns them. */
	messages: Schema.Array(ChatMessage),
	reactions: Schema.Array(ChatReaction),
	/** Oldest first, with date headers; what the list renders. */
	rows: Schema.Array(DisplayRow),
	limit: Schema.Number,
	list: MessageList.Model,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(ChannelInfo) },
	UpdatedMessages: { messages: Schema.Array(ChatMessage) },
	UpdatedReactions: { reactions: Schema.Array(ChatReaction) },
	GotListMessage: { message: MessageList.Message },
})
export type Message = typeof Message.Type

// INIT

export const listId = (channelId: string) => `message-list-${channelId}`

export const init = (channelId: ChannelId, currentUserId: UserId | null): Model => ({
	channelId,
	currentUserId,
	channel: null,
	hasLoadedMessages: false,
	messages: [],
	reactions: [],
	rows: [],
	limit: PAGE_SIZE,
	list: MessageList.init({ id: listId(channelId), estimatedRowHeightPx: 80 }),
})

// UPDATE

export type PageReturn = Update.Return<Model, Message>

const liftList = (model: Model, result: MessageList.ListReturn): PageReturn => ({
	// An unchanged list keeps the page reference, so ignored events cost no render.
	model: result.model === model.list ? model : modifyFields(model, { list: () => result.model }),
	commands: Command.mapMessages(result.commands, (message) => Message.GotListMessage({ message })),
})

/** Re-derives the rows, then tells the list about the new keys so it can keep its anchor. */
const deriveRows = (model: Model): PageReturn => {
	const rows = toDisplayRows(model.messages, aggregateReactions(model.reactions, model.currentUserId ?? undefined), model.rows)
	const withRows = modifyFields(model, { rows: () => rows })
	return liftList(withRows, MessageList.setKeys(withRows.list, shareKeys(withRows.list.keys, rows)))
}

/** Widens the window by a page when the reader nears the oldest loaded message. */
const loadOlderWhenNearStart = (result: PageReturn): PageReturn => {
	const { model } = result
	const isPageFull = model.messages.length >= model.limit
	return isPageFull && MessageList.isNearStart(model.list)
		? { ...result, model: modifyFields(model, { limit: (limit) => limit + PAGE_SIZE }) }
		: result
}

export const update = (model: Model, message: Message): PageReturn =>
	Message.match<PageReturn>(message, {
		UpdatedChannel: ({ channel }) => ({ model: modifyFields(model, { channel: () => channel }) }),
		UpdatedMessages: ({ messages }) =>
			deriveRows(
				modifyFields(model, {
					hasLoadedMessages: () => true,
					messages: (previous) => shareMessages(previous, messages),
				}),
			),
		UpdatedReactions: ({ reactions }) => deriveRows(modifyFields(model, { reactions: () => reactions })),
		GotListMessage: ({ message: listMessage }) =>
			loadOlderWhenNearStart(liftList(model, MessageList.update(model.list, listMessage))),
	})

/** The signed-in user arrived after the page was created (reactions need it for `hasReacted`). */
export const setCurrentUserId = (model: Model, currentUserId: UserId | null): PageReturn =>
	model.currentUserId === currentUserId
		? { model }
		: deriveRows(modifyFields(model, { currentUserId: () => currentUserId }))

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()((entry) => ({
	channel: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: (model) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				channelStream(channelId, (channel) => Message.UpdatedChannel({ channel })),
		},
	),
	messages: entry(
		{ channelId: ChannelId, limit: Schema.Number },
		{
			modelToDependencies: (model) => ({ channelId: model.channelId, limit: model.limit }),
			dependenciesToStream: ({ channelId, limit }) =>
				messagesStream(channelId, limit, (messages) => Message.UpdatedMessages({ messages })),
		},
	),
	reactions: entry(
		{ channelId: ChannelId },
		{
			modelToDependencies: (model) => ({ channelId: model.channelId }),
			dependenciesToStream: ({ channelId }) =>
				reactionsStream(channelId, (reactions) => Message.UpdatedReactions({ reactions })),
		},
	),
}))
