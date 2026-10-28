import { ChannelId, ChannelMemberId, MessageId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import type { Update } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as Live from "../../../chat/live-state"
import * as Unfurl from "../../../chat/unfurl"
import * as Draft from "../../../composer/draft"
import * as MessageList from "../../../mount/message-list"
import type { EditorRegistry } from "../../../editor/registry"
import type { HazelApiClient, HazelRpc } from "../../../rpc"
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
import { Message as ActionMessage } from "../message-actions"
import * as Overlays from "../overlays"
import { ChannelInfo, ParentChannelInfo } from "../queries"
import { ChatMessage, ChatReaction, DisplayRow } from "../rows"

/** The channel page's Model and Message (`page.ts` holds init and update, `write.ts` the write path). */

/** The tab a route names (`$id`, `$id/files`, `$id/files/media`); the tab bar and links speak it. */
export const ChatTab = Schema.Literals(["messages", "files", "media"])
export type ChatTab = typeof ChatTab.Type

// MODEL

/** The tab shown: the message list, or the Files Submodel (which knows whether it shows files or media). */
export const Tab = defineTaggedUnion({
	Messages: {},
	Files: { files: FilesPage.Model },
})
export type Tab = typeof Tab.Type

/** `isThreadCreating`: the panel opens on the optimistic id while `channel.createThread` runs. */
export const ThreadCreation = Schema.Literals(["Creating", "Created"])
export type ThreadCreation = typeof ThreadCreation.Type

/** `useChatThread`: the thread panel beside the channel, with everything that lives and dies with it. */
export const ThreadPanel = Schema.Struct({
	threadChannelId: ChannelId,
	/** The message the thread hangs off. */
	messageId: MessageId,
	/** The panel's own composer draft. */
	draft: Draft.Model,
	/** The signed-in user's membership of the thread (its typing indicator). */
	memberId: Schema.NullOr(ChannelMemberId),
	creation: ThreadCreation,
	/** "Generate thread name" is running for this thread. */
	isNaming: Schema.Boolean,
	/** The thread's messages, oldest first. */
	messages: Schema.Array(ChatMessage),
	/** Their rows, derived in `update` like the channel's. */
	rows: Schema.Array(DisplayRow.MessageRow),
})
export type ThreadPanel = typeof ThreadPanel.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	tab: Tab,
	orgSlug: Schema.String,
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
	typing: Schema.Array(TypingInfo),
	typingNowMs: Schema.Number,
	/** First names of the other members typing now (`useTypingIndicators`), derived in `update`. */
	typingNames: Schema.Array(Schema.String),
	/** Ids the reply and thread lookups select, kept stable while the window does not change them. */
	replyIds: Schema.Array(MessageId),
	threadIds: Schema.Array(ChannelId),
	/** Link previews and tweets fetched for the loaded messages, by `linkPreviewKey` / `tweetKey`. */
	unfurls: Unfurl.Unfurls,
	/** Streamed state of the AI replies with an open actor connection, by message id. */
	liveStates: Live.LiveStates,
	/** AI replies that hold a live socket, in the window or the open thread panel. */
	liveReplies: Schema.Array(Live.LiveReply),
	/** Oldest first, with date headers; what the list renders. */
	rows: Schema.Array(DisplayRow),
	limit: Schema.Number,
	/** Newest messages skipped: the window slides older once it holds `MAX_WINDOW` messages. */
	offset: Schema.Number,
	list: MessageList.Model,
	overlays: Overlays.Model,
	/** The channel composer's draft (`ChatProvider` + `ComposerEditor` state). */
	draft: Draft.Model,
	threadPanel: Schema.NullOr(ThreadPanel),
	/** `channelMember.clearNotifications` for this visit: not sent yet (or failed), in flight, done. */
	notificationsClear: Schema.Literals(["NotSent", "Sending", "Cleared"]),
	/** The non-member's "Join #channel" is running. */
	isJoining: Schema.Boolean,
	/**
	 * Row heights measured in channels visited earlier, by channel, least recent first. A revisit
	 * lays its rows out at their real heights on the switch frame; rows re-measure as they render.
	 */
	heightsByChannel: Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Number)),
})
export type Model = typeof Model.Type

/** What can go wrong clearing the channel's notifications, beyond the shared reasons. */
export const ClearNotificationsFailure = Schema.Union([Schema.Literals(["ChannelNotFound"]), CommonReason])
export type ClearNotificationsFailure = typeof ClearNotificationsFailure.Type

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedChannel: { channel: Schema.NullOr(ChannelInfo) },
	ClickedTab: { tab: ChatTab },
	UpdatedParentChannel: { channel: Schema.NullOr(ParentChannelInfo) },
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
	/** The open thread's messages, oldest first; tagged with the thread they were queried for. */
	UpdatedThreadPanelMessages: { threadChannelId: ChannelId, messages: Schema.Array(ChatMessage) },
	UpdatedTyping: { typing: Schema.Array(TypingInfo) },
	TickedTypingClock: { nowMs: Schema.Number },
	GotListMessage: { message: MessageList.Message },
	GotUnfurlMessage: { message: Unfurl.Message },
	GotLiveMessage: { message: Live.Message },
	GotOverlaysMessage: { message: Overlays.Message },
	GotFilesMessage: { message: FilesPage.Message },
	ClickedMobileMenu: {},
	GotDraftMessage: { message: Draft.Message },
	GotThreadDraftMessage: { message: Draft.Message },
	GotActionMessage: { message: ActionMessage },
	UpdatedThreadMember: { threadChannelId: ChannelId, memberId: Schema.NullOr(ChannelMemberId) },
	ClickedThreadPreview: { threadChannelId: ChannelId, messageId: MessageId },
	ClickedCloseThread: {},
	ClickedGenerateThreadName: {},
	ClickedRenameThread: {},
	ClickedJoinChannel: {},
	/** A printable key typed outside any input (`useGlobalKeyboardFocus`). */
	PressedGlobalKey: { key: Schema.String },
	/** The window lost focus or the tab was hidden: typing stops. */
	LeftWindow: {},
	SucceededClearNotifications: { channelId: ChannelId },
	FailedClearNotifications: { channelId: ChannelId, reason: ClearNotificationsFailure },
})
export type Message = typeof Message.Type

export type PageReturn = Update.ReturnWithOutMessage<
	Model,
	Message,
	PageOutMessage,
	HazelRpc | HazelApiClient | EditorRegistry
>
