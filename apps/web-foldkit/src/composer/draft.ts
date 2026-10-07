import {
	AttachmentId,
	BotId,
	ChannelId,
	type ChannelMemberId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Schema } from "effect"
import { Command, File } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { editMessageAction, sendMessageAction } from "~/db/actions"
import { HazelApiClient } from "~/lib/services/common/atom-client"
import { ToastRequest } from "../overlay/toasts"
import {
	errorToastOf,
	failureMessage,
	notRetryable,
	rateLimited,
	runChatAction,
	toastOfExit,
} from "../page/chat/action-effects"
import * as Composer from "./composer"
import * as Typing from "./typing"
import { DropEvent } from "./drop"
import { UploadEvent } from "./upload"

/**
 * One channel's draft: the composer plus the `ChatProvider` draft state (reply, edit,
 * attachments, uploads) and `useTyping`. The channel and the thread panel each hold one.
 * Its update is `draft-update.ts`; this module holds the Model, Messages and Commands.
 */

// MODEL

export const UploadingFile = Schema.Struct({
	fileId: Schema.String,
	fileName: Schema.String,
	fileSize: Schema.Number,
	progress: Schema.Number,
})
export type UploadingFile = typeof UploadingFile.Type

export const CurrentUpload = Schema.Struct({ fileId: Schema.String, file: File.File })

export const Model = Schema.Struct({
	channelId: ChannelId,
	composer: Composer.Model,
	replyToMessageId: Schema.NullOr(MessageId),
	editingMessageId: Schema.NullOr(MessageId),
	attachmentIds: Schema.Array(AttachmentId),
	uploadingFiles: Schema.Array(UploadingFile),
	/** Files waiting their turn; legacy uploads them one after another. */
	pendingFiles: Schema.Array(File.File),
	currentUpload: Schema.NullOr(CurrentUpload),
	typing: Typing.Model,
	isDraggingOnPage: Schema.Boolean,
	isDropTarget: Schema.Boolean,
})
export type Model = typeof Model.Type

export const init = (channelId: ChannelId, editorId: string, placeholder = "Type a message..."): Model => ({
	channelId,
	composer: Composer.init(editorId, placeholder),
	replyToMessageId: null,
	editingMessageId: null,
	attachmentIds: [],
	uploadingFiles: [],
	pendingFiles: [],
	currentUpload: null,
	typing: Typing.init(),
	isDraggingOnPage: false,
	isDropTarget: false,
})

/** `useChatDraft().isUploading`. */
export const isUploading = (model: Model) => model.currentUpload !== null || model.pendingFiles.length > 0

/** `ComposerFrame`'s `hasTopContent`: indicators or previews sit on the frame's top edge. */
export const hasTopContent = (model: Model) =>
	model.replyToMessageId !== null ||
	model.editingMessageId !== null ||
	model.attachmentIds.length > 0 ||
	model.uploadingFiles.length > 0

export const fileInputId = (model: Model) => `${model.composer.editorId}-file-input`

// MESSAGE

export const Message = defineMessageUnion({
	GotComposerMessage: { message: Composer.Message },
	GotTypingMessage: { message: Typing.Message },
	ClickedCancelReply: {},
	ClickedCancelEdit: {},
	ClickedAttach: {},
	SelectedFiles: { files: Schema.Array(File.File) },
	ClickedRemoveAttachment: { attachmentId: AttachmentId },
	CompletedGenerateUploadFileId: { fileId: Schema.String },
	GotUploadEvent: { event: UploadEvent },
	GotDropEvent: { event: DropEvent },
	CompletedOpenFilePicker: {},
	SucceededSendMessage: {},
	FailedSendMessage: {
		content: Schema.String,
		restoreContent: Schema.Boolean,
		replyToMessageId: Schema.NullOr(MessageId),
		attachmentIds: Schema.Array(AttachmentId),
		toast: ToastRequest,
	},
	CompletedEditMessage: { toast: Schema.NullOr(ToastRequest) },
	LeftWindow: {},
	SelectedEmoji: { emoji: Schema.String, label: Schema.String, imageUrl: Schema.NullOr(Schema.String) },
	SelectedGif: { url: Schema.String },
	CompletedExecuteBotCommand: { succeeded: Schema.Boolean, toast: ToastRequest },
})
export type Message = typeof Message.Type

/** Facts the page turns into root OutMessages or scroll behavior. */
export const OutMessage = defineMessageUnion({
	RequestedToast: { toast: ToastRequest },
	SentMessage: {},
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
	execute: ({ restoreContent, ...variables }) =>
		Effect.matchCause(runChatAction(sendMessageAction, { ...variables, attachmentIds: [...variables.attachmentIds] }), {
			onSuccess: () => Message.SucceededSendMessage(),
			onFailure: (cause) =>
				Message.FailedSendMessage({
					content: variables.content,
					restoreContent,
					replyToMessageId: variables.replyToMessageId,
					attachmentIds: variables.attachmentIds,
					toast: errorToastOf(failureMessage(cause, sendHandlers)),
				}),
		}),
})

const sendHandlers = {
	RateLimitExceededError: rateLimited("sending another message"),
	ChannelNotFoundError: notRetryable("Channel not found", "This channel may have been deleted."),
	SyncError: notRetryable("Message sent", "Sync is delayed but your message was delivered."),
}

/** `ChatProvider.editMessage`. */
export const EditMessage = Command.define("EditMessage", {
	args: { messageId: MessageId, content: Schema.String },
	messages: [Message.CompletedEditMessage],
	execute: (args) =>
		toastOfExit(runChatAction(editMessageAction, args), {
			handlers: {
				RateLimitExceededError: rateLimited("trying again"),
				MessageNotFoundError: notRetryable("Message not found", "This message may have been deleted."),
			},
		}).pipe(Effect.map((toast) => Message.CompletedEditMessage({ toast }))),
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
		Effect.sync(() => document.getElementById(inputId)?.click()).pipe(Effect.as(Message.CompletedOpenFilePicker())),
})

const executeBotCommand = HazelApiClient.mutation("bot-commands", "executeBotCommand")

const tagOf = (error: unknown) =>
	typeof error === "object" && error !== null && "_tag" in error ? String(error._tag) : undefined

/** The slash command panel's Execute (`bot-commands.executeBotCommand`). */
export const ExecuteBotCommand = Command.define("ExecuteBotCommand", {
	args: {
		orgId: OrganizationId,
		botId: Schema.String,
		commandName: Schema.String,
		botName: Schema.String,
		channelId: ChannelId,
		arguments: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.String })),
	},
	messages: [Message.CompletedExecuteBotCommand],
	execute: ({ orgId, botId, commandName, botName, channelId, arguments: args }) =>
		Effect.matchCause(
			runChatAction(executeBotCommand, {
				params: { orgId, botId: BotId.make(botId), commandName },
				payload: { channelId, arguments: [...args] },
			}),
			{
				onSuccess: () =>
					Message.CompletedExecuteBotCommand({
						succeeded: true,
						toast: { intent: "success", title: `Executed /${commandName}`, description: null },
					}),
				onFailure: (cause) => {
					const error = cause.reasons.find(Cause.isFailReason)?.error
					const tag = tagOf(error)
					const title =
						error === undefined
							? "Command failed"
							: tag === "BotNotInstalledError"
								? `Bot "${botName}" is not installed`
								: tag === "BotCommandNotFoundError"
									? `Command /${commandName} not found`
									: tag === "BotCommandExecutionError" && typeof error === "object" && error !== null && "message" in error
										? String(error.message)
										: "Command execution failed"
					return Message.CompletedExecuteBotCommand({
						succeeded: false,
						toast: { intent: "error", title, description: null },
					})
				},
			},
		),
})
