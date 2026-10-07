import { ChannelId, MessageId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { pushUrl } from "foldkit/navigation"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import * as MessageList from "../../mount/message-list"
import { replyIdsOf, threadIdsOf, toDeriveContext, toDisplayRows } from "./derive"
import {
	AttachmentInfo,
	BotInfo,
	ChannelMemberInfo,
	CustomEmojiInfo,
	emptyLookups,
	Lookups,
	PresenceInfo,
	ReplyTarget,
	ThreadChannelInfo,
	ThreadMessageInfo,
	TypingInfo,
	UserInfo,
} from "./lookups"
import * as FilesPage from "./files/page"
import * as Overlays from "./overlays"
import { ChannelInfo, PAGE_SIZE, ParentChannelInfo } from "./queries"
import {
	ChatMessage,
	ChatReaction,
	DisplayRow,
	shareIds,
	shareKeys,
	shareMessages,
	shareStickyKeys,
} from "./rows"

/** Channel page (`routes/_app/$orgSlug/chat/$id.tsx` + `$id/index.tsx`), read path. */

export const ChatTab = Schema.Literals(["messages", "files", "media"])
export type ChatTab = typeof ChatTab.Type

// MODEL

export const Model = Schema.Struct({
	channelId: ChannelId,
	tab: ChatTab,
	orgSlug: Schema.NullOr(Schema.String),
	currentUserId: Schema.NullOr(UserId),
	channel: Schema.NullOr(ChannelInfo),
	parentChannel: Schema.NullOr(ParentChannelInfo),
	hasLoadedMessages: Schema.Boolean,
	/** Newest first, as the query returns them. */
	messages: Schema.Array(ChatMessage),
	reactions: Schema.Array(ChatReaction),
	lookups: Lookups,
	members: Schema.NullOr(Schema.Array(ChannelMemberInfo)),
	typing: Schema.Array(TypingInfo),
	typingNowMs: Schema.Number,
	/** Ids the reply and thread lookups select, kept stable while the window does not change them. */
	replyIds: Schema.Array(MessageId),
	threadIds: Schema.Array(ChannelId),
	/** Oldest first, with date headers; what the list renders. */
	rows: Schema.Array(DisplayRow),
	limit: Schema.Number,
	list: MessageList.Model,
	overlays: Overlays.Model,
	/** The Files tab (`$id/files` and `$id/files/media`), present while one of them is shown. */
	files: Schema.NullOr(FilesPage.Model),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(ChannelInfo) },
	UpdatedOrgSlug: { orgSlug: Schema.NullOr(Schema.String) },
	ClickedTab: { tab: ChatTab },
	CompletedNavigateToTab: {},
	UpdatedParentChannel: { channel: Schema.NullOr(ParentChannelInfo) },
	UpdatedMessages: { messages: Schema.Array(ChatMessage) },
	UpdatedReactions: { reactions: Schema.Array(ChatReaction) },
	UpdatedUsers: { users: Schema.Array(UserInfo) },
	UpdatedPresence: { presence: Schema.Array(PresenceInfo) },
	UpdatedBots: { bots: Schema.Array(BotInfo) },
	UpdatedCustomEmojis: { customEmojis: Schema.Array(CustomEmojiInfo) },
	UpdatedAttachments: { attachments: Schema.Array(AttachmentInfo) },
	UpdatedDiscordSynced: { messageIds: Schema.Array(MessageId) },
	UpdatedThreadChannels: { channels: Schema.Array(ThreadChannelInfo) },
	UpdatedThreadMessages: { messages: Schema.Array(ThreadMessageInfo) },
	UpdatedReplyTargets: { targets: Schema.Array(ReplyTarget) },
	UpdatedMembers: { members: Schema.Array(ChannelMemberInfo) },
	UpdatedTyping: { typing: Schema.Array(TypingInfo) },
	TickedTypingClock: { nowMs: Schema.Number },
	GotListMessage: { message: MessageList.Message },
	GotOverlaysMessage: { message: Overlays.Message },
	GotFilesMessage: { message: FilesPage.Message },
})
export type Message = typeof Message.Type

// INIT

export const listId = (channelId: string) => `message-list-${channelId}`

export interface InitOptions {
	readonly tab?: ChatTab
	readonly orgSlug?: string
}

export const init = (
	channelId: ChannelId,
	currentUserId: UserId | null,
	options: InitOptions = {},
): Model => ({
	channelId,
	tab: options.tab ?? "messages",
	orgSlug: options.orgSlug ?? null,
	currentUserId,
	channel: null,
	parentChannel: null,
	hasLoadedMessages: false,
	messages: [],
	reactions: [],
	lookups: emptyLookups,
	members: null,
	typing: [],
	typingNowMs: 0,
	replyIds: [],
	threadIds: [],
	rows: [],
	limit: PAGE_SIZE,
	list: MessageList.init({ id: listId(channelId), estimatedRowHeightPx: 80 }),
	overlays: Overlays.init(),
	files: filesFor(channelId, options.orgSlug ?? null, options.tab ?? "messages", null),
})

/** The Files Submodel for a tab: kept across `files` and `files/media`, dropped on Messages. */
const filesFor = (
	channelId: ChannelId,
	orgSlug: string | null,
	tab: ChatTab,
	previous: FilesPage.Model | null,
): FilesPage.Model | null =>
	tab === "messages"
		? null
		: previous === null
			? FilesPage.init(channelId, orgSlug ?? "", tab)
			: FilesPage.setView(previous, tab)

/** The route moved between this channel's tabs. */
export const setTab = (model: Model, tab: ChatTab): Model =>
	model.tab === tab
		? model
		: modifyFields(model, {
				tab: () => tab,
				files: (files) => filesFor(model.channelId, model.orgSlug, tab, files),
			})

// COMMAND

const tabPath = (orgSlug: string, channelId: ChannelId, tab: ChatTab) =>
	`/${orgSlug}/chat/${channelId}${tab === "messages" ? "" : tab === "files" ? "/files" : "/files/media"}`

/** `ChatTabBar`'s `navigate` on selection. */
const NavigateToTab = Command.define("NavigateToTab", {
	args: { path: Schema.String },
	messages: [Message.CompletedNavigateToTab],
	execute: ({ path }) => pushUrl(path).pipe(Effect.as(Message.CompletedNavigateToTab())),
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
	const rows = toDisplayRows(
		model.messages,
		model.reactions,
		toDeriveContext(model.lookups, model.currentUserId ?? undefined),
		model.rows,
	)
	const withRows = modifyFields(model, {
		rows: () => rows,
		replyIds: (previous) => shareIds(previous, replyIdsOf(model.messages)),
		threadIds: (previous) => shareIds(previous, threadIdsOf(model.messages)),
	})
	return liftList(
		withRows,
		MessageList.setKeys(
			withRows.list,
			shareKeys(withRows.list.keys, rows),
			shareStickyKeys(withRows.list.stickyKeys, rows),
		),
	)
}

const withLookup = <K extends keyof Lookups>(model: Model, key: K, value: Lookups[K]): PageReturn =>
	deriveRows(modifyFields(model, { lookups: (lookups) => ({ ...lookups, [key]: value }) }))

/** Widens the window by a page when the reader nears the oldest loaded message. */
const loadOlderWhenNearStart = (result: PageReturn): PageReturn => {
	const { model } = result
	const isPageFull = model.messages.length >= model.limit
	return isPageFull && MessageList.isNearStart(model.list)
		? { ...result, model: modifyFields(model, { limit: (limit) => limit + PAGE_SIZE }) }
		: result
}

const liftOverlays = (model: Model, result: Overlays.OverlaysReturn): PageReturn => ({
	model: result.model === model.overlays ? model : modifyFields(model, { overlays: () => result.model }),
	commands: Command.mapMessages(result.commands, (message) => Message.GotOverlaysMessage({ message })),
})

export const update = (model: Model, message: Message): PageReturn =>
	Message.match<PageReturn>(message, {
		UpdatedChannel: ({ channel }) => ({ model: modifyFields(model, { channel: () => channel }) }),
		UpdatedOrgSlug: ({ orgSlug }) =>
			orgSlug === null || model.orgSlug !== null
				? { model }
				: {
						model: modifyFields(model, {
							orgSlug: () => orgSlug,
							files: (files) => (files === null ? null : { ...files, orgSlug }),
						}),
					},
		ClickedTab: ({ tab }) =>
			tab === model.tab || model.orgSlug === null
				? { model }
				: {
						model,
						commands: [NavigateToTab({ path: tabPath(model.orgSlug, model.channelId, tab) })],
					},
		CompletedNavigateToTab: () => ({ model }),
		UpdatedParentChannel: ({ channel }) => ({
			model: modifyFields(model, { parentChannel: () => channel }),
		}),
		UpdatedMessages: ({ messages }) =>
			deriveRows(
				modifyFields(model, {
					hasLoadedMessages: () => true,
					messages: (previous) => shareMessages(previous, messages),
				}),
			),
		UpdatedReactions: ({ reactions }) => deriveRows(modifyFields(model, { reactions: () => reactions })),
		UpdatedUsers: ({ users }) => withLookup(model, "users", users),
		UpdatedPresence: ({ presence }) => withLookup(model, "presence", presence),
		UpdatedBots: ({ bots }) => withLookup(model, "bots", bots),
		UpdatedCustomEmojis: ({ customEmojis }) => withLookup(model, "customEmojis", customEmojis),
		UpdatedAttachments: ({ attachments }) => withLookup(model, "attachments", attachments),
		UpdatedDiscordSynced: ({ messageIds }) => withLookup(model, "discordSyncedIds", messageIds),
		UpdatedThreadChannels: ({ channels }) => withLookup(model, "threadChannels", channels),
		UpdatedThreadMessages: ({ messages }) => withLookup(model, "threadMessages", messages),
		UpdatedReplyTargets: ({ targets }) => withLookup(model, "replyTargets", targets),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		UpdatedTyping: ({ typing }) => ({ model: modifyFields(model, { typing: () => typing }) }),
		TickedTypingClock: ({ nowMs }) => ({ model: modifyFields(model, { typingNowMs: () => nowMs }) }),
		GotListMessage: ({ message: listMessage }) =>
			loadOlderWhenNearStart(liftList(model, MessageList.update(model.list, listMessage))),
		GotOverlaysMessage: ({ message: overlaysMessage }) =>
			liftOverlays(model, Overlays.update(model.overlays, overlaysMessage, factsOf(model))),
		GotFilesMessage: ({ message: filesMessage }) => {
			if (model.files === null) return { model }
			const result = FilesPage.update(model.files, filesMessage)
			return {
				model: modifyFields(model, { files: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (message) =>
					Message.GotFilesMessage({ message }),
				),
			}
		},
	})

/** Message facts the overlays read when a menu opens. */
export const factsOf = (model: Model): Overlays.MessageFacts => {
	const find = (messageId: MessageId) => model.messages.find((message) => message.id === messageId)
	return {
		isOwnMessage: (messageId) => find(messageId)?.authorId === model.currentUserId,
		isPinned: (messageId) => find(messageId)?.isPinned ?? false,
		isThreadChannel: model.channel?.type === "thread",
	}
}

/** The signed-in user arrived after the page was created (reactions need it for `hasReacted`). */
export const setCurrentUserId = (model: Model, currentUserId: UserId | null): PageReturn =>
	model.currentUserId === currentUserId
		? { model }
		: deriveRows(modifyFields(model, { currentUserId: () => currentUserId }))

/** `useIsChannelMember`: unknown until the members query has answered. */
export const isMemberOf = (model: Model): boolean | null =>
	model.members === null || model.currentUserId === null
		? null
		: model.members.some((member) => member.userId === model.currentUserId)
