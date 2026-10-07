import { ChannelId, MessageId, OrganizationId, PinnedMessageId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import { emojiUsageAtom } from "~/atoms/emoji-atoms"
import {
	createThreadAction,
	deleteMessageAction,
	pinMessageAction,
	toggleReactionAction,
	unpinMessageAction,
} from "~/db/actions"
import { ToastRequest } from "../../overlay/toasts"
import { HazelRpc } from "../../rpc"
import { notRetryable, rateLimited, runChatAction, toastOfExit } from "./action-effects"
import { trackEmojiUsage } from "./emoji-usage"

/**
 * The message actions of `ChatProvider` and `useMessageActions`: each Command runs the same
 * optimistic action (`db/actions.ts`) with the same variables, and reports its `exitToast`.
 */

// MESSAGE

export const ActionMessage = defineMessageUnion({
	CompletedToggleReaction: { toast: Schema.NullOr(ToastRequest) },
	CompletedPinMessage: { toast: Schema.NullOr(ToastRequest) },
	CompletedUnpinMessage: { toast: Schema.NullOr(ToastRequest) },
	CompletedDeleteMessage: { toast: Schema.NullOr(ToastRequest) },
	CompletedGenerateThreadChannelId: { messageId: MessageId, threadChannelId: ChannelId },
	SucceededCreateThread: { threadChannelId: ChannelId },
	FailedCreateThread: { threadChannelId: ChannelId, toast: ToastRequest },
	CompletedCopyText: {},
	CompletedTrackEmojiUsage: {},
	CompletedGenerateThreadName: { threadChannelId: ChannelId, toast: Schema.NullOr(ToastRequest) },
})
export type ActionMessage = typeof ActionMessage.Type

const messageNotFound = notRetryable("Message not found", "This message may have been deleted.")

// COMMAND

/** `addReaction`: `toggleReactionAction` inserts or deletes the reaction, then `messageReaction.toggle`. */
export const ToggleReaction = Command.define("ToggleReaction", {
	args: { messageId: MessageId, channelId: ChannelId, emoji: Schema.String, userId: UserId },
	messages: [ActionMessage.CompletedToggleReaction],
	execute: (args) =>
		toastOfExit(runChatAction(toggleReactionAction, args), {
			handlers: { MessageNotFoundError: messageNotFound },
		}).pipe(Effect.map((toast) => ActionMessage.CompletedToggleReaction({ toast }))),
})

export const PinMessage = Command.define("PinMessage", {
	args: { messageId: MessageId, channelId: ChannelId, userId: UserId },
	messages: [ActionMessage.CompletedPinMessage],
	execute: (args) =>
		toastOfExit(runChatAction(pinMessageAction, args), {
			success: "Message pinned",
			handlers: { MessageNotFoundError: messageNotFound },
		}).pipe(Effect.map((toast) => ActionMessage.CompletedPinMessage({ toast }))),
})

export const UnpinMessage = Command.define("UnpinMessage", {
	args: { pinnedMessageId: PinnedMessageId },
	messages: [ActionMessage.CompletedUnpinMessage],
	execute: (args) =>
		toastOfExit(runChatAction(unpinMessageAction, args), {
			success: "Message unpinned",
			handlers: {
				PinnedMessageNotFoundError: notRetryable(
					"Pin not found",
					"This message may have already been unpinned.",
				),
			},
		}).pipe(Effect.map((toast) => ActionMessage.CompletedUnpinMessage({ toast }))),
})

export const DeleteMessage = Command.define("DeleteMessage", {
	args: { messageId: MessageId },
	messages: [ActionMessage.CompletedDeleteMessage],
	execute: (args) =>
		toastOfExit(runChatAction(deleteMessageAction, args), {
			handlers: {
				RateLimitExceededError: rateLimited("trying again"),
				MessageNotFoundError: notRetryable(
					"Message not found",
					"This message may have already been deleted.",
				),
			},
		}).pipe(Effect.map((toast) => ActionMessage.CompletedDeleteMessage({ toast }))),
})

/** `createThread` generates the thread id up front so the panel opens before the RPC answers. */
export const GenerateThreadChannelId = Command.define("GenerateThreadChannelId", {
	args: { messageId: MessageId },
	messages: [ActionMessage.CompletedGenerateThreadChannelId],
	execute: ({ messageId }) =>
		Effect.sync(() =>
			ActionMessage.CompletedGenerateThreadChannelId({
				messageId,
				threadChannelId: ChannelId.make(crypto.randomUUID()),
			}),
		),
})

export const CreateThread = Command.define("CreateThread", {
	args: {
		threadChannelId: ChannelId,
		messageId: MessageId,
		parentChannelId: ChannelId,
		organizationId: OrganizationId,
		currentUserId: UserId,
	},
	messages: [ActionMessage.SucceededCreateThread, ActionMessage.FailedCreateThread],
	execute: (args) =>
		toastOfExit(runChatAction(createThreadAction, args), {
			handlers: {
				MessageNotFoundError: notRetryable("Message not found", "The message no longer exists"),
				NestedThreadError: notRetryable(
					"Cannot create thread",
					"Threads cannot be created within threads",
				),
			},
		}).pipe(
			Effect.map((toast) =>
				toast === null
					? ActionMessage.SucceededCreateThread({ threadChannelId: args.threadChannelId })
					: ActionMessage.FailedCreateThread({ threadChannelId: args.threadChannelId, toast }),
			),
		),
})

/** `navigator.clipboard.writeText`; legacy toasts without waiting for it. */
export const CopyText = Command.define("CopyText", {
	args: { text: Schema.String },
	messages: [ActionMessage.CompletedCopyText],
	execute: ({ text }) =>
		Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
			Effect.ignore,
			Effect.as(ActionMessage.CompletedCopyText()),
		),
})

/** `useEmojiStats().trackEmojiUsage`: counts the emoji in the persisted usage atom. */
export const TrackEmojiUsage = Command.define("TrackEmojiUsage", {
	args: { emoji: Schema.String },
	messages: [ActionMessage.CompletedTrackEmojiUsage],
	execute: ({ emoji }) =>
		Effect.sync(() => trackEmojiUsage(emojiUsageAtom, emoji)).pipe(
			Effect.as(ActionMessage.CompletedTrackEmojiUsage()),
		),
})

/** The thread panel's "Generate thread name" (`channel.generateName`). */
export const GenerateThreadName = Command.define("GenerateThreadName", {
	args: { channelId: ChannelId },
	messages: [ActionMessage.CompletedGenerateThreadName],
	execute: ({ channelId }) =>
		toastOfExit(
			Effect.gen(function* () {
				const client = yield* HazelRpc
				return yield* client("channel.generateName", { channelId })
			}),
			{ handlers: generateNameHandlers },
		).pipe(
			Effect.map((toast) => ActionMessage.CompletedGenerateThreadName({ threadChannelId: channelId, toast })),
		),
})

const retryable = (title: string, description: string) => () => ({ title, description, isRetryable: true })

/** `handleGenerateName`'s `onErrorTag` and `onCommonErrorTag` overrides. */
const generateNameHandlers = {
	ChannelNotFoundError: notRetryable("Thread not found", "This thread may have been deleted."),
	MessageNotFoundError: notRetryable(
		"Original message not found",
		"The message that started this thread could not be found.",
	),
	ThreadChannelNotFoundError: notRetryable("Thread not found", "This thread may have been deleted."),
	OriginalMessageNotFoundError: notRetryable("Message not found", "The original message could not be found."),
	ThreadContextQueryError: retryable("Database error", "Failed to load thread data. Please try again."),
	AIProviderUnavailableError: retryable(
		"AI service unavailable",
		"The AI service is temporarily unavailable. Please try again later.",
	),
	AIRateLimitError: retryable("AI rate limited", "Please wait a moment and try again."),
	AIResponseParseError: retryable(
		"AI response error",
		"The AI returned an unexpected response. Please try again.",
	),
	ThreadNameUpdateError: retryable("Update failed", "Failed to save the thread name. Please try again."),
	WorkflowServiceUnavailableError: retryable("Service temporarily unavailable", "Please try again later."),
}
