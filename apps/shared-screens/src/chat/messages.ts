// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The message list's data as Schemas (what its live queries send) and its messages. Split from the
 * component so its Commands (`live.ts`) and its view share them without a cycle.
 */
import { UiSchema } from "@effect/ui"
import { ChannelId, HtmlRenderId, MessageId, UserId } from "@hazel/schema"
import { Content, MessageAction } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { ProfileAction, ProfilePresence } from "./components/ProfileCard"
import { RichParts } from "./rich/embeds"
import { LiveEvent } from "./rich/live-replies"

export const ChatMessage = Schema.Struct({
	id: MessageId,
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	createdAtMs: Schema.Finite,
	updatedAtMs: Schema.NullOr(Schema.Finite),
	replyToMessageId: Schema.NullOr(MessageId),
	threadChannelId: Schema.NullOr(ChannelId),
	isPinned: Schema.Boolean,
	pinnedId: Schema.NullOr(Schema.String),
	/** Its embeds and the links its text unfurls (`rich/embeds.ts`). */
	rich: RichParts,
})

export const ChatUser = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	userType: Schema.String,
	email: Schema.NullOr(Schema.String),
	/** For the profile card's local time; absent where a host does not load it. */
	timezone: Schema.optionalKey(Schema.NullOr(Schema.String)),
})

export const ChatReaction = Schema.Struct({ messageId: MessageId, userId: UserId, emoji: Schema.String })

export const ChatAttachment = Schema.Struct({
	id: Schema.String,
	messageId: Schema.NullOr(MessageId),
	fileName: Schema.String,
	fileSize: Schema.Finite,
	url: Schema.String,
})

export const ThreadMessage = Schema.Struct({
	channelId: ChannelId,
	authorId: UserId,
	content: Schema.String,
	createdAtMs: Schema.Finite,
})

export const Named = Schema.Struct({ id: Schema.String, name: Schema.String })

export const ReplyTarget = Schema.Struct({ id: MessageId, authorId: UserId, content: Schema.String })

export const Activity = Schema.Struct({ lastMessageAtMs: Schema.Finite, lastMessageAuthorId: UserId })

/** What a row asks the host to do: the composer, threads and dialogs are the host's. */
export const HostRequest = Schema.Union([
	/** `image`: the attachment the web's right-click menu opened over (`copyImage`, `copyImageUrl`). */
	Schema.TaggedStruct("Action", {
		messageId: MessageId,
		action: MessageAction,
		content: Schema.String,
		/** The author's name as the list shows it (a reply's "Replying to"), "" when unknown. */
		author: Schema.String,
		image: Schema.optional(Schema.String),
	}),
	Schema.TaggedStruct("OpenThread", { messageId: MessageId, threadChannelId: Schema.NullOr(ChannelId) }),
	Schema.TaggedStruct("OpenLink", { url: Schema.String }),
	/**
	 * `index` counts the message's images and videos, as the image viewer does; -1 for a file.
	 * `media`: those images and videos, for a host that shows them itself (the phone's lightbox).
	 */
	Schema.TaggedStruct("OpenAttachment", {
		messageId: MessageId,
		attachmentId: Schema.String,
		url: Schema.String,
		index: Schema.Finite,
		media: Schema.optional(Schema.Array(Content.Attachment)),
	}),
	/** The profile card's "Edit profile": the host opens the viewer's profile settings. */
	Schema.TaggedStruct("EditProfile", {}),
	/** The profile card's "Message": the host opens the viewer's DM with `userId`, creating it if none. */
	Schema.TaggedStruct("MessageUser", { userId: UserId, viewerId: UserId, name: Schema.String }),
	/** The profile card's "View profile": the host opens the person's profile page. */
	Schema.TaggedStruct("ViewProfile", { userId: UserId }),
	/** The profile card's "Mention": the host puts `@person` into the conversation's draft. */
	Schema.TaggedStruct("MentionUser", { userId: UserId }),
	/** The profile card's copies: the host writes `text` to the clipboard and says what it was. */
	Schema.TaggedStruct("CopyProfileField", {
		field: Schema.Literals(["email", "userId"]),
		text: Schema.String,
	}),
	Schema.TaggedStruct("JumpToReply", { fromMessageId: MessageId, messageId: MessageId }),
	Schema.TaggedStruct("Retry", { messageId: MessageId }),
])
export type HostRequest = typeof HostRequest.Type

export const MessageListMessage = UiSchema.TaggedEnum({
	/** A change set of the window: every id in order, and the rows that changed. */
	UpdatedMessages: { order: Schema.Array(MessageId), upserts: Schema.Array(ChatMessage) },
	UpdatedHistory: { hasMore: Schema.Boolean },
	UpdatedReactions: { reactions: Schema.Array(ChatReaction) },
	UpdatedUsers: { users: Schema.Array(ChatUser) },
	UpdatedBots: { bots: Schema.Array(Named) },
	UpdatedAttachments: { attachments: Schema.Array(ChatAttachment) },
	UpdatedThreadNames: { threads: Schema.Array(Named) },
	UpdatedThreadMessages: { messages: Schema.Array(ThreadMessage) },
	UpdatedReplyTargets: { targets: Schema.Array(ReplyTarget) },
	/** The user's read position in the channel; null while they are not a member. */
	UpdatedReadPosition: { readUpToMs: Schema.NullOr(Schema.Finite) },
	/** The channel's newest message (`channel_activity`); null when it has none. */
	UpdatedActivity: { activity: Schema.NullOr(Activity) },
	Ticked: { nowMs: Schema.Finite },
	ReachedStart: {},
	ReachedEnd: {},
	PressedAction: { id: MessageId, action: MessageAction, image: Schema.optional(Schema.String) },
	PressedReaction: { id: MessageId, emoji: Schema.String },
	PressedAddReaction: { id: MessageId },
	/** A long press (or the web's right click): the row's actions in a sheet. */
	LongPressedMessage: { id: MessageId },
	DismissedMenu: {},
	PressedMenuAction: { action: MessageAction },
	PressedMenuReaction: { emoji: Schema.String },
	PickedReactionEmoji: { emoji: Schema.String },
	RequestedCloseEmojiPicker: {},
	PressedAuthor: { id: MessageId },
	PressedMention: { id: MessageId, userId: Schema.String, run: Schema.Finite },
	DismissedProfile: {},
	/** The open profile's presence row; null when the person has none. */
	UpdatedProfilePresence: { presence: Schema.NullOr(ProfilePresence) },
	PressedEditProfile: {},
	/** A button or menu entry of the open profile card, other than "Edit profile". */
	PressedProfileAction: { action: ProfileAction },
	PressedLink: { url: Schema.String },
	PressedAttachment: { id: MessageId, attachmentId: Schema.String },
	PressedReply: { id: MessageId },
	PressedThread: { id: MessageId },
	PressedRetry: { id: MessageId },
	PressedJumpToUnread: {},
	PressedMarkRead: {},
	/** One live reply's socket event (`rich/live-replies.ts`). */
	ReceivedLiveEvent: { messageId: MessageId, event: LiveEvent },
	/** An HTML render's fullscreen button, and the dialog closing (Escape in the page too). */
	PressedRenderFullscreen: { messageId: MessageId, renderId: HtmlRenderId },
	DismissedRenderFullscreen: {},
	CompletedCommand: {},
})
export type MessageListMessage = typeof MessageListMessage.Type
