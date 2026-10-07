import { ChannelId, ChannelMemberId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import * as Draft from "../../../composer/draft"
import * as MessageList from "../../../mount/message-list"
import type { HazelRpc } from "../../../rpc"
import type { PageOutMessage } from "../../out-message"
import {
	AttachmentInfo,
	BotInfo,
	ChannelMemberInfo,
	CustomEmojiInfo,
	Lookups,
	PinnedInfo,
	PresenceInfo,
	ReplyTarget,
	ThreadChannelInfo,
	ThreadMessageInfo,
	TypingInfo,
	UserInfo,
} from "../lookups"
import * as FilesPage from "../files/page"
import { ActionMessage } from "../message-actions"
import * as Overlays from "../overlays"
import { ChannelInfo, ParentChannelInfo } from "../queries"
import { ChatMessage, ChatReaction, DisplayRow } from "../rows"

/** The channel page's Model and Message (`page.ts` holds init and update, `write.ts` the write path). */

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
	/** `PinnedMessagesModal`'s pins, oldest pin first. */
	pinned: Schema.Array(PinnedInfo),
	/** The open thread panel's messages, oldest first. */
	threadMessages: Schema.Array(ChatMessage),
	typing: Schema.Array(TypingInfo),
	typingNowMs: Schema.Number,
	/** Ids the reply and thread lookups select, kept stable while the window does not change them. */
	replyIds: Schema.Array(MessageId),
	threadIds: Schema.Array(ChannelId),
	/** Oldest first, with date headers; what the list renders. */
	rows: Schema.Array(DisplayRow),
	limit: Schema.Number,
	/** Newest messages skipped: the window slides older once it holds `MAX_WINDOW` messages. */
	offset: Schema.Number,
	list: MessageList.Model,
	overlays: Overlays.Model,
	/** The Files tab (`$id/files` and `$id/files/media`), present while one of them is shown. */
	files: Schema.NullOr(FilesPage.Model),
	/** The channel composer's draft (`ChatProvider` + `ComposerEditor` state). */
	draft: Draft.Model,
	/** The thread panel's own draft, while a thread is open. */
	threadDraft: Schema.NullOr(Draft.Model),
	/** The signed-in user's membership of the open thread (its typing indicator). */
	threadMemberId: Schema.NullOr(ChannelMemberId),
	/** `isThreadCreating`: the thread the panel shows is still being created. */
	pendingThreadChannelId: Schema.NullOr(ChannelId),
	isGeneratingThreadName: Schema.Boolean,
	/** `channelMember.clearNotifications` was sent for this visit. */
	hasClearedNotifications: Schema.Boolean,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(ChannelInfo) },
	UpdatedOrgSlug: { orgSlug: Schema.NullOr(Schema.String) },
	ClickedTab: { tab: ChatTab },
	UpdatedParentChannel: { channel: Schema.NullOr(ParentChannelInfo) },
	UpdatedMessages: { messages: Schema.Array(ChatMessage) },
	/** The window as a change set: the ids in order, plus inserted and updated rows. */
	ChangedMessages: { order: Schema.Array(MessageId), upserts: Schema.Array(ChatMessage) },
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
	UpdatedPinned: { pins: Schema.Array(PinnedInfo) },
	UpdatedThreadPanelMessages: { messages: Schema.Array(ChatMessage) },
	UpdatedTyping: { typing: Schema.Array(TypingInfo) },
	TickedTypingClock: { nowMs: Schema.Number },
	GotListMessage: { message: MessageList.Message },
	GotOverlaysMessage: { message: Overlays.Message },
	GotFilesMessage: { message: FilesPage.Message },
	ClickedMobileMenu: {},
	GotDraftMessage: { message: Draft.Message },
	GotThreadDraftMessage: { message: Draft.Message },
	GotActionMessage: { message: ActionMessage },
	UpdatedThreadMember: { memberId: Schema.NullOr(ChannelMemberId) },
	ClickedGenerateThreadName: {},
	ClickedRenameThread: {},
	/** A printable key typed outside any input (`useGlobalKeyboardFocus`). */
	PressedGlobalKey: { key: Schema.String },
	/** The window lost focus or the tab was hidden: typing stops. */
	LeftWindow: {},
	SucceededClearNotifications: {},
	FailedClearNotifications: { reason: Schema.String },
})
export type Message = typeof Message.Type

export type PageReturn = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

