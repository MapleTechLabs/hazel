import { type ChannelId, type MessageId, PinnedMessageId, type UserId } from "@hazel/schema"
import { Match, Option, Schema } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as DraftUpdate from "../../../composer/draft-update"
import * as EditorCommands from "../../../composer/editor-commands"
import * as Typing from "../../../composer/typing"
import { errorToast, errorToastOf, successToast } from "../../../data/actions"
import * as MessageList from "../../../mount/message-list"
import type { ToastRequest } from "../../../overlay/toasts"
import type { HazelRpc } from "../../../rpc"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	ActionMessage,
	type CopiedContent,
	type MessageActionFailure,
	CopyText,
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
import * as Overlays from "../overlays"
import type { ChatMessage } from "../rows"
import { Message, type Model, type PageReturn, type ThreadCreation, type ThreadPanel } from "./model"
import { loadWidthCommands } from "./thread-width"
import { resetWindow } from "./window"

/** The channel page's write path: `ChatProvider`'s actions and the two drafts (channel and thread). */

export type Which = "channel" | "thread"

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

const wrapDraft = (which: Which) => (message: Draft.Message) =>
	which === "channel" ? Message.GotDraftMessage({ message }) : Message.GotThreadDraftMessage({ message })

const wrapAction = (message: ActionMessage) => Message.GotActionMessage({ message })

export const actionCommands = (commands: ReadonlyArray<Command.Command<ActionMessage, never, HazelRpc>>) =>
	Command.mapMessages(commands, wrapAction)

/** The draft that receives global typing: the thread's while one is open (legacy `disableGlobalKeyboardFocus`). */
export const focusedDraft = (model: Model): Which => (model.threadPanel !== null ? "thread" : "channel")

const draftOf = (model: Model, which: Which): Draft.Model | null =>
	which === "channel" ? model.draft : (model.threadPanel?.draft ?? null)

const withPanel = (model: Model, change: (panel: ThreadPanel) => ThreadPanel): Model =>
	model.threadPanel === null
		? model
		: modifyFields(model, { threadPanel: (panel) => (panel === null ? null : change(panel)) })

const lastOwn = (messages: ReadonlyArray<ChatMessage>, currentUserId: string | null) =>
	Option.fromNullishOr(messages.find((message) => message.authorId === currentUserId)).pipe(
		Option.map((message) => ({ id: message.id, content: message.content })),
		Option.getOrNull,
	)

/** What a draft needs from the page: user, organization, membership, last own message. */
export const contextFor = (model: Model, which: Which, shared: Shared | null): Draft.Context => ({
	currentUserId: model.currentUserId,
	organizationId: shared?.organization?.id ?? null,
	memberId:
		which === "channel"
			? (model.members?.find((member) => member.userId === model.currentUserId)?.id ?? null)
			: (model.threadPanel?.memberId ?? null),
	// `messages` is newest first; the thread panel's are oldest first.
	lastOwnMessage:
		which === "channel"
			? lastOwn(model.messages, model.currentUserId)
			: lastOwn([...(model.threadPanel?.messages ?? [])].reverse(), model.currentUserId),
})

/** Folds a draft result back into the page: commands wrapped, toasts raised, sends scroll to the end. */
export const liftDraft = (model: Model, which: Which, result: DraftUpdate.Return): PageReturn => {
	const next =
		which === "channel"
			? modifyFields(model, { draft: () => result.model })
			: withPanel(model, (panel) => modifyFields(panel, { draft: () => result.model }))
	const commands = Command.mapMessages(result.commands ?? [], wrapDraft(which))
	const out = result.outMessage
	if (out === undefined) return { model: next, commands }
	return Draft.OutMessage.match<PageReturn>(out, {
		RequestedToast: ({ toast: request }) => ({ model: next, commands, outMessage: toast(request) }),
		// `onMessageSent`: the channel's list scrolls to the bottom.
		SentMessage: () => {
			if (which === "thread") return { model: next, commands }
			const present = resetWindow(next)
			const scrolled = MessageList.scrollToEnd(present.list)
			return {
				model: modifyFields(present, { list: () => scrolled.model }),
				commands: [
					...commands,
					...Command.mapMessages(scrolled.commands ?? [], (message) =>
						Message.GotListMessage({ message }),
					),
				],
			}
		},
	})
}

/** Composer data both drafts share (legacy reads it per editor from the same queries). */
const SHARED_COMPOSER_DATA: ReadonlyArray<string> = [
	"UpdatedMentionMembers",
	"UpdatedPresence",
	"UpdatedMentionableBots",
	"UpdatedBotCommands",
	"UpdatedCustomEmojis",
]

const isSharedComposerData = (message: Draft.Message) =>
	message._tag === "GotComposerMessage" && SHARED_COMPOSER_DATA.includes(message.message._tag)

const updateOneDraft = (
	model: Model,
	which: Which,
	message: Draft.Message,
	shared: Shared | null,
): PageReturn => {
	const draft = draftOf(model, which)
	return draft === null
		? { model }
		: liftDraft(model, which, DraftUpdate.update(draft, message, contextFor(model, which, shared)))
}

export const updateDraft = (
	model: Model,
	which: Which,
	message: Draft.Message,
	shared: Shared | null,
): PageReturn =>
	which === "channel" && isSharedComposerData(message)
		? andThen(updateOneDraft(model, "channel", message, shared), (next) =>
				updateOneDraft(next, "thread", message, shared),
			)
		: updateOneDraft(model, which, message, shared)

/** Presence and custom emojis arrive as page lookups; the composers get their copy. */
export const forwardComposerData = (model: Model, message: Composer.Message): PageReturn =>
	updateDraft(model, "channel", Draft.Message.GotComposerMessage({ message }), null)

export const toComposerPresence = (
	presence: ReadonlyArray<{ readonly userId: UserId; readonly status: string }>,
) =>
	presence.map((row) => ({
		userId: row.userId,
		status: isPresenceStatus(row.status) ? row.status : ("offline" as const),
	}))

const isPresenceStatus = Schema.is(Composer.PresenceStatus)

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

export const newThreadDraft = (model: Model, threadChannelId: ChannelId): Draft.Model => {
	const draft = Draft.init(threadChannelId, `thread-composer-${threadChannelId}`, "Reply in thread...")
	const { members, presence, mentionableBots, botCommands, customEmojis } = model.draft.composer
	return {
		...draft,
		composer: { ...draft.composer, members, presence, mentionableBots, botCommands, customEmojis },
	}
}

/** `useTyping` deletes the indicator when the panel's composer unmounts. */
const stopThreadTyping = (model: Model): ReadonlyArray<Command.Command<Message, never, HazelRpc>> =>
	model.threadPanel === null
		? []
		: Command.mapMessages(Typing.stop(model.threadPanel.draft.typing).commands ?? [], (message) =>
				Message.GotThreadDraftMessage({ message: Draft.Message.GotTypingMessage({ message }) }),
			)

/** The thread panel opens on a thread: a new panel (a new `ChatProvider`), with its own draft. */
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
						draft: newThreadDraft(model, threadChannelId),
						memberId: null,
						creation,
						isNaming: false,
						messages: [],
						rows: [],
					}),
				}),
				commands: [...stopThreadTyping(model), ...loadWidthCommands(model)],
			}

export const closeThread = (model: Model): PageReturn =>
	model.threadPanel === null
		? { model }
		: { model: modifyFields(model, { threadPanel: () => null }), commands: stopThreadTyping(model) }

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
	Option.fromNullishOr(model.pinned.find((pin) => pin.messageId === messageId)?.pinnedId).pipe(
		Option.flatMap(Schema.decodeUnknownOption(PinnedMessageId)),
	)

/** `handlePin`: unpin by the pin's id, else pin. */
const togglePin = (model: Model, messageId: MessageId): PageReturn => {
	const pinnedId = pinnedIdOf(model, messageId)
	if (Option.isSome(pinnedId))
		return { model, commands: actionCommands([UnpinMessage({ pinnedMessageId: pinnedId.value })]) }
	if (model.currentUserId === null) return { model }
	return {
		model,
		commands: actionCommands([
			PinMessage({ messageId, channelId: model.channelId, userId: model.currentUserId }),
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
		Match.when("copyUrl", () => copy(model, url, "ImageUrl")),
		Match.when("openInBrowser", () => ({ model, commands: actionCommands([OpenUrl({ url })]) })),
		Match.exhaustive,
	)

/** The context menu's "Add Reaction": the emoji picker modal. */
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
		Match.when("reply", () => ({
			model: modifyFields(model, { draft: (draft) => DraftUpdate.setReply(draft, messageId) }),
		})),
		Match.when("edit", () =>
			message === undefined
				? { model }
				: liftDraft(
						model,
						"channel",
						DraftUpdate.startEditing(model.draft, messageId, message.content),
					),
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
		Match.exhaustive,
	)
}

/** The toolbar, menus and context menu's actions (`useMessageActions`). */
export const handleOverlaysOut = (model: Model, out: Overlays.OutMessage): PageReturn =>
	Overlays.OutMessage.match<PageReturn>(out, {
		RequestedReaction: ({ messageId, emoji }) => react(model, messageId, emoji),
		RequestedViewerAction: ({ action, url, fileName }) => viewerAction(model, action, url, fileName),
		RequestedMessageAction: ({ messageId, action }) => messageAction(model, messageId, action),
	})

/** A reaction or pin on a message that is gone. */
const messageNotFoundToast = (reason: MessageActionFailure): ToastRequest =>
	errorToastOf(
		failureMessage(reason, {
			MessageNotFound: {
				title: "Message not found",
				description: "This message may have been deleted.",
			},
		}),
	)

const withToast = (model: Model, request: ToastRequest | null): PageReturn =>
	request === null ? { model } : { model, outMessage: toast(request) }

/** A button on a bot's message: `message.interact`, reported only if it fails. */
export const pressEmbedAction = (
	model: Model,
	press: { readonly channelId: ChannelId; readonly messageId: MessageId; readonly actionId: string },
): PageReturn => ({ model, commands: actionCommands([PressEmbedAction(press)]) })

export const handleActionMessage = (model: Model, message: ActionMessage): PageReturn =>
	ActionMessage.match<PageReturn>(message, {
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
		// The panel opens at once on the optimistic id; the composer waits for the RPC.
		CompletedGenerateThreadChannelId: ({ messageId, threadChannelId }) => {
			if (model.currentUserId === null || model.channel === null) return { model }
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
		// The members query brings the membership; the banner then gives way to the composer.
		SucceededJoinChannel: () =>
			withToast(
				modifyFields(model, { isJoining: () => false }),
				successToast("Successfully joined channel"),
			),
		FailedJoinChannel: ({ reason }) =>
			withToast(
				modifyFields(model, { isJoining: () => false }),
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
						},
					}),
				),
			),
	})

/** `useGlobalKeyboardFocus`: the typed character goes into the focused draft's editor. */
export const insertGlobalKey = (model: Model, key: string): PageReturn => {
	const which = focusedDraft(model)
	const draft = draftOf(model, which)
	if (draft === null || draft.composer.commandInput !== null) return { model }
	return {
		model,
		commands: Command.mapMessages(
			Command.mapMessages(
				[EditorCommands.InsertEditorText({ editorId: draft.composer.editorId, text: key })],
				(message) => Draft.Message.GotComposerMessage({ message }),
			),
			wrapDraft(which),
		),
	}
}
