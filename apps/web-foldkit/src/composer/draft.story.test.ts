import {
	AttachmentId,
	BotCommandId,
	BotId,
	ChannelId,
	ChannelMemberId,
	MessageId,
	OrganizationId,
	TypingIndicatorId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Composer from "./composer"
import * as Draft from "./draft"
import * as DraftUpdate from "./draft-update"
import { DragState, DropEvent } from "./drop"
import * as EditorCommands from "./editor-commands"
import * as Typing from "./typing"
import { UploadEvent } from "./upload"

/** One draft's update (reply, edit, uploads, slash commands, typing), outside any page. */

// ProseMirror's view reads `document` at import; node has none.
vi.hoisted(() => {
	if (!("document" in globalThis))
		Object.assign(globalThis, {
			document: Object.assign(new EventTarget(), { documentElement: { style: {} } }),
		})
})

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const channelId = Schema.decodeSync(ChannelId)(uuid(1))
const ada = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(4))
const memberId = Schema.decodeSync(ChannelMemberId)(uuid(5))
const replyId = Schema.decodeSync(MessageId)(uuid(1001))
const editId = Schema.decodeSync(MessageId)(uuid(1002))
const firstAttachment = Schema.decodeSync(AttachmentId)(uuid(7001))
const secondAttachment = Schema.decodeSync(AttachmentId)(uuid(7002))
const indicatorId = Schema.decodeSync(TypingIndicatorId)(uuid(9001))
const indicator = { id: indicatorId, channelId }
const editorId = "composer-draft"

const context: Draft.Context = { currentUserId: ada, organizationId, memberId, lastOwnMessage: null }
const signedOut: Draft.Context = { ...context, currentUserId: null }

const update = (current: Draft.Model, next: Draft.Message) => DraftUpdate.update(current, next, context)
const updateSignedOut = (current: Draft.Model, next: Draft.Message) =>
	DraftUpdate.update(current, next, signedOut)

const fresh = () => Draft.init(channelId, editorId)
const replying = (): Draft.Model => ({
	...fresh(),
	composeMode: Draft.ComposeMode.Replying({ messageId: replyId }),
})
const editing = (): Draft.Model => ({
	...fresh(),
	composeMode: Draft.ComposeMode.Editing({ messageId: editId }),
})
const { Message } = Draft
const composer = (inner: Composer.Message) => Message.GotComposerMessage({ message: inner })
const pngA = new File(["a"], "a.png", { type: "image/png" })
const pngB = new File(["bb"], "b.png", { type: "image/png" })
const uploadingA = (): Draft.Model => ({
	...fresh(),
	currentUpload: { fileId: "f1", file: pngA, progress: 30 },
})

describe("reply and edit", () => {
	test("Cancel on the reply indicator drops the reply", () => {
		story(
			update,
			given(replying()),
			message(Message.ClickedCancelReply()),
			Command.expectNone(),
			model((current) => expect(current.composeMode).toEqual(Draft.ComposeMode.Plain())),
		)
	})

	test("replying while editing leaves edit mode (one indicator at a time)", () => {
		const next = DraftUpdate.setReply(editing(), replyId)
		expect(next.composeMode).toEqual(Draft.ComposeMode.Replying({ messageId: replyId }))
	})

	test("Cancel on the edit indicator leaves edit mode and clears the draft", () => {
		story(
			update,
			given({ ...editing(), composer: { ...fresh().composer, markdown: "old text" } }),
			message(Message.ClickedCancelEdit()),
			Command.expectExact(EditorCommands.ClearEditor({ editorId })),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			model((current) => {
				expect(current.composeMode).toEqual(Draft.ComposeMode.Plain())
				expect(current.composer.markdown).toBe("")
			}),
		)
	})

	test("an empty edit is not sent and keeps edit mode", () => {
		story(
			update,
			given(editing()),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "   " }))),
			Command.expectNone(),
			model((current) => expect(Draft.editingMessageIdOf(current)).toBe(editId)),
		)
	})

	test("a failed edit raises its toast", () => {
		story(
			update,
			given(fresh()),
			message(Message.FailedEditMessage({ reason: "MessageNotFound" })),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Message not found",
						description: "This message may have been deleted.",
					},
				}),
			),
		)
	})
})

describe("the draft survives its editor (P0: Files tab round-trip)", () => {
	test("editing loads the message into the Model, so a remounted editor shows it; Enter still edits", () => {
		const content = "Shipped the onboarding copy"
		const withLastOwn = (current: Draft.Model, next: Draft.Message) =>
			DraftUpdate.update(current, next, { ...context, lastOwnMessage: { id: editId, content } })
		story(
			withLastOwn,
			given(fresh()),
			// Arrow Up in an empty editor starts editing the last own message.
			message(composer(Composer.Message.PressedArrowUpInEmpty())),
			Command.expectExact(EditorCommands.SetEditorContent({ editorId, markdown: content })),
			// The Messages tab is left before the editor took the content: the Command reports it.
			Command.resolve(
				EditorCommands.SetEditorContent,
				Composer.Message.FailedSetEditorContent({ reason: "EditorNotMounted" }),
			),
			model((current) => {
				expect(Draft.editingMessageIdOf(current)).toBe(editId)
				// The composer view mounts the editor with this as `initialMarkdown`.
				expect(current.composer.markdown).toBe(content)
			}),
			message(composer(Composer.Message.SubmittedDraft({ markdown: `${content}!` }))),
			Command.expectExact(
				EditorCommands.ClearEditor({ editorId }),
				Draft.EditMessage({ messageId: editId, content: `${content}!` }),
			),
			Command.resolve(EditorCommands.ClearEditor, Composer.Message.CompletedClearEditor()),
			Command.resolve(Draft.EditMessage, Message.SucceededEditMessage()),
			model((current) => {
				expect(current.composeMode).toEqual(Draft.ComposeMode.Plain())
				expect(current.composer.markdown).toBe("")
			}),
		)
	})

	test("typed text is kept in the Model as the editor reports it", () => {
		story(
			// No membership, so no typing indicator to send.
			(current: Draft.Model, next: Draft.Message) =>
				DraftUpdate.update(current, next, { ...context, memberId: null }),
			given(fresh()),
			message(composer(Composer.Message.UpdatedDraft({ markdown: "Hi there", isEmpty: false }))),
			Command.expectNone(),
			model((current) => expect(current.composer.markdown).toBe("Hi there")),
		)
	})

	test("a failed send restores its text into the Model even without a mounted editor", () => {
		story(
			update,
			given(fresh()),
			message(
				Message.FailedSendMessage({
					content: "On it",
					restoreContent: true,
					replyToMessageId: replyId,
					attachmentIds: [firstAttachment],
					reason: "Offline",
				}),
			),
			Command.expectExact(EditorCommands.SetEditorContent({ editorId, markdown: "On it" })),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Connection lost",
						description: "Check your internet connection and try again.",
					},
				}),
			),
			Command.resolve(
				EditorCommands.SetEditorContent,
				Composer.Message.FailedSetEditorContent({ reason: "EditorNotMounted" }),
			),
			model((current) => {
				expect(current.composer.markdown).toBe("On it")
				expect(current.composeMode).toEqual(Draft.ComposeMode.Replying({ messageId: replyId }))
				expect(current.attachmentIds).toEqual([firstAttachment])
			}),
		)
	})

	test("a send whose sync is delayed was delivered: nothing is restored", () => {
		story(
			update,
			given(fresh()),
			message(
				Message.FailedSendMessage({
					content: "On it",
					restoreContent: true,
					replyToMessageId: null,
					attachmentIds: [],
					reason: "SyncDelayed",
				}),
			),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "warning",
						title: "Message sent",
						description: "Sync is delayed but your message was delivered.",
					},
				}),
			),
			model((current) => expect(current.composer.markdown).toBe("")),
		)
	})
})

describe("attachments", () => {
	test("files upload one after another; each finished upload becomes an attachment", () => {
		story(
			update,
			given(fresh()),
			message(Message.SelectedFiles({ files: [pngA, pngB] })),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(
				Draft.GenerateUploadFileId,
				Message.CompletedGenerateUploadFileId({ fileId: "f1" }),
			),
			model((current) => {
				expect(current.currentUpload).toEqual({ fileId: "f1", file: pngA, progress: 0 })
				expect(current.pendingFiles).toHaveLength(1)
				expect(Draft.isUploading(current)).toBe(true)
			}),
			message(
				Message.ReceivedUploadEvent({
					event: UploadEvent.ProgressedUpload({ fileId: "f1", progress: 60 }),
				}),
			),
			model((current) => expect(current.currentUpload?.progress).toBe(60)),
			message(
				Message.ReceivedUploadEvent({
					event: UploadEvent.SucceededUpload({ fileId: "f1", attachmentId: firstAttachment }),
				}),
			),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(
				Draft.GenerateUploadFileId,
				Message.CompletedGenerateUploadFileId({ fileId: "f2" }),
			),
			message(
				Message.ReceivedUploadEvent({
					event: UploadEvent.SucceededUpload({ fileId: "f2", attachmentId: secondAttachment }),
				}),
			),
			Command.expectNone(),
			model((current) => {
				expect(current.attachmentIds).toEqual([firstAttachment, secondAttachment])
				expect(current.currentUpload).toBeNull()
				expect(Draft.isUploading(current)).toBe(false)
			}),
		)
	})

	test("a failed upload toasts its reason's copy and adds no attachment", () => {
		story(
			update,
			given(uploadingA()),
			message(
				Message.ReceivedUploadEvent({
					event: UploadEvent.FailedUpload({ fileId: "f1", reason: "StorageTimeout" }),
				}),
			),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Upload failed",
						description: "Upload timed out. Try a smaller file or check your connection.",
					},
				}),
			),
			model((current) => {
				expect(current.attachmentIds).toEqual([])
				expect(current.currentUpload).toBeNull()
			}),
		)
	})

	test("an event of an upload that is no longer current changes nothing", () => {
		const current = uploadingA()
		story(
			update,
			given(current),
			message(
				Message.ReceivedUploadEvent({
					event: UploadEvent.SucceededUpload({ fileId: "stale", attachmentId: firstAttachment }),
				}),
			),
			Command.expectNone(),
			model((next) => expect(next).toBe(current)),
		)
	})

	test("the upload Subscription depends on the file, not on its progress", () => {
		const current = uploadingA()
		const progressed: Draft.Model = {
			...current,
			currentUpload: { fileId: "f1", file: pngA, progress: 90 },
		}
		expect(Draft.currentUploadOf(progressed)).toEqual(Draft.currentUploadOf(current))
	})

	test("while a file uploads, Enter, the Attach button and drops do nothing", () => {
		story(
			update,
			given(uploadingA()),
			message(composer(Composer.Message.SubmittedDraft({ markdown: "caption" }))),
			Command.expectNone(),
			message(Message.ClickedAttach()),
			Command.expectNone(),
			message(Message.ReceivedDropEvent({ event: DropEvent.DroppedFiles({ files: [pngB] }) })),
			Command.expectNone(),
			model((current) => expect(current.pendingFiles).toEqual([])),
		)
	})

	test("Attach opens the hidden file input", () => {
		story(
			update,
			given(fresh()),
			message(Message.ClickedAttach()),
			Command.expectExact(Draft.OpenFilePicker({ inputId: `${editorId}-file-input` })),
			Command.resolve(Draft.OpenFilePicker, Message.CompletedOpenFilePicker()),
		)
	})

	test("dropped files queue like selected ones; the drag state follows the pointer", () => {
		story(
			update,
			given(fresh()),
			message(
				Message.ReceivedDropEvent({
					event: DropEvent.ChangedDragState({ drag: DragState.OverDropZone() }),
				}),
			),
			model((current) => expect(current.drag).toEqual(DragState.OverDropZone())),
			message(Message.ReceivedDropEvent({ event: DropEvent.DroppedFiles({ files: [pngA] }) })),
			Command.expectExact(Draft.GenerateUploadFileId()),
			Command.resolve(
				Draft.GenerateUploadFileId,
				Message.CompletedGenerateUploadFileId({ fileId: "f1" }),
			),
		)
	})

	test("files of a type a message cannot carry are left out", () => {
		const binary = new File(["x"], "tool.exe", { type: "application/x-msdownload" })
		story(
			update,
			given(fresh()),
			message(Message.SelectedFiles({ files: [binary] })),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: { intent: "error", title: "Unsupported file type", description: null },
				}),
			),
		)
	})

	test("removing an attachment drops only that id", () => {
		story(
			update,
			given({ ...fresh(), attachmentIds: [firstAttachment, secondAttachment] }),
			message(Message.ClickedRemoveAttachment({ attachmentId: firstAttachment })),
			model((current) => expect(current.attachmentIds).toEqual([secondAttachment])),
		)
	})

	test("signed out, selecting files toasts instead of uploading", () => {
		story(
			updateSignedOut,
			given(fresh()),
			message(Message.SelectedFiles({ files: [pngA] })),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Authentication required",
						description: "You must be logged in to upload files",
					},
				}),
			),
		)
	})
})

describe("typing indicator", () => {
	test("leaving the window deletes the live indicator", () => {
		story(
			update,
			given({
				...fresh(),
				typing: { ...Typing.init(), isTyping: true, sessionId: 1, indicator, lastContent: "H" },
			}),
			message(Message.LeftWindow()),
			Command.expectExact(Typing.DeleteTypingIndicator(indicator)),
			Command.resolve(Typing.DeleteTypingIndicator, Typing.Message.CompletedDeleteTypingIndicator()),
			model((current) => expect(current.typing.isTyping).toBe(false)),
		)
	})

	test("a heartbeat that answers after the session ended deletes its indicator", () => {
		story(
			update,
			given({ ...fresh(), typing: { ...Typing.init(), isTyping: false, sessionId: 2 } }),
			message(
				Message.GotTypingMessage({
					message: Typing.Message.SucceededSendTypingHeartbeat({ sessionId: 1, indicator }),
				}),
			),
			Command.expectExact(Typing.DeleteTypingIndicator(indicator)),
			Command.resolve(Typing.DeleteTypingIndicator, Typing.Message.CompletedDeleteTypingIndicator()),
		)
	})

	test("without a channel membership typing sends nothing", () => {
		story(
			(current: Draft.Model, next: Draft.Message) =>
				DraftUpdate.update(current, next, { ...context, memberId: null }),
			given(fresh()),
			message(composer(Composer.Message.UpdatedDraft({ markdown: "H", isEmpty: false }))),
			Command.expectNone(),
		)
	})
})

describe("slash command execution", () => {
	const botId = Schema.decodeSync(BotId)(uuid(6))
	const command: Composer.BotCommand = {
		id: Schema.decodeSync(BotCommandId)(uuid(3)),
		name: "deploy",
		description: "Deploy",
		bot: { id: botId, name: "CI", avatarUrl: null },
		arguments: [{ name: "branch", description: null, required: true, placeholder: null, type: "string" }],
	}
	const inCommand = (
		values: Record<string, string>,
		submission: Composer.CommandSubmission = "Idle",
	): Draft.Model => {
		const base = fresh()
		return { ...base, composer: { ...base.composer, commandInput: { command, values, submission } } }
	}
	const execute = Draft.ExecuteBotCommand({
		orgId: organizationId,
		botId,
		commandName: "deploy",
		botName: "CI",
		channelId,
		arguments: [{ name: "branch", value: "main" }],
	})

	test("a missing required argument toasts and runs nothing", () => {
		story(
			update,
			given(inCommand({})),
			message(composer(Composer.Message.ClickedExecuteCommand())),
			Command.expectNone(),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: { intent: "error", title: "Missing required: branch", description: null },
				}),
			),
		)
	})

	test("Enter in a field executes; success leaves command mode and focuses the editor", () => {
		story(
			update,
			given(inCommand({ branch: "main" })),
			message(
				composer(
					Composer.Message.PressedCommandFieldKey({ index: 0, key: "Enter", shiftKey: false }),
				),
			),
			Command.expectExact(execute),
			model((current) => expect(current.composer.commandInput?.submission).toBe("Executing")),
			Command.resolve(
				Draft.ExecuteBotCommand,
				Message.SucceededExecuteBotCommand({ commandName: "deploy" }),
			),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: { intent: "success", title: "Executed /deploy", description: null },
				}),
			),
			Command.expectExact(EditorCommands.FocusEditor({ editorId })),
			Command.resolve(EditorCommands.FocusEditor, Composer.Message.CompletedFocusEditor()),
			model((current) => expect(current.composer.commandInput).toBeNull()),
		)
	})

	test("pressing Execute again while the command runs does not run it twice", () => {
		story(
			update,
			given(inCommand({ branch: "main" }, "Executing")),
			message(composer(Composer.Message.ClickedExecuteCommand())),
			Command.expectNone(),
			message(
				composer(
					Composer.Message.PressedCommandFieldKey({ index: 0, key: "Enter", shiftKey: false }),
				),
			),
			Command.expectNone(),
		)
	})

	test("a failed command keeps the argument panel open, ready again, and names the failure", () => {
		story(
			update,
			given(inCommand({ branch: "main" }, "Executing")),
			message(
				Message.FailedExecuteBotCommand({
					commandName: "deploy",
					botName: "CI",
					reason: "BotNotInstalled",
				}),
			),
			expectOutMessage(
				Draft.OutMessage.RequestedToast({
					toast: { intent: "error", title: 'Bot "CI" is not installed', description: null },
				}),
			),
			model((current) => {
				expect(current.composer.commandInput?.command.name).toBe("deploy")
				expect(current.composer.commandInput?.submission).toBe("Idle")
			}),
		)
	})
})

describe("emoji and GIFs", () => {
	test("a unicode emoji is typed into the editor; a custom one is inserted inline", () => {
		story(
			update,
			given(fresh()),
			message(Message.SelectedEmoji({ emoji: "🎉", label: "party", imageUrl: null })),
			Command.expectExact(EditorCommands.InsertEditorText({ editorId, text: "🎉" })),
			Command.resolve(EditorCommands.InsertEditorText, Composer.Message.CompletedInsertEditorText()),
			message(
				Message.SelectedEmoji({
					emoji: ":hazel:",
					label: "hazel",
					imageUrl: "https://cdn/hazel.png",
				}),
			),
			Command.expectExact(
				EditorCommands.InsertCustomEmoji({
					editorId,
					name: "hazel",
					imageUrl: "https://cdn/hazel.png",
				}),
			),
			Command.resolve(EditorCommands.InsertCustomEmoji, Composer.Message.CompletedInsertCustomEmoji()),
		)
	})

	test("a GIF answers the reply but leaves an edit in progress alone", () => {
		const send = (replyToMessageId: MessageId | null) =>
			Draft.SendMessage({
				channelId,
				authorId: ada,
				content: "https://media.klipy.com/cat.gif",
				replyToMessageId,
				threadChannelId: null,
				attachmentIds: [],
				restoreContent: false,
			})
		story(
			update,
			given(replying()),
			message(Message.SelectedGif({ url: "https://media.klipy.com/cat.gif" })),
			Command.expectExact(send(replyId)),
			Command.resolve(Draft.SendMessage, Message.SucceededSendMessage()),
			model((current) => expect(current.composeMode).toEqual(Draft.ComposeMode.Plain())),
		)
		story(
			update,
			given(editing()),
			message(Message.SelectedGif({ url: "https://media.klipy.com/cat.gif" })),
			Command.expectExact(send(null)),
			Command.resolve(Draft.SendMessage, Message.SucceededSendMessage()),
			model((current) => expect(Draft.editingMessageIdOf(current)).toBe(editId)),
		)
	})
})
