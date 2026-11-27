import { ChannelId, type MessageId, PinnedMessageId, type UserId } from "@hazel/schema"
import { Effect, Match, Option, Schema } from "effect"
import { Command, File } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { type ComposerNotice, ComposerRequest } from "@hazel/shared-screens/chat/composer/host"
import { holdFiles, requestComposer } from "../../../root/composer"
import { errorToast, errorToastOf, successToast } from "../../../data/actions"
import * as MessageList from "../../../mount/message-list"
import type { ToastRequest } from "../../../overlay/toasts"
import type { HazelRpc } from "../../../rpc"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	type CopiedContent,
	type MessageActionFailure,
	CopyImage,
	CopyText,
	CreateIssueFromMessage,
	CreateThread,
	DownloadImage,
	GenerateThreadChannelId,
	GenerateThreadName,
	OpenUrl,
	PinMessage,
	PressEmbedAction,
	ToggleReaction,
	UnpinMessage,
} from "../message-actions"
import { identityOf, toDeriveContext } from "../derive"
import * as IssueControl from "../issue-control"
import * as Overlays from "../overlays"
import type { ChatMessage } from "../rows"
import { Message, type Model, type PageReturn, type ThreadCreation, type ThreadPanel } from "./model"
import * as Jump from "./jump"
import { loadWidthCommands } from "./thread-width"
import { ClearChannelNotifications } from "./clear-notifications"
import * as NewMessages from "./new-messages"
import { resetWindow } from "./window"
import { openViewerOf } from "./viewer-images"

/** The channel page's write path: `ChatProvider`'s actions; the composers are shared screens (`root/composer.ts`). */

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

/**
 * Runs a second step on the first's Model, keeping both steps' Commands and the later OutMessage
 * (`Update.combine` for page steps, which can each raise one).
 */
export const andThen = (first: PageReturn, second: (model: Model) => PageReturn): PageReturn => {
	const next = second(first.model)
	return {
		model: next.model,
		commands: [...(first.commands ?? []), ...(next.commands ?? [])],
		...((next.outMessage ?? first.outMessage) === undefined
			? {}
			: { outMessage: next.outMessage ?? first.outMessage }),
	}
}

const wrapAction = (message: ActionMessage) => Message.GotActionMessage({ message })

export const actionCommands = (commands: ReadonlyArray<Command.Command<ActionMessage, never, HazelRpc>>) =>
	Command.mapMessages(commands, wrapAction)

/** Asks the shared composer of `channelId` (`root/composer.ts`) over the bus. */
export const RequestComposer = Command.define("RequestComposer", {
	args: { channelId: ChannelId, request: ComposerRequest },
	messages: [Message.CompletedRequestComposer],
	execute: ({ channelId, request }) =>
		Effect.sync(() => requestComposer(channelId, request)).pipe(
			Effect.as(Message.CompletedRequestComposer()),
		),
})

export const askComposer = (model: Model, channelId: ChannelId, request: ComposerRequest): PageReturn => ({
	model,
	commands: [RequestComposer({ channelId, request })],
})

/** The composer that receives global typing: the thread's while one is open (legacy `disableGlobalKeyboardFocus`). */
export const focusedComposer = (model: Model): ChannelId =>
	model.threadPanel?.threadChannelId ?? model.channelId

const withPanel = (model: Model, change: (panel: ThreadPanel) => ThreadPanel): Model =>
	model.threadPanel === null
		? model
		: modifyFields(model, { threadPanel: (panel) => (panel === null ? null : change(panel)) })

/** A composer's notice: a send scrolls the channel's list to its end, Escape marks the channel read. */
export const composerNotice = (model: Model, notice: ComposerNotice): PageReturn => {
	if (notice._tag === "Escaped")
		return { model, commands: [ClearChannelNotifications({ channelId: notice.channelId })] }
	if (notice._tag !== "Sent" || notice.channelId !== model.channelId) return { model }
	// A jump still on its way would pull the list back off the message just sent. Writing reads
	// the channel, as in Discord: the "New" line goes (the rows re-derive with the message).
	const present = resetWindow(
		modifyFields(model, { pendingJump: () => null, newMessages: NewMessages.dismiss }),
	)
	const scrolled = MessageList.scrollToEnd(present.list)
	return {
		model: modifyFields(present, { list: () => scrolled.model }),
		commands: Command.mapMessages(scrolled.commands ?? [], (message) =>
			Message.GotListMessage({ message }),
		),
	}
}

const findMessage = (model: Model, messageId: MessageId) =>
	model.messages.find((message) => message.id === messageId) ??
	model.threadPanel?.messages.find((message) => message.id === messageId)

/** `handleReaction`: toggle the reaction (`toggleReactionAction`). */
export const react = (model: Model, messageId: MessageId, emoji: string): PageReturn => {
	if (model.currentUserId === null) return { model }
	const channelId = findMessage(model, messageId)?.channelId ?? model.channelId
	return {
		model,
		commands: actionCommands([
			ToggleReaction({ messageId, channelId, emoji, userId: model.currentUserId }),
		]),
	}
}

// THREAD PANEL

/** The thread panel opens on a thread: a new panel (a new `ChatProvider`); its composer focuses itself. */
export const openThread = (
	model: Model,
	threadChannelId: ChannelId,
	messageId: MessageId,
	creation: ThreadCreation,
): PageReturn =>
	model.threadPanel?.threadChannelId === threadChannelId && model.threadPanel.messageId === messageId
		? { model }
		: {
				model: modifyFields(model, {
					threadPanel: () => ({
						threadChannelId,
						messageId,
						memberId: null,
						creation,
						isNaming: false,
						messages: [],
						rows: [],
						pins: [],
						issue: IssueControl.init(messageId),
						readUpToMs: 0,
					}),
				}),
				commands: loadWidthCommands(model),
			}

export const closeThread = (model: Model): PageReturn =>
	model.threadPanel === null ? { model } : { model: modifyFields(model, { threadPanel: () => null }) }

/** `createThread`: open an existing thread, or create one with a fresh id. */
const createThread = (model: Model, messageId: MessageId): PageReturn => {
	if (model.channel?.type === "thread")
		return { model, outMessage: toast(errorToast("Cannot create threads within threads")) }
	const message = findMessage(model, messageId)
	if (message?.threadChannelId) return openThread(model, message.threadChannelId, messageId, "Created")
	if (model.currentUserId === null) return { model }
	return { model, commands: actionCommands([GenerateThreadChannelId({ messageId })]) }
}

/** The thread panel header's "Generate thread name". */
export const generateThreadName = (model: Model): PageReturn => {
	const panel = model.threadPanel
	if (panel === null || panel.isNaming) return { model }
	return {
		model: withPanel(model, (current) => modifyFields(current, { isNaming: () => true })),
		commands: actionCommands([GenerateThreadName({ channelId: panel.threadChannelId })]),
	}
}

/** A naming result: the panel stops waiting only if it still shows that thread. */
const namedThread = (model: Model, threadChannelId: ChannelId): Model =>
	model.threadPanel?.threadChannelId === threadChannelId
		? withPanel(model, (panel) => modifyFields(panel, { isNaming: () => false }))
		: model

// ACTIONS

const pinnedIdOf = (model: Model, messageId: MessageId) =>
	Option.fromNullishOr(
		[...model.pinned, ...(model.threadPanel?.pins ?? [])].find((pin) => pin.messageId === messageId)
			?.pinnedId,
	).pipe(Option.flatMap(Schema.decodeUnknownOption(PinnedMessageId)))

/** A message author's display name, for the reply bar. */
const authorNameOf = (model: Model, authorId: UserId) =>
	identityOf(toDeriveContext(model.lookups, model.currentUserId ?? undefined), authorId)?.displayName ?? ""

/** `handlePin`: unpin by the pin's id, else pin. */
const togglePin = (model: Model, messageId: MessageId): PageReturn => {
	const pinnedId = pinnedIdOf(model, messageId)
	if (Option.isSome(pinnedId))
		return { model, commands: actionCommands([UnpinMessage({ pinnedMessageId: pinnedId.value })]) }
	if (model.currentUserId === null) return { model }
	return {
		model,
		commands: actionCommands([
			PinMessage({
				messageId,
				channelId: findMessage(model, messageId)?.channelId ?? model.channelId,
				userId: model.currentUserId,
			}),
		]),
	}
}

const copy = (model: Model, text: string, content: CopiedContent): PageReturn => ({
	model,
	commands: actionCommands([CopyText({ text, content })]),
})

const copiedToast = (content: CopiedContent): ToastRequest =>
	Match.value(content).pipe(
		Match.when("MessageText", () =>
			successToast("Copied!", "Message content has been copied to your clipboard."),
		),
		Match.when("MessageId", () =>
			successToast("Copied!", "Message ID has been copied to your clipboard."),
		),
		Match.when("ImageUrl", () => successToast("URL copied", "Image URL has been copied to clipboard.")),
		Match.exhaustive,
	)

/** `ImageViewerModal`'s toolbar (the channel's viewer and the Files tab's). */
export const viewerAction = (
	model: Model,
	action: Overlays.ViewerAction,
	url: string,
	fileName: string,
): PageReturn =>
	Match.value(action).pipe(
		Match.withReturnType<PageReturn>(),
		Match.when("download", () => ({
			model,
			commands: actionCommands([DownloadImage({ url, fileName })]),
			outMessage: toast(successToast("Image downloaded", "Your image has been downloaded.")),
		})),
		Match.when("copyImage", () => ({ model, commands: actionCommands([CopyImage({ url })]) })),
		Match.when("copyUrl", () => copy(model, url, "ImageUrl")),
		Match.when("openInBrowser", () => ({ model, commands: actionCommands([OpenUrl({ url })]) })),
		Match.exhaustive,
	)

/** The context menu's "Add reaction": the emoji picker modal. */
const openReactionModal = (model: Model, messageId: MessageId): PageReturn => {
	const opened = Overlays.openReactionModal(model.overlays, messageId)
	return {
		model: modifyFields(model, { overlays: () => opened.model }),
		commands: Command.mapMessages(opened.commands ?? [], (message) =>
			Message.GotOverlaysMessage({ message }),
		),
	}
}

const messageAction = (model: Model, messageId: MessageId, action: Overlays.MessageAction): PageReturn => {
	const message = findMessage(model, messageId)
	return Match.value(action).pipe(
		Match.withReturnType<PageReturn>(),
		Match.when("reply", () =>
			message === undefined
				? { model }
				: askComposer(model, message.channelId, {
						_tag: "Reply",
						messageId,
						author: authorNameOf(model, message.authorId),
						text: message.content.split("\n")[0] ?? "",
					}),
		),
		Match.when("edit", () =>
			message === undefined
				? { model }
				: askComposer(model, message.channelId, {
						_tag: "Edit",
						messageId,
						content: message.content,
					}),
		),
		Match.when("thread", () => createThread(model, messageId)),
		Match.when("pin", () => togglePin(model, messageId)),
		Match.when("copy", () => copy(model, message?.content ?? "", "MessageText")),
		Match.when("copy-id", () => copy(model, messageId, "MessageId")),
		Match.when("delete", () => ({
			model,
			outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId } }),
		})),
		Match.when("add-reaction", () => openReactionModal(model, messageId)),
		Match.when("create-issue", () => createIssue(model, messageId)),
		Match.exhaustive,
	)
}

/** The thread panel's issue control, when the panel hangs off `messageId`. */
const withPanelIssue = (
	model: Model,
	messageId: MessageId,
	change: (issue: IssueControl.Model) => IssueControl.Model,
): Model =>
	model.threadPanel?.messageId === messageId
		? withPanel(model, (panel) => modifyFields(panel, { issue: change }))
		: model

/**
 * "Create issue" on a top-level message of a channel linked to a customer (the message action, or
 * the thread panel's button): `customers.issue.createFromMessage`, which answers an existing issue.
 */
export const createIssue = (model: Model, messageId: MessageId): PageReturn => {
	const organizationId = model.channel?.organizationId
	if (organizationId === undefined || model.customer === null)
		return { model: withPanelIssue(model, messageId, IssueControl.settledCreate) }
	return {
		model,
		commands: actionCommands([
			CreateIssueFromMessage({ organizationId, channelId: model.channelId, messageId }),
		]),
	}
}

/** The toolbar, menus and context menu's actions (`useMessageActions`). */
export const handleOverlaysOut = (model: Model, out: Overlays.OutMessage): PageReturn =>
	Overlays.OutMessage.match<PageReturn>(out, {
		RequestedReaction: ({ messageId, emoji }) => react(model, messageId, emoji),
		RequestedViewerAction: ({ action, url, fileName }) => viewerAction(model, action, url, fileName),
		RequestedOpenImageAction: ({ action }) => {
			const open = openViewerOf(model)
			const image = open?.images[open.index]
			return image === undefined ? { model } : viewerAction(model, action, image.url, image.fileName)
		},
		RequestedMessageAction: ({ messageId, action }) => messageAction(model, messageId, action),
		RequestedJump: ({ messageId }) => Jump.toMessage(model, messageId, messageId),
	})

/** A reaction or pin on a message that is gone. */
export const messageNotFoundToast = (reason: MessageActionFailure): ToastRequest =>
	errorToastOf(
		failureMessage(reason, {
			MessageNotFound: {
				title: "Message not found",
				description: "This message may have been deleted.",
			},
		}),
	)

export const withToast = (model: Model, request: ToastRequest | null): PageReturn =>
	request === null ? { model } : { model, outMessage: toast(request) }

/** A button on a bot's message: `message.interact`, reported only if it fails. */
export const pressEmbedAction = (
	model: Model,
	press: { readonly channelId: ChannelId; readonly messageId: MessageId; readonly actionId: string },
): PageReturn => ({ model, commands: actionCommands([PressEmbedAction(press)]) })

export const handleActionMessage = (model: Model, message: ActionMessage): PageReturn =>
	ActionMessage.match<PageReturn>(message, {
		SucceededCreateIssue: ({ messageId }) =>
			withToast(
				withPanelIssue(model, messageId, IssueControl.settledCreate),
				successToast("Issue created", "Find it in the support inbox."),
			),
		FailedCreateIssue: ({ messageId, reason }) =>
			withToast(
				withPanelIssue(model, messageId, IssueControl.settledCreate),
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Message not found",
							description: "This message may have been deleted.",
						},
						InvalidRequest: {
							title: "Couldn't create an issue",
							description:
								"Issues open on top-level messages of channels linked to a customer.",
						},
					}),
				),
			),
		SucceededToggleReaction: () => ({ model }),
		// The bot answers by editing its message; nothing to show until it does.
		SucceededPressEmbedAction: () => ({ model }),
		FailedPressEmbedAction: ({ reason }) =>
			withToast(
				model,
				errorToastOf(
					failureMessage(reason, {
						MessageNotFound: {
							title: "Message not found",
							description: "The message no longer exists",
						},
						ActionUnavailable: {
							title: "That button no longer works",
							description: "The app may have already handled it.",
						},
					}),
				),
			),
		FailedToggleReaction: ({ reason }) => withToast(model, messageNotFoundToast(reason)),
		SucceededPinMessage: () => withToast(model, successToast("Message pinned")),
		FailedPinMessage: ({ reason }) => withToast(model, messageNotFoundToast(reason)),
		SucceededUnpinMessage: () => withToast(model, successToast("Message unpinned")),
		FailedUnpinMessage: ({ reason }) =>
			withToast(
				model,
				errorToastOf(
					failureMessage(reason, {
						PinNotFound: {
							title: "Pin not found",
							description: "This message may have already been unpinned.",
						},
					}),
				),
			),
		// The panel opens at once on the optimistic id; a send or a file waits for the RPC (`holdForThread`).
		CompletedGenerateThreadChannelId: ({ messageId, threadChannelId }) => {
			if (model.currentUserId === null || model.channel === null) return { model }
			// The same message's thread: already opening here, or already made (its link not in yet).
			if (model.threadPanel?.threadChannelId === threadChannelId) return { model }
			if (model.lookups.threadChannels.some((channel) => channel.id === threadChannelId))
				return openThread(model, threadChannelId, messageId, "Created")
			const create = CreateThread({
				threadChannelId,
				messageId,
				parentChannelId: model.channelId,
				organizationId: model.channel.organizationId,
				currentUserId: model.currentUserId,
			})
			const opened = openThread(model, threadChannelId, messageId, "Creating")
			return { ...opened, commands: [...(opened.commands ?? []), ...actionCommands([create])] }
		},
		// Only the panel still showing this thread stops waiting.
		SucceededCreateThread: ({ threadChannelId }) => ({
			model:
				model.threadPanel?.threadChannelId === threadChannelId
					? withPanel(model, (panel) => modifyFields(panel, { creation: () => "Created" as const }))
					: model,
		}),
		// The panel on the thread that failed closes; the failure is reported either way.
		FailedCreateThread: ({ threadChannelId, reason }) =>
			andThen(
				model.threadPanel?.threadChannelId === threadChannelId ? closeThread(model) : { model },
				(next) =>
					withToast(
						next,
						errorToastOf(
							failureMessage(reason, {
								MessageNotFound: {
									title: "Message not found",
									description: "The message no longer exists",
								},
								InvalidRequest: {
									title: "Cannot create thread",
									description: "This message can't start a thread.",
								},
								NestedThread: {
									title: "Cannot create thread",
									description: "Threads cannot be created within threads",
								},
							}),
						),
					),
			),
		SucceededCopyText: ({ content }) => withToast(model, copiedToast(content)),
		FailedCopyText: () =>
			withToast(model, errorToast("Couldn't copy", "Your browser blocked access to the clipboard.")),
		SucceededCopyImage: () =>
			withToast(model, successToast("Image copied", "The image has been copied to your clipboard.")),
		FailedCopyImage: () =>
			withToast(model, errorToast("Couldn't copy image", "Try downloading it instead.")),
		CompletedDownloadImage: () => ({ model }),
		CompletedOpenUrl: () => ({ model }),
		SucceededGenerateThreadName: ({ threadChannelId }) => ({
			model: namedThread(model, threadChannelId),
		}),
		FailedGenerateThreadName: ({ threadChannelId, reason }) =>
			withToast(
				namedThread(model, threadChannelId),
				errorToastOf(
					failureMessage(reason, {
						ThreadNotFound: {
							title: "Thread not found",
							description: "This thread may have been deleted.",
						},
						NotAThread: {
							title: "Cannot name this thread",
							description: "This channel is not a thread, or its original message is gone.",
						},
						OriginalMessageNotFound: {
							title: "Original message not found",
							description: "The message that started this thread could not be found.",
						},
						ThreadContextUnavailable: {
							title: "Database error",
							description: "Failed to load thread data. Please try again.",
						},
						AIUnavailable: {
							title: "AI service unavailable",
							description: "The AI service is temporarily unavailable. Please try again later.",
						},
						AIRateLimited: {
							title: "AI rate limited",
							description: "Please wait a moment and try again.",
						},
						AIResponseInvalid: {
							title: "AI response error",
							description: "The AI returned an unexpected response. Please try again.",
						},
						SaveFailed: {
							title: "Update failed",
							description: "Failed to save the thread name. Please try again.",
						},
					}),
				),
			),
	})

/** Puts the keyboard back in the channel's composer (Escape or ArrowDown past the newest message). */
export const focusComposer = (model: Model): PageReturn =>
	askComposer(model, model.channelId, { _tag: "Focus" })

/** `useGlobalKeyboardFocus`: a key typed, or text pasted, outside any field goes into the focused composer. */
export const insertGlobalText = (model: Model, text: string): PageReturn =>
	askComposer(model, focusedComposer(model), { _tag: "InsertText", text })

/** Hands pasted files to the host (`root/composer.ts`), then to the composer of `channelId`. */
export const AttachPastedFiles = Command.define("AttachPastedFiles", {
	args: { channelId: ChannelId, files: Schema.Array(File.File) },
	messages: [Message.CompletedRequestComposer],
	execute: ({ channelId, files }) =>
		Effect.sync(() => requestComposer(channelId, { _tag: "AddFiles", files: holdFiles(files) })).pipe(
			Effect.as(Message.CompletedRequestComposer()),
		),
})

/** Files pasted anywhere on the page attach to the focused composer, as a paste in its field does. */
export const pasteGlobalFiles = (model: Model, files: ReadonlyArray<File>): PageReturn => ({
	model,
	commands: [AttachPastedFiles({ channelId: focusedComposer(model), files })],
})
