import { type ChannelId, type MessageId, PinnedMessageId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command } from "foldkit"
import * as Composer from "../../../composer/composer"
import * as Draft from "../../../composer/draft"
import * as DraftUpdate from "../../../composer/draft-update"
import * as EditorCommands from "../../../composer/editor-commands"
import * as MessageList from "../../../mount/message-list"
import type { ToastRequest } from "../../../overlay/toasts"
import type { HazelRpc } from "../../../rpc"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { successToastOf } from "../action-effects"
import {
	ActionMessage,
	CopyText,
	CreateThread,
	GenerateThreadChannelId,
	GenerateThreadName,
	PinMessage,
	ToggleReaction,
	TrackEmojiUsage,
	UnpinMessage,
} from "../message-actions"
import * as Overlays from "../overlays"
import type { ChatMessage } from "../rows"
import { Message, type Model, type PageReturn } from "./model"
import { resetWindow } from "./page"

/** The channel page's write path: `ChatProvider`'s actions and the two drafts (channel and thread). */

export type Which = "channel" | "thread"

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

const wrapDraft = (which: Which) => (message: Draft.Message) =>
	which === "channel" ? Message.GotDraftMessage({ message }) : Message.GotThreadDraftMessage({ message })

const wrapAction = (message: ActionMessage) => Message.GotActionMessage({ message })

const actionCommands = (commands: ReadonlyArray<Command.Command<ActionMessage, never, HazelRpc>>) =>
	Command.mapMessages(commands, wrapAction)

/** The draft that receives global typing: the thread's while one is open (legacy `disableGlobalKeyboardFocus`). */
export const focusedDraft = (model: Model): Which =>
	model.overlays.thread !== null && model.threadDraft !== null ? "thread" : "channel"

const lastOwn = (messages: ReadonlyArray<ChatMessage>, currentUserId: string | null) =>
	Option.fromNullishOr(messages.find((message) => message.authorId === currentUserId)).pipe(
		Option.map((message) => ({ id: message.id, content: message.content })),
		Option.getOrNull,
	)

/** What a draft needs from the page: user, organization, membership, last own message. */
export const contextFor = (model: Model, which: Which, shared: Shared | null): Draft.Context => ({
	currentUserId: model.currentUserId,
	organizationId: shared?.currentUser?.organizationId ?? null,
	memberId:
		which === "channel"
			? (model.members?.find((member) => member.userId === model.currentUserId)?.id ?? null)
			: model.threadMemberId,
	// `messages` is newest first; the thread panel's are oldest first.
	lastOwnMessage:
		which === "channel"
			? lastOwn(model.messages, model.currentUserId)
			: lastOwn([...model.threadMessages].reverse(), model.currentUserId),
})

/** Folds a draft result back into the page: commands wrapped, toasts raised, sends scroll to the end. */
export const liftDraft = (model: Model, which: Which, result: DraftUpdate.Return): PageReturn => {
	const next: Model = which === "channel" ? { ...model, draft: result.model } : { ...model, threadDraft: result.model }
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
				model: { ...present, list: scrolled.model },
				commands: [
					...commands,
					...Command.mapMessages(scrolled.commands ?? [], (message) => Message.GotListMessage({ message })),
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

export const updateDraft = (model: Model, which: Which, message: Draft.Message, shared: Shared | null): PageReturn => {
	const draft = which === "channel" ? model.draft : model.threadDraft
	if (draft === null) return { model }
	const result = liftDraft(model, which, DraftUpdate.update(draft, message, contextFor(model, which, shared)))
	const thread = result.model.threadDraft
	if (which === "thread" || thread === null || !isSharedComposerData(message)) return result
	const threadResult = liftDraft(
		result.model,
		"thread",
		DraftUpdate.update(thread, message, contextFor(result.model, "thread", shared)),
	)
	return { ...result, model: threadResult.model, commands: [...(result.commands ?? []), ...(threadResult.commands ?? [])] }
}

/** Presence and custom emojis arrive as page lookups; the composers get their copy. */
export const forwardComposerData = (model: Model, message: Composer.Message): PageReturn =>
	updateDraft(model, "channel", Draft.Message.GotComposerMessage({ message }), null)

export const toComposerPresence = (presence: ReadonlyArray<{ readonly userId: string; readonly status: string }>) =>
	presence.map((row) => ({ userId: row.userId, status: isPresenceStatus(row.status) ? row.status : ("offline" as const) }))

const isPresenceStatus = Schema.is(Composer.PresenceStatus)

const findMessage = (model: Model, messageId: MessageId) =>
	model.messages.find((message) => message.id === messageId) ??
	model.threadMessages.find((message) => message.id === messageId)

/** `handleReaction`: count the emoji, then toggle (`toggleReactionAction`). */
export const react = (model: Model, messageId: MessageId, emoji: string): PageReturn => {
	if (model.currentUserId === null) return { model }
	const channelId = findMessage(model, messageId)?.channelId ?? model.channelId
	return {
		model,
		commands: actionCommands([
			TrackEmojiUsage({ emoji }),
			ToggleReaction({ messageId, channelId, emoji, userId: model.currentUserId }),
		]),
	}
}

/** The thread panel opens on a thread; its draft and membership start fresh. */
const openThread = (model: Model, threadChannelId: ChannelId, messageId: MessageId): Model => ({
	...model,
	overlays: { ...model.overlays, thread: { threadChannelId, messageId } },
	threadDraft:
		model.threadDraft?.channelId === threadChannelId ? model.threadDraft : newThreadDraft(model, threadChannelId),
	threadMemberId: model.threadDraft?.channelId === threadChannelId ? model.threadMemberId : null,
})

export const newThreadDraft = (model: Model, threadChannelId: ChannelId): Draft.Model => {
	const draft = Draft.init(threadChannelId, `thread-composer-${threadChannelId}`, "Reply in thread...")
	const { members, presence, mentionableBots, botCommands, customEmojis } = model.draft.composer
	return { ...draft, composer: { ...draft.composer, members, presence, mentionableBots, botCommands, customEmojis } }
}

/** `createThread`: open an existing thread, or create one with a fresh id. */
const createThread = (model: Model, messageId: MessageId): PageReturn => {
	if (model.channel?.type === "thread")
		return { model, outMessage: toast({ intent: "error", title: "Cannot create threads within threads", description: null }) }
	const message = findMessage(model, messageId)
	if (message?.threadChannelId) return { model: openThread(model, message.threadChannelId, messageId) }
	if (model.currentUserId === null) return { model }
	return { model, commands: actionCommands([GenerateThreadChannelId({ messageId })]) }
}

const pinnedIdOf = (model: Model, messageId: MessageId) =>
	Option.fromNullishOr(model.pinned.find((pin) => pin.messageId === messageId)?.pinnedId).pipe(
		Option.flatMap(Schema.decodeUnknownOption(PinnedMessageId)),
	)

/** `handlePin`: unpin by the pin's id, else pin. */
const togglePin = (model: Model, messageId: MessageId): PageReturn => {
	const pinnedId = pinnedIdOf(model, messageId)
	if (Option.isSome(pinnedId)) return { model, commands: actionCommands([UnpinMessage({ pinnedMessageId: pinnedId.value })]) }
	if (model.currentUserId === null) return { model }
	return {
		model,
		commands: actionCommands([PinMessage({ messageId, channelId: model.channelId, userId: model.currentUserId })]),
	}
}

const copy = (model: Model, text: string, description: string): PageReturn => ({
	model,
	commands: actionCommands([CopyText({ text })]),
	outMessage: toast(successToastOf("Copied!", description)),
})

/** The toolbar, menus and context menu's actions (`useMessageActions`). */
export const handleOverlaysOut = (model: Model, out: Overlays.OutMessage): PageReturn =>
	Overlays.OutMessage.match<PageReturn>(out, {
		RequestedReaction: ({ messageId, emoji }) => react(model, messageId, emoji),
		RequestedMessageAction: ({ messageId, action }) => {
			const message = findMessage(model, messageId)
			if (action === "reply") return { model: { ...model, draft: DraftUpdate.setReply(model.draft, messageId) } }
			if (action === "edit")
				return message === undefined
					? { model }
					: liftDraft(model, "channel", DraftUpdate.startEditing(model.draft, messageId, message.content))
			if (action === "thread") return createThread(model, messageId)
			if (action === "pin") return togglePin(model, messageId)
			if (action === "copy")
				return copy(model, message?.content ?? "", "Message content has been copied to your clipboard.")
			if (action === "copy-id") return copy(model, messageId, "Message ID has been copied to your clipboard.")
			if (action === "delete")
				return { model, outMessage: PageOutMessage.RequestedModal({ modal: { _tag: "DeleteMessage", messageId } }) }
			// "add-reaction": the context menu's emoji picker modal.
			const opened = Overlays.openReactionModal(model.overlays, messageId)
			return {
				model: { ...model, overlays: opened.model },
				commands: Command.mapMessages(opened.commands ?? [], (message) => Message.GotOverlaysMessage({ message })),
			}
		},
	})

const withToast = (model: Model, request: ToastRequest | null): PageReturn =>
	request === null ? { model } : { model, outMessage: toast(request) }

export const handleActionMessage = (model: Model, message: ActionMessage): PageReturn =>
	ActionMessage.match<PageReturn>(message, {
		CompletedToggleReaction: ({ toast: request }) => withToast(model, request),
		CompletedPinMessage: ({ toast: request }) => withToast(model, request),
		CompletedUnpinMessage: ({ toast: request }) => withToast(model, request),
		CompletedDeleteMessage: ({ toast: request }) => withToast(model, request),
		// The panel opens at once on the optimistic id; the composer waits for the RPC.
		CompletedGenerateThreadChannelId: ({ messageId, threadChannelId }) =>
			model.currentUserId === null || model.channel === null
				? { model }
				: {
						model: { ...openThread(model, threadChannelId, messageId), pendingThreadChannelId: threadChannelId },
						commands: actionCommands([
							CreateThread({
								threadChannelId,
								messageId,
								parentChannelId: model.channelId,
								organizationId: model.channel.organizationId,
								currentUserId: model.currentUserId,
							}),
						]),
					},
		SucceededCreateThread: () => ({ model: { ...model, pendingThreadChannelId: null } }),
		// Close the panel on failure.
		FailedCreateThread: ({ threadChannelId, toast: request }) => ({
			model: {
				...model,
				pendingThreadChannelId: null,
				overlays:
					model.overlays.thread?.threadChannelId === threadChannelId
						? { ...model.overlays, thread: null }
						: model.overlays,
			},
			outMessage: toast(request),
		}),
		CompletedCopyText: () => ({ model }),
		CompletedTrackEmojiUsage: () => ({ model }),
		CompletedGenerateThreadName: ({ toast: request }) =>
			withToast({ ...model, isGeneratingThreadName: false }, request),
	})

/** The thread panel header's "Generate thread name". */
export const generateThreadName = (model: Model): PageReturn => {
	const thread = model.overlays.thread
	if (thread === null || model.isGeneratingThreadName) return { model }
	return {
		model: { ...model, isGeneratingThreadName: true },
		commands: actionCommands([GenerateThreadName({ channelId: thread.threadChannelId })]),
	}
}

/** `useGlobalKeyboardFocus`: the typed character goes into the focused draft's editor. */
export const insertGlobalKey = (model: Model, key: string): PageReturn => {
	const which = focusedDraft(model)
	const draft = which === "channel" ? model.draft : model.threadDraft
	if (draft === null || draft.composer.commandInput !== null) return { model }
	return {
		model,
		commands: Command.mapMessages(
			[EditorCommands.InsertEditorText({ editorId: draft.composer.editorId, text: key })],
			(message) => wrapDraft(which)(Draft.Message.GotComposerMessage({ message })),
		),
	}
}

/** The thread panel's draft follows the open thread (a new panel, a new `ChatProvider`). */
export const syncThreadDraft = (model: Model): Model => {
	const thread = model.overlays.thread
	if (thread === null) return model.threadDraft === null ? model : { ...model, threadDraft: null, threadMemberId: null }
	return model.threadDraft?.channelId === thread.threadChannelId
		? model
		: { ...model, threadDraft: newThreadDraft(model, thread.threadChannelId), threadMemberId: null }
}
