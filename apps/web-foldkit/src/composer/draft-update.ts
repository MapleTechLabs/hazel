import type { MessageId } from "@hazel/schema"
import { Match } from "effect"
import { Command, type Update } from "foldkit"
import type { HazelRpc } from "../rpc"
import * as Composer from "./composer"
import * as EditorCommands from "./editor-commands"
import {
	type Context,
	EditMessage,
	GenerateUploadFileId,
	isUploading,
	Message,
	type Model,
	OpenFilePicker,
	OutMessage,
	SendMessage,
	ExecuteBotCommand,
	fileInputId,
	TrackEmojiUsage,
} from "./draft"
import * as EmojiDialog from "../emoji-picker/dialog"
import * as ComposerUpdate from "./update"
import * as Typing from "./typing"
import { DropEvent } from "./drop"
import { UploadEvent } from "./upload"

/** The draft's update: `ComposerEditor`'s submit, edit and escape handling plus the upload queue. */

export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, HazelRpc>

const editorIdOf = (model: Model) => model.composer.editorId

const toComposerCommands = (commands: ReadonlyArray<Command.Command<Composer.Message>>) =>
	Command.mapMessages(commands, (message) => Message.GotComposerMessage({ message }))

const liftComposer = (model: Model, result: Update.Return<Composer.Model, Composer.Message>): Return => ({
	model: { ...model, composer: result.model },
	commands: Command.mapMessages(result.commands ?? [], (message) => Message.GotComposerMessage({ message })),
})

const liftTyping = (model: Model, result: Typing.Return): Return => ({
	model: { ...model, typing: result.model },
	commands: Command.mapMessages(result.commands ?? [], (message) => Message.GotTypingMessage({ message })),
})

const withCommands = (result: Return, commands: ReadonlyArray<Command.Command<Message, never, HazelRpc>>): Return => ({
	...result,
	commands: [...(result.commands ?? []), ...commands],
})

const toast = (model: Model, request: Parameters<typeof OutMessage.RequestedToast>[0]["toast"]): Return => ({
	model,
	outMessage: OutMessage.RequestedToast({ toast: request }),
})

/** `setReplyToMessageId`: entering reply clears edit. */
export const setReply = (model: Model, replyToMessageId: MessageId | null): Model => ({
	...model,
	replyToMessageId,
	editingMessageId: replyToMessageId === null ? model.editingMessageId : null,
})

/** `setEditingMessageId` plus `onEditingMessageIdChange`: load the message into the editor. */
export const startEditing = (model: Model, messageId: MessageId, content: string): Return => ({
	model: { ...model, editingMessageId: messageId, replyToMessageId: null },
	commands: toComposerCommands([EditorCommands.SetEditorContent({ editorId: editorIdOf(model), markdown: content })]),
})

const clearEditor = (model: Model) => toComposerCommands([EditorCommands.ClearEditor({ editorId: editorIdOf(model) })])

/** `handleSubmit` of the editor and of `ComposerEditor`. */
const submit = (model: Model, markdown: string, context: Context): Return => {
	if (isUploading(model)) return { model }
	const content = markdown.trim()
	if (model.editingMessageId !== null) {
		if (!content) return { model }
		return {
			model: { ...model, editingMessageId: null },
			commands: [...clearEditor(model), EditMessage({ messageId: model.editingMessageId, content })],
		}
	}
	if (!content && model.attachmentIds.length === 0) return { model }
	if (context.currentUserId === null) return { model }
	const send = SendMessage({
		channelId: model.channelId,
		authorId: context.currentUserId,
		content,
		replyToMessageId: model.replyToMessageId,
		threadChannelId: null,
		attachmentIds: model.attachmentIds,
		restoreContent: true,
	})
	const cleared: Model = { ...model, replyToMessageId: null, attachmentIds: [] }
	return withCommands(liftTyping(cleared, Typing.stop(cleared.typing)), [...clearEditor(model), send])
}

/** `handleCommandExecute`: validate the arguments, then run the bot command. */
const executeCommand = (model: Model, context: Context): Return => {
	const input = model.composer.commandInput
	if (input === null) return { model }
	const error = (title: string) => toast(model, { intent: "error", title, description: null })
	if (context.organizationId === null) return error("Cannot execute command without an organization")
	const missing = input.command.arguments
		.filter((arg) => arg.required && !input.values[arg.name])
		.map((arg) => arg.name)
	if (missing.length > 0) return error(`Missing required: ${missing.join(", ")}`)
	return {
		model,
		commands: [
			ExecuteBotCommand({
				orgId: context.organizationId,
				botId: input.command.bot.id,
				commandName: input.command.name,
				botName: input.command.bot.name,
				channelId: model.channelId,
				arguments: Object.entries(input.values)
					.filter(([, value]) => value.trim() !== "")
					.map(([name, value]) => ({ name, value })),
			}),
		],
	}
}

/** The next queued file starts once it has an id. */
const startNextUpload = (model: Model): Return =>
	model.currentUpload !== null || model.pendingFiles.length === 0
		? { model }
		: { model, commands: [GenerateUploadFileId()] }

const handleUploadEvent = (model: Model, event: UploadEvent): Return =>
	UploadEvent.match<Return>(event, {
		ProgressedUpload: ({ fileId, progress }) => ({
			model: {
				...model,
				uploadingFiles: model.uploadingFiles.map((file) => (file.fileId === fileId ? { ...file, progress } : file)),
			},
		}),
		FinishedUpload: ({ fileId, attachmentId, toast: request }) => {
			if (model.currentUpload?.fileId !== fileId) return { model }
			const next = startNextUpload({
				...model,
				currentUpload: null,
				uploadingFiles: model.uploadingFiles.filter((file) => file.fileId !== fileId),
				attachmentIds: attachmentId === null ? model.attachmentIds : [...model.attachmentIds, attachmentId],
			})
			return request === null ? next : { ...next, outMessage: OutMessage.RequestedToast({ toast: request }) }
		},
	})

const handleComposer = (model: Model, message: Composer.Message, context: Context): Return => {
	const delegated = liftComposer(model, ComposerUpdate.update(model.composer, message))
	return Match.value(message).pipe(
		Match.tags({
			UpdatedDraft: ({ markdown }) =>
				withCommands(
					liftTyping(
						delegated.model,
						Typing.contentChanged(delegated.model.typing, markdown, {
							channelId: model.channelId,
							memberId: context.memberId,
						}),
					),
					delegated.commands ?? [],
				),
			SubmittedDraft: ({ markdown }) => submit(model, markdown, context),
			PressedEscape: () =>
				model.editingMessageId === null
					? { model }
					: { model: { ...model, editingMessageId: null }, commands: clearEditor(model) },
			PressedArrowUpInEmpty: () =>
				context.lastOwnMessage === null
					? { model }
					: startEditing(model, context.lastOwnMessage.id, context.lastOwnMessage.content),
			PastedFiles: ({ files }) => update(model, Message.SelectedFiles({ files }), context),
			ClickedExecuteCommand: () => executeCommand(model, context),
			PressedCommandFieldKey: ({ key }) => (key === "Enter" ? executeCommand(model, context) : delegated),
		}),
		Match.orElse(() => delegated),
	)
}

export const update = (model: Model, message: Message, context: Context): Return =>
	Message.match<Return>(message, {
		GotComposerMessage: ({ message: composerMessage }) => handleComposer(model, composerMessage, context),
		GotTypingMessage: ({ message: typingMessage }) => liftTyping(model, Typing.update(model.typing, typingMessage)),
		ClickedCancelReply: () => ({ model: setReply(model, null) }),
		// `ComposerEditIndicator.handleCancel`: leave edit mode and clear the editor.
		ClickedCancelEdit: () => ({ model: { ...model, editingMessageId: null }, commands: clearEditor(model) }),
		ClickedAttach: () =>
			isUploading(model) ? { model } : { model, commands: [OpenFilePicker({ inputId: fileInputId(model) })] },
		SelectedFiles: ({ files }) => {
			if (files.length === 0) return { model }
			if (context.currentUserId === null)
				return toast(model, {
					intent: "error",
					title: "Authentication required",
					description: "You must be logged in to upload files",
				})
			return startNextUpload({ ...model, pendingFiles: [...model.pendingFiles, ...files] })
		},
		CompletedGenerateUploadFileId: ({ fileId }) => {
			const [file, ...rest] = model.pendingFiles
			if (file === undefined || model.currentUpload !== null) return { model }
			return {
				model: {
					...model,
					pendingFiles: rest,
					currentUpload: { fileId, file },
					uploadingFiles: [
						...model.uploadingFiles,
						{ fileId, fileName: file.name, fileSize: file.size, progress: 0 },
					],
				},
			}
		},
		GotUploadEvent: ({ event }) => handleUploadEvent(model, event),
		GotDropEvent: ({ event }) =>
			DropEvent.match<Return>(event, {
				ChangedDragState: ({ isDraggingOnPage, isDropTarget }) => ({
					model: { ...model, isDraggingOnPage, isDropTarget },
				}),
				DroppedFiles: ({ files }) => update(model, Message.SelectedFiles({ files }), context),
			}),
		ClickedRemoveAttachment: ({ attachmentId }) => ({
			model: { ...model, attachmentIds: model.attachmentIds.filter((id) => id !== attachmentId) },
		}),
		CompletedOpenFilePicker: () => ({ model }),
		SucceededSendMessage: () => ({ model, outMessage: OutMessage.SentMessage() }),
		// Restore what the optimistic send cleared, then toast.
		FailedSendMessage: ({ content, restoreContent, replyToMessageId, attachmentIds, toast: request }) => ({
			model: { ...setReply(model, replyToMessageId), attachmentIds },
			commands: restoreContent
				? toComposerCommands([EditorCommands.SetEditorContent({ editorId: editorIdOf(model), markdown: content })])
				: [],
			outMessage: OutMessage.RequestedToast({ toast: request }),
		}),
		CompletedEditMessage: ({ toast: request }) => (request === null ? { model } : toast(model, request)),
		LeftWindow: () => liftTyping(model, Typing.stop(model.typing)),
		// Success leaves command input mode and focuses the editor; failure keeps the panel.
		CompletedExecuteBotCommand: ({ succeeded, toast: request }) => {
			const result = succeeded ? liftComposer(model, ComposerUpdate.cancelCommand(model.composer)) : { model }
			return { ...result, outMessage: OutMessage.RequestedToast({ toast: request }) }
		},
		// `ComposerActions.handleEmojiSelect`: custom emoji inline, unicode as text.
		SelectedEmoji: ({ emoji, label, imageUrl }) => ({
			model,
			commands: toComposerCommands([
				imageUrl === null
					? EditorCommands.InsertEditorText({ editorId: editorIdOf(model), text: emoji })
					: EditorCommands.InsertCustomEmoji({ editorId: editorIdOf(model), name: label, imageUrl }),
			]),
		}),
		GotEmojiPickerMessage: ({ message: dialogMessage }) => {
			const result = EmojiDialog.update(model.emojiPicker, dialogMessage)
			const next: Return = {
				model: { ...model, emojiPicker: result.model },
				commands: Command.mapMessages(result.commands ?? [], (inner) =>
					Message.GotEmojiPickerMessage({ message: inner }),
				),
			}
			if (result.outMessage === undefined) return next
			const { emoji, label, imageUrl } = result.outMessage
			const inserted = update(next.model, Message.SelectedEmoji({ emoji, label, imageUrl }), context)
			return { ...inserted, commands: [...(next.commands ?? []), TrackEmojiUsage({ emoji }), ...(inserted.commands ?? [])] }
		},
		CompletedTrackEmojiUsage: () => ({ model }),
		// `handleGifSelect` sends the GIF URL as a message of its own.
		SelectedGif: ({ url }) =>
			context.currentUserId === null
				? { model }
				: {
						model: { ...model, replyToMessageId: null, attachmentIds: [] },
						commands: [
							SendMessage({
								channelId: model.channelId,
								authorId: context.currentUserId,
								content: url,
								replyToMessageId: model.replyToMessageId,
								threadChannelId: null,
								attachmentIds: model.attachmentIds,
								restoreContent: false,
							}),
						],
					},
	})
