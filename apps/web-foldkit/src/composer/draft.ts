import {
	AttachmentId,
	BotId,
	ChannelId,
	type ChannelMemberId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, File } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { editMessageAction, sendMessageAction } from "~/db/actions"
import { CommonReason } from "~/lib/error-messages"
import { HazelApiClient } from "../rpc"
import { ToastRequest } from "../overlay/toasts"
import { catchCommon } from "../data/actions"
import * as Composer from "./composer"
import * as Typing from "./typing"
import * as EmojiDialog from "../emoji-picker/dialog"
import * as GifPicker from "../gif-picker/picker"
import { DragState, DropEvent } from "./drop"
import { UploadEvent } from "./upload"

/**
 * One channel's draft: the composer plus the `ChatProvider` draft state (reply, edit,
 * attachments, uploads) and `useTyping`. The channel and the thread panel each hold one.
 * Its update is `draft-update.ts`; this module holds the Model, Messages and Commands.
 */

// MODEL

/** What Send does with the draft: a new message, a reply, or an edit (never both). */
export const ComposeMode = defineTaggedUnion({
	Plain: {},
	Replying: { messageId: MessageId },
	/** `hadText`: the message had text when the edit began (an attachment-only one has none). */
	Editing: { messageId: MessageId, hadText: Schema.Boolean },
})
export type ComposeMode = typeof ComposeMode.Type

/** The file being uploaded: what the upload Subscription depends on. */
export const CurrentUpload = Schema.Struct({ fileId: Schema.String, file: File.File })
export type CurrentUpload = typeof CurrentUpload.Type

export const ActiveUpload = Schema.Struct({ fileId: Schema.String, file: File.File, progress: Schema.Number })
export type ActiveUpload = typeof ActiveUpload.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	composer: Composer.Model,
	composeMode: ComposeMode,
	attachmentIds: Schema.Array(AttachmentId),
	/** Files waiting their turn; legacy uploads them one after another. */
	pendingFiles: Schema.Array(File.File),
	currentUpload: Schema.NullOr(ActiveUpload),
	typing: Typing.Model,
	drag: DragState,
	/** The Emoji button's `EmojiPickerDialog`. */
	emojiPicker: EmojiDialog.Model,
	/** The GIF button's `GifPickerDialog`. */
	gifPicker: GifPicker.Model,
})
export type Model = typeof Model.Type

export const init = (channelId: ChannelId, editorId: string, placeholder = "Type a message..."): Model => ({
	channelId,
	composer: Composer.init(editorId, placeholder),
	composeMode: ComposeMode.Plain(),
	attachmentIds: [],
	pendingFiles: [],
	currentUpload: null,
	typing: Typing.init(),
	drag: DragState.Idle(),
	emojiPicker: EmojiDialog.init(`${editorId}-emoji-picker`),
	gifPicker: GifPicker.init(`${editorId}-gif-picker`),
})

export const replyToMessageIdOf = (model: Model): MessageId | null =>
	model.composeMode._tag === "Replying" ? model.composeMode.messageId : null

export const editingMessageIdOf = (model: Model): MessageId | null =>
	model.composeMode._tag === "Editing" ? model.composeMode.messageId : null

/** `useChatDraft().isUploading`. */
export const isUploading = (model: Model) => model.currentUpload !== null || model.pendingFiles.length > 0

/** The upload Subscription's dependency: the file and its id, not its progress. */
export const currentUploadOf = (model: Model): CurrentUpload | null =>
	model.currentUpload === null
		? null
		: { fileId: model.currentUpload.fileId, file: model.currentUpload.file }

/** `ComposerFrame`'s `hasTopContent`: indicators or previews sit on the frame's top edge. */
export const hasTopContent = (model: Model) =>
	model.composeMode._tag !== "Plain" || model.attachmentIds.length > 0 || model.currentUpload !== null

export const fileInputId = (model: Model) => `${model.composer.editorId}-file-input`

// MESSAGE

/** Why a send failed, beyond the shared reasons. `SyncDelayed`: it was delivered, the sync lags. */
export const SendFailure = Schema.Union([Schema.Literals(["ChannelNotFound", "SyncDelayed"]), CommonReason])
export type SendFailure = typeof SendFailure.Type

export const EditFailure = Schema.Union([Schema.Literal("MessageNotFound"), CommonReason])
export type EditFailure = typeof EditFailure.Type

export const BotCommandFailure = Schema.Union([
	Schema.Literals(["BotNotFound", "BotNotInstalled", "CommandNotFound", "ExecutionFailed"]),
	CommonReason,
])
export type BotCommandFailure = typeof BotCommandFailure.Type

export const Message = defineMessageUnion({
	GotComposerMessage: { message: Composer.Message },
	GotTypingMessage: { message: Typing.Message },
	ClickedCancelReply: {},
	ClickedCancelEdit: {},
	ClickedAttach: {},
	SelectedFiles: { files: Schema.Array(File.File) },
	ClickedRemoveAttachment: { attachmentId: AttachmentId },
	CompletedGenerateUploadFileId: { fileId: Schema.String },
	ReceivedUploadEvent: { event: UploadEvent },
	ReceivedDropEvent: { event: DropEvent },
	CompletedOpenFilePicker: {},
	SucceededSendMessage: {},
	FailedSendMessage: {
		/** The channel the send was for: the draft may show another channel by the time it fails. */
		channelId: ChannelId,
		content: Schema.String,
		restoreContent: Schema.Boolean,
		replyToMessageId: Schema.NullOr(MessageId),
		attachmentIds: Schema.Array(AttachmentId),
		reason: SendFailure,
	},
	SucceededEditMessage: {},
	FailedEditMessage: { reason: EditFailure },
	LeftWindow: {},
	SelectedEmoji: { emoji: Schema.String, label: Schema.String, imageUrl: Schema.NullOr(Schema.String) },
	SelectedGif: { url: Schema.String },
	GotEmojiPickerMessage: { message: EmojiDialog.Message },
	GotGifPickerMessage: { message: GifPicker.Message },
	SucceededExecuteBotCommand: { commandName: Schema.String },
	FailedExecuteBotCommand: {
		commandName: Schema.String,
		botName: Schema.String,
		reason: BotCommandFailure,
	},
})
export type Message = typeof Message.Type

/** Facts the page turns into root OutMessages or scroll behavior. */
export const OutMessage = defineMessageUnion({
	RequestedToast: { toast: ToastRequest },
	SentMessage: {},
	/** Enter on an edit emptied of its text: delete the message instead, once confirmed (Discord). */
	RequestedDeleteMessage: { messageId: MessageId },
	/** Escape with no edit or reply to cancel: Discord marks the channel read. */
	RequestedMarkRead: {},
})
export type OutMessage = typeof OutMessage.Type

/** What the draft needs from its page when a Message arrives. */
export interface Context {
	readonly currentUserId: UserId | null
	readonly organizationId: OrganizationId | null
	readonly memberId: ChannelMemberId | null
	/** `ComposerEditor`'s last own message in the channel, for Arrow Up. */
	readonly lastOwnMessage: { readonly id: MessageId; readonly content: string } | null
}

// COMMAND

/**
 * `ChatProvider.sendMessage`: `sendMessageAction` with the saved reply and attachments. All args
 * but `restoreContent` are the action's variables; a GIF send passes no `restoreContent` in legacy.
 */
export const SendMessage = Command.define("SendMessage", {
	args: {
		channelId: ChannelId,
		authorId: UserId,
		content: Schema.String,
		replyToMessageId: Schema.NullOr(MessageId),
		threadChannelId: Schema.Null,
		attachmentIds: Schema.Array(AttachmentId),
		restoreContent: Schema.Boolean,
	},
	messages: [Message.SucceededSendMessage, Message.FailedSendMessage],
	execute: ({ restoreContent, ...variables }) => {
		const failed = (reason: SendFailure) =>
			Message.FailedSendMessage({
				channelId: variables.channelId,
				content: variables.content,
				restoreContent,
				replyToMessageId: variables.replyToMessageId,
				attachmentIds: variables.attachmentIds,
				reason,
			})
		return sendMessageAction({ ...variables, attachmentIds: [...variables.attachmentIds] }).pipe(
			Effect.as(Message.SucceededSendMessage()),
			Effect.catchTags({
				ChannelNotFoundError: () => Effect.succeed(failed("ChannelNotFound")),
				SyncError: () => Effect.succeed(failed("SyncDelayed")),
			}),
			catchCommon(failed),
		)
	},
})

/** `ChatProvider.editMessage`. */
export const EditMessage = Command.define("EditMessage", {
	args: { messageId: MessageId, content: Schema.String },
	messages: [Message.SucceededEditMessage, Message.FailedEditMessage],
	execute: (args) =>
		editMessageAction(args).pipe(
			Effect.as(Message.SucceededEditMessage()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(Message.FailedEditMessage({ reason: "MessageNotFound" })),
			}),
			catchCommon((reason) => Message.FailedEditMessage({ reason })),
		),
})

/**
 * The GIF picker's choice, back as `SelectedGif`: the one path a GIF is sent by, so whoever owns
 * the draft sees it (a thread still being created holds it until it exists).
 */
export const SelectGif = Command.define("SelectGif", {
	args: { url: Schema.String },
	messages: [Message.SelectedGif],
	execute: ({ url }) => Effect.succeed(Message.SelectedGif({ url })),
})

/** `handleFilesUpload` names each upload with a fresh id. */
export const GenerateUploadFileId = Command.define("GenerateUploadFileId", {
	messages: [Message.CompletedGenerateUploadFileId],
	execute: Effect.sync(() => Message.CompletedGenerateUploadFileId({ fileId: crypto.randomUUID() })),
})

/** The Attach button clicks the hidden file input. */
export const OpenFilePicker = Command.define("OpenFilePicker", {
	args: { inputId: Schema.String },
	messages: [Message.CompletedOpenFilePicker],
	execute: ({ inputId }) =>
		Dom.clickElement(`#${CSS.escape(inputId)}`).pipe(
			// Best-effort: the input renders with the composer, so it is only missing mid-unmount.
			Effect.ignore,
			Effect.as(Message.CompletedOpenFilePicker()),
		),
})

/** The slash command panel's Execute (`bot-commands.executeBotCommand`). */
export const ExecuteBotCommand = Command.define("ExecuteBotCommand", {
	args: {
		orgId: OrganizationId,
		botId: BotId,
		commandName: Schema.String,
		botName: Schema.String,
		channelId: ChannelId,
		arguments: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
	},
	messages: [Message.SucceededExecuteBotCommand, Message.FailedExecuteBotCommand],
	execute: ({ orgId, botId, commandName, botName, channelId, arguments: args }) => {
		const failed = (reason: BotCommandFailure) =>
			Message.FailedExecuteBotCommand({ commandName, botName, reason })
		return HazelApiClient.use((client) =>
			client["bot-commands"].executeBotCommand({
				params: { orgId, botId, commandName },
				payload: { channelId, arguments: [...args] },
			}),
		).pipe(
			Effect.as(Message.SucceededExecuteBotCommand({ commandName })),
			Effect.catchTags({
				BotNotFoundError: () => Effect.succeed(failed("BotNotFound")),
				BotNotInstalledError: () => Effect.succeed(failed("BotNotInstalled")),
				BotCommandNotFoundError: () => Effect.succeed(failed("CommandNotFound")),
				BotCommandExecutionError: () => Effect.succeed(failed("ExecutionFailed")),
			}),
			catchCommon(failed),
		)
	},
})
