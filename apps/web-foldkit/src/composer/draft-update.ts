import type { MessageId } from "@hazel/schema"
import { Match, Option } from "effect"
import { Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { uploadErrorMessages } from "~/lib/upload-to-storage"
import { errorToast, errorToastOf, successToast, warningToast } from "../data/actions"
import type { EditorRegistry } from "../editor/registry"
import { isAcceptedFile } from "../editor/file-types"
import type { ToastRequest } from "../overlay/toasts"
import type { HazelApiClient, HazelRpc } from "../rpc"
import * as Composer from "./composer"
import * as EditorCommands from "./editor-commands"
import {
	type BotCommandFailure,
	ComposeMode,
	type Context,
	EditMessage,
	editingMessageIdOf,
	ExecuteBotCommand,
	fileInputId,
	GenerateUploadFileId,
	isUploading,
	Message,
	type Model,
	OpenFilePicker,
	OutMessage,
	replyToMessageIdOf,
	type SendFailure,
	SendMessage,
} from "./draft"
import * as EmojiDialog from "../emoji-picker/dialog"
import * as GifPicker from "../gif-picker/picker"
import * as ComposerUpdate from "./update"
import * as Typing from "./typing"
import { DropEvent } from "./drop"
import { MAX_FILE_SIZE, type UploadFailure, UploadEvent } from "./upload"

/** The draft's update: `ComposerEditor`'s submit, edit and escape handling plus the upload queue. */

type Requirements = HazelRpc | HazelApiClient | EditorRegistry
export type Return = Update.ReturnWithOutMessage<Model, Message, OutMessage, Requirements>
type Step = Update.Step<Model, Message, Requirements>
/** A result that raises nothing to the page. */
type PlainReturn = Update.Return<Model, Message, Requirements>

// CHILDREN

/** Runs a composer step (its update, `setDraft`, `cancelCommand` …) inside the draft. */
const foldComposer = Update.foldChild({
	update: (composer: Composer.Model, step: (composer: Composer.Model) => ComposerUpdate.Return) =>
		step(composer),
	read: (model: Model) => Option.some(model.composer),
	write: (model: Model, composer: Composer.Model) => modifyFields(model, { composer: () => composer }),
	toParentMessage: (message: Composer.Message) => Message.GotComposerMessage({ message }),
})

const foldTyping = Update.foldChild({
	update: (typing: Typing.Model, step: (typing: Typing.Model) => Typing.Return) => step(typing),
	read: (model: Model) => Option.some(model.typing),
	write: (model: Model, typing: Typing.Model) => modifyFields(model, { typing: () => typing }),
	toParentMessage: (message: Typing.Message) => Message.GotTypingMessage({ message }),
})

const setDraft = (markdown: string): Step =>
	foldComposer((composer) => ComposerUpdate.setDraft(composer, markdown))
const clearDraft: Step = foldComposer(ComposerUpdate.clearDraft)
const stopTyping: Step = foldTyping(Typing.stop)

const setMode =
	(composeMode: ComposeMode): Step =>
	(model) => ({ model: modifyFields(model, { composeMode: () => composeMode }) })

const toast = (model: Model, request: ToastRequest): Return => ({
	model,
	outMessage: OutMessage.RequestedToast({ toast: request }),
})

// COMPOSE MODE

/** `setReplyToMessageId`: entering reply leaves edit mode; clearing it leaves an edit alone. */
export const setReply = (model: Model, replyToMessageId: MessageId | null): Model =>
	modifyFields(model, {
		composeMode: (mode) =>
			replyToMessageId !== null
				? ComposeMode.Replying({ messageId: replyToMessageId })
				: mode._tag === "Replying"
					? ComposeMode.Plain()
					: mode,
	})

/** `setEditingMessageId` plus `onEditingMessageIdChange`: load the message into the editor. */
export const startEditing = (model: Model, messageId: MessageId, content: string): Return =>
	Update.combine(model, [setMode(ComposeMode.Editing({ messageId })), setDraft(content)])

const leaveEditing: Step = Update.combine([setMode(ComposeMode.Plain()), clearDraft])

/** `handleSubmit` of the editor and of `ComposerEditor`. */
const submit = (model: Model, markdown: string, context: Context): Return => {
	if (isUploading(model)) return { model }
	const content = markdown.trim()
	const editingId = editingMessageIdOf(model)
	if (editingId !== null) {
		if (!content) return { model }
		return Update.combine(model, [
			leaveEditing,
			(next) => ({ model: next, commands: [EditMessage({ messageId: editingId, content })] }),
		])
	}
	if (!content && model.attachmentIds.length === 0) return { model }
	if (context.currentUserId === null) return { model }
	const send = SendMessage({
		channelId: model.channelId,
		authorId: context.currentUserId,
		content,
		replyToMessageId: replyToMessageIdOf(model),
		threadChannelId: null,
		attachmentIds: model.attachmentIds,
		restoreContent: true,
	})
	return Update.combine(model, [
		(next) => ({
			model: modifyFields(next, { composeMode: () => ComposeMode.Plain(), attachmentIds: () => [] }),
		}),
		stopTyping,
		clearDraft,
		(next) => ({ model: next, commands: [send] }),
	])
}

// BOT COMMANDS

const botCommandMessage = (reason: BotCommandFailure, commandName: string, botName: string) =>
	failureMessage(reason, {
		BotNotFound: { title: `Bot "${botName}" was not found` },
		BotNotInstalled: { title: `Bot "${botName}" is not installed` },
		CommandNotFound: { title: `Command /${commandName} not found` },
		ExecutionFailed: {
			title: `/${commandName} failed`,
			description: "The bot reported an error running the command.",
		},
	})

/** `handleCommandExecute`: validate the arguments, then run the bot command (once at a time). */
const executeCommand = (model: Model, context: Context): Return => {
	const input = model.composer.commandInput
	if (input === null || input.submission === "Executing") return { model }
	if (context.organizationId === null)
		return toast(model, errorToast("Cannot execute command without an organization"))
	const missing = input.command.arguments
		.filter((arg) => arg.required && !input.values[arg.name])
		.map((arg) => arg.name)
	if (missing.length > 0) return toast(model, errorToast(`Missing required: ${missing.join(", ")}`))
	return {
		model: modifyFields(model, {
			composer: (composer) => ComposerUpdate.setCommandSubmission(composer, "Executing"),
		}),
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

// UPLOADS

const uploadMessage = (reason: UploadFailure) =>
	failureMessage(reason, {
		FileTooLarge: {
			title: "File too large",
			description: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
		},
		Rejected: { title: "Upload failed", description: "Failed to get upload URL. Please try again." },
		StorageNetwork: { title: "Upload failed", description: uploadErrorMessages.network },
		StorageTimeout: { title: "Upload failed", description: uploadErrorMessages.timeout },
		StorageServer: { title: "Upload failed", description: uploadErrorMessages.server },
		NotCompleted: { title: "Upload failed", description: "Failed to finalize upload. Please try again." },
	})

/** The next queued file starts once it has an id. */
const startNextUpload = (model: Model): PlainReturn =>
	model.currentUpload !== null || model.pendingFiles.length === 0
		? { model }
		: { model, commands: [GenerateUploadFileId()] }

/** The current upload ended: the next one starts. */
const finishUpload = (model: Model, attachmentIds: Model["attachmentIds"]): PlainReturn =>
	startNextUpload(modifyFields(model, { currentUpload: () => null, attachmentIds: () => attachmentIds }))

const handleUploadEvent = (model: Model, event: UploadEvent): Return => {
	// A late event of an upload that is no longer current changes nothing.
	if (model.currentUpload?.fileId !== event.fileId) return { model }
	return UploadEvent.match<Return>(event, {
		ProgressedUpload: ({ progress }) => ({
			model: modifyFields(model, {
				currentUpload: (upload) =>
					upload === null ? null : modifyFields(upload, { progress: () => progress }),
			}),
		}),
		SucceededUpload: ({ attachmentId }) => finishUpload(model, [...model.attachmentIds, attachmentId]),
		FailedUpload: ({ reason }) =>
			Update.withOutMessage(
				finishUpload(model, model.attachmentIds),
				OutMessage.RequestedToast({ toast: errorToastOf(uploadMessage(reason)) }),
			),
	})
}

const selectFiles = (model: Model, files: ReadonlyArray<File>, context: Context): Return => {
	if (files.length === 0) return { model }
	if (context.currentUserId === null)
		return toast(model, errorToast("Authentication required", "You must be logged in to upload files"))
	const accepted = files.filter(isAcceptedFile)
	if (accepted.length === 0) return toast(model, errorToast("Unsupported file type"))
	return startNextUpload(modifyFields(model, { pendingFiles: (pending) => [...pending, ...accepted] }))
}

// SEND

const sendFailureMessage = (failure: SendFailure) =>
	failureMessage(failure, {
		ChannelNotFound: { title: "Channel not found", description: "This channel may have been deleted." },
		SyncDelayed: {
			title: "Message sent",
			description: "Sync is delayed but your message was delivered.",
		},
	})

const warningToastOf = (message: UserErrorMessage): ToastRequest =>
	warningToast(message.title, message.description ?? null)

// PICKERS

/** `ComposerActions.handleEmojiSelect`: custom emoji inline, unicode as text. */
const insertEmoji =
	(emoji: string, label: string, imageUrl: string | null): Step =>
	(model) =>
		foldComposer(model, (composer) => ({
			model: composer,
			commands: [
				imageUrl === null
					? EditorCommands.InsertEditorText({ editorId: composer.editorId, text: emoji })
					: EditorCommands.InsertCustomEmoji({
							editorId: composer.editorId,
							name: label,
							imageUrl,
						}),
			],
		}))

/** `handleGifSelect` sends the GIF URL as a message of its own; it answers a reply, an edit stays. */
const sendGif =
	(url: string, context: Context): Step =>
	(model) =>
		context.currentUserId === null
			? { model }
			: {
					model: modifyFields(setReply(model, null), { attachmentIds: () => [] }),
					commands: [
						SendMessage({
							channelId: model.channelId,
							authorId: context.currentUserId,
							content: url,
							replyToMessageId: replyToMessageIdOf(model),
							threadChannelId: null,
							attachmentIds: model.attachmentIds,
							restoreContent: false,
						}),
					],
				}

const foldEmojiPicker = Update.foldChild({
	update: EmojiDialog.update,
	read: (model: Model) => Option.some(model.emojiPicker),
	write: (model: Model, emojiPicker: EmojiDialog.Model) =>
		modifyFields(model, { emojiPicker: () => emojiPicker }),
	toParentMessage: (message: EmojiDialog.Message) => Message.GotEmojiPickerMessage({ message }),
	foldOutMessage: (selected: EmojiDialog.OutMessage) =>
		insertEmoji(selected.emoji, selected.label, selected.imageUrl),
})

const foldGifPicker = (context: Context) =>
	Update.foldChild({
		update: GifPicker.update,
		read: (model: Model) => Option.some(model.gifPicker),
		write: (model: Model, gifPicker: GifPicker.Model) =>
			modifyFields(model, { gifPicker: () => gifPicker }),
		toParentMessage: (message: GifPicker.Message) => Message.GotGifPickerMessage({ message }),
		foldOutMessage: (selected: GifPicker.OutMessage) => sendGif(selected.url, context),
	})

// UPDATE

const handleComposer = (model: Model, message: Composer.Message, context: Context): Return => {
	const delegated = foldComposer(model, (composer) => ComposerUpdate.update(composer, message))
	const then = (step: (model: Model) => Return): Return => {
		const next = step(delegated.model)
		return { ...next, commands: [...(delegated.commands ?? []), ...(next.commands ?? [])] }
	}
	return Match.value(message).pipe(
		Match.withReturnType<Return>(),
		Match.tags({
			UpdatedDraft: ({ markdown }) =>
				then((next) =>
					foldTyping(next, (typing) =>
						Typing.contentChanged(typing, markdown, {
							channelId: model.channelId,
							memberId: context.memberId,
						}),
					),
				),
			SubmittedDraft: ({ markdown }) => then((next) => submit(next, markdown, context)),
			// Escape leaves edit mode, or cancels the reply (Discord, Slack); the draft text stays when replying.
			PressedEscape: () =>
				then((next) =>
					editingMessageIdOf(next) !== null
						? leaveEditing(next)
						: replyToMessageIdOf(next) !== null
							? { model: setReply(next, null) }
							: { model: next },
				),
			PressedArrowUpInEmpty: () =>
				then((next) =>
					context.lastOwnMessage === null
						? { model: next }
						: startEditing(next, context.lastOwnMessage.id, context.lastOwnMessage.content),
				),
			PastedFiles: ({ files }) => then((next) => selectFiles(next, files, context)),
			ClickedExecuteCommand: () => then((next) => executeCommand(next, context)),
			PressedCommandFieldKey: ({ key }) =>
				key === "Enter" ? then((next) => executeCommand(next, context)) : delegated,
		}),
		Match.orElse(() => delegated),
	)
}

export const update = (model: Model, message: Message, context: Context): Return =>
	Message.match<Return>(message, {
		GotComposerMessage: ({ message: composerMessage }) => handleComposer(model, composerMessage, context),
		GotTypingMessage: ({ message: typingMessage }) =>
			foldTyping(model, (typing) => Typing.update(typing, typingMessage)),
		ClickedCancelReply: () => ({ model: setReply(model, null) }),
		// `ComposerEditIndicator.handleCancel`: leave edit mode and clear the editor.
		ClickedCancelEdit: () => leaveEditing(model),
		ClickedAttach: () =>
			isUploading(model)
				? { model }
				: { model, commands: [OpenFilePicker({ inputId: fileInputId(model) })] },
		SelectedFiles: ({ files }) => selectFiles(model, files, context),
		CompletedGenerateUploadFileId: ({ fileId }) => {
			const [file, ...rest] = model.pendingFiles
			if (file === undefined || model.currentUpload !== null) return { model }
			return {
				model: modifyFields(model, {
					pendingFiles: () => rest,
					currentUpload: () => ({ fileId, file, progress: 0 }),
				}),
			}
		},
		ReceivedUploadEvent: ({ event }) => handleUploadEvent(model, event),
		ReceivedDropEvent: ({ event }) =>
			DropEvent.match<Return>(event, {
				ChangedDragState: ({ drag }) => ({ model: modifyFields(model, { drag: () => drag }) }),
				// Legacy disables the drop zone while a file uploads.
				DroppedFiles: ({ files }) =>
					isUploading(model) ? { model } : selectFiles(model, files, context),
			}),
		ClickedRemoveAttachment: ({ attachmentId }) => ({
			model: modifyFields(model, { attachmentIds: (ids) => ids.filter((id) => id !== attachmentId) }),
		}),
		CompletedOpenFilePicker: () => ({ model }),
		SucceededSendMessage: () => ({ model, outMessage: OutMessage.SentMessage() }),
		// Restore what the optimistic send cleared, then toast. A delayed sync was delivered: nothing to restore.
		FailedSendMessage: ({ content, restoreContent, replyToMessageId, attachmentIds, reason }) =>
			reason === "SyncDelayed"
				? toast(model, warningToastOf(sendFailureMessage(reason)))
				: Update.withOutMessage(
						Update.combine(
							modifyFields(setReply(model, replyToMessageId), {
								attachmentIds: () => attachmentIds,
							}),
							restoreContent ? [setDraft(content)] : [],
						),
						OutMessage.RequestedToast({ toast: errorToastOf(sendFailureMessage(reason)) }),
					),
		SucceededEditMessage: () => ({ model }),
		FailedEditMessage: ({ reason }) =>
			toast(
				model,
				errorToastOf(
					failureMessage(reason, {
						MessageNotFound: {
							title: "Message not found",
							description: "This message may have been deleted.",
						},
					}),
				),
			),
		LeftWindow: () => stopTyping(model),
		// Success leaves command input mode and focuses the editor; failure keeps the panel.
		SucceededExecuteBotCommand: ({ commandName }) =>
			Update.withOutMessage(
				foldComposer(model, ComposerUpdate.cancelCommand),
				OutMessage.RequestedToast({ toast: successToast(`Executed /${commandName}`) }),
			),
		FailedExecuteBotCommand: ({ commandName, botName, reason }) =>
			toast(
				modifyFields(model, {
					composer: (composer) => ComposerUpdate.setCommandSubmission(composer, "Idle"),
				}),
				errorToastOf(botCommandMessage(reason, commandName, botName)),
			),
		SelectedEmoji: ({ emoji, label, imageUrl }) => insertEmoji(emoji, label, imageUrl)(model),
		GotEmojiPickerMessage: ({ message: dialogMessage }) => foldEmojiPicker(model, dialogMessage),
		GotGifPickerMessage: ({ message: gifMessage }) => foldGifPicker(context)(model, gifMessage),
		SelectedGif: ({ url }) => sendGif(url, context)(model),
	})
