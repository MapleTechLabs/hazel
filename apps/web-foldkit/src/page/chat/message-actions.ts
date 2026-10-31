import { ChannelId, MessageId, OrganizationId, PinnedMessageId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command } from "foldkit"
import { defineMessageUnion } from "foldkit/message"
import {
	createThreadAction,
	joinChannelAction,
	pinMessageAction,
	toggleReactionAction,
	unpinMessageAction,
} from "~/db/actions"
import { CommonReason } from "~/lib/error-messages"
import { HazelRpc } from "../../rpc"
import { catchCommon } from "../../data/actions"

/**
 * The message actions of `ChatProvider` and `useMessageActions`: each Command runs the same
 * optimistic action (`db/actions.ts`) with the same variables and reports a typed reason on failure
 * (`docs/foldkit-decisions/s6-errors.md`); `write.ts` turns it into copy.
 */

// MODEL

/** What can go wrong creating a thread, beyond the shared reasons. */
export const CreateThreadFailure = Schema.Union([
	Schema.Literals(["MessageNotFound", "NestedThread", "InvalidRequest"]),
	CommonReason,
])
export type CreateThreadFailure = typeof CreateThreadFailure.Type

/** What can go wrong naming a thread with AI, beyond the shared reasons. */
export const GenerateThreadNameFailure = Schema.Union([
	Schema.Literals([
		"ThreadNotFound",
		"NotAThread",
		"OriginalMessageNotFound",
		"ThreadContextUnavailable",
		"AIUnavailable",
		"AIRateLimited",
		"AIResponseInvalid",
		"SaveFailed",
	]),
	CommonReason,
])
export type GenerateThreadNameFailure = typeof GenerateThreadNameFailure.Type

/** `navigator.clipboard.writeText` refused (no permission, no focus, insecure context). */
export const CopyTextFailure = Schema.Literals(["ClipboardDenied"])
export type CopyTextFailure = typeof CopyTextFailure.Type

/** What a copy was of: the success toast names it. */
export const CopiedContent = Schema.Literals(["MessageText", "MessageId", "ImageUrl"])
export type CopiedContent = typeof CopiedContent.Type

/** What can go wrong joining a channel, beyond the shared reasons. */
export const JoinChannelFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type JoinChannelFailure = typeof JoinChannelFailure.Type

/** What can go wrong reacting to or pinning a message, beyond the shared reasons. */
export const MessageActionFailure = Schema.Union([Schema.Literals(["MessageNotFound"]), CommonReason])
export type MessageActionFailure = typeof MessageActionFailure.Type

/** What can go wrong pressing a button on a bot's message, beyond the shared reasons. */
export const PressEmbedActionFailure = Schema.Union([
	Schema.Literals(["MessageNotFound", "ActionUnavailable"]),
	CommonReason,
])
export type PressEmbedActionFailure = typeof PressEmbedActionFailure.Type

/** What can go wrong unpinning, beyond the shared reasons. */
export const UnpinMessageFailure = Schema.Union([Schema.Literals(["PinNotFound"]), CommonReason])
export type UnpinMessageFailure = typeof UnpinMessageFailure.Type

// MESSAGE

export const ActionMessage = defineMessageUnion({
	SucceededToggleReaction: {},
	FailedToggleReaction: { reason: MessageActionFailure },
	SucceededPinMessage: {},
	FailedPinMessage: { reason: MessageActionFailure },
	SucceededUnpinMessage: {},
	FailedUnpinMessage: { reason: UnpinMessageFailure },
	CompletedGenerateThreadChannelId: { messageId: MessageId, threadChannelId: ChannelId },
	SucceededCreateThread: { threadChannelId: ChannelId },
	FailedCreateThread: { threadChannelId: ChannelId, reason: CreateThreadFailure },
	SucceededCopyText: { content: CopiedContent },
	FailedCopyText: { reason: CopyTextFailure },
	CompletedDownloadImage: {},
	CompletedOpenUrl: {},
	SucceededGenerateThreadName: { threadChannelId: ChannelId },
	FailedGenerateThreadName: { threadChannelId: ChannelId, reason: GenerateThreadNameFailure },
	SucceededJoinChannel: {},
	FailedJoinChannel: { reason: JoinChannelFailure },
	SucceededPressEmbedAction: {},
	FailedPressEmbedAction: { reason: PressEmbedActionFailure },
})
export type ActionMessage = typeof ActionMessage.Type
/** `ActionMessage` under the Submodel name, so a parent's Got wrapper imports it as `Message`. */
export { ActionMessage as Message }

// COMMAND

/** `addReaction`: `toggleReactionAction` inserts or deletes the reaction, then `messageReaction.toggle`. */
export const ToggleReaction = Command.define("ToggleReaction", {
	args: { messageId: MessageId, channelId: ChannelId, emoji: Schema.String, userId: UserId },
	messages: [ActionMessage.SucceededToggleReaction, ActionMessage.FailedToggleReaction],
	execute: (args) =>
		toggleReactionAction(args).pipe(
			Effect.as(ActionMessage.SucceededToggleReaction()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(ActionMessage.FailedToggleReaction({ reason: "MessageNotFound" })),
			}),
			catchCommon((reason) => ActionMessage.FailedToggleReaction({ reason })),
		),
})

/** A button on a bot's message (`MessageEmbed.actions`): the bot hears about it and answers itself. */
export const PressEmbedAction = Command.define("PressEmbedAction", {
	args: { channelId: ChannelId, messageId: MessageId, actionId: Schema.String },
	messages: [ActionMessage.SucceededPressEmbedAction, ActionMessage.FailedPressEmbedAction],
	execute: (args) =>
		HazelRpc.use((client) => client("message.interact", args)).pipe(
			Effect.as(ActionMessage.SucceededPressEmbedAction()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(ActionMessage.FailedPressEmbedAction({ reason: "MessageNotFound" })),
				MessageActionUnavailableError: () =>
					Effect.succeed(ActionMessage.FailedPressEmbedAction({ reason: "ActionUnavailable" })),
			}),
			catchCommon((reason) => ActionMessage.FailedPressEmbedAction({ reason })),
		),
})

export const PinMessage = Command.define("PinMessage", {
	args: { messageId: MessageId, channelId: ChannelId, userId: UserId },
	messages: [ActionMessage.SucceededPinMessage, ActionMessage.FailedPinMessage],
	execute: (args) =>
		pinMessageAction(args).pipe(
			Effect.as(ActionMessage.SucceededPinMessage()),
			Effect.catchTags({
				MessageNotFoundError: () =>
					Effect.succeed(ActionMessage.FailedPinMessage({ reason: "MessageNotFound" })),
			}),
			catchCommon((reason) => ActionMessage.FailedPinMessage({ reason })),
		),
})

export const UnpinMessage = Command.define("UnpinMessage", {
	args: { pinnedMessageId: PinnedMessageId },
	messages: [ActionMessage.SucceededUnpinMessage, ActionMessage.FailedUnpinMessage],
	execute: (args) =>
		unpinMessageAction(args).pipe(
			Effect.as(ActionMessage.SucceededUnpinMessage()),
			Effect.catchTags({
				PinnedMessageNotFoundError: () =>
					Effect.succeed(ActionMessage.FailedUnpinMessage({ reason: "PinNotFound" })),
			}),
			catchCommon((reason) => ActionMessage.FailedUnpinMessage({ reason })),
		),
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
	execute: (args) => {
		const failed = (reason: CreateThreadFailure) =>
			ActionMessage.FailedCreateThread({ threadChannelId: args.threadChannelId, reason })
		return createThreadAction(args).pipe(
			Effect.as(ActionMessage.SucceededCreateThread({ threadChannelId: args.threadChannelId })),
			Effect.catchTags({
				MessageNotFoundError: () => Effect.succeed(failed("MessageNotFound")),
				NestedThreadError: () => Effect.succeed(failed("NestedThread")),
				InvalidChannelRequestError: () => Effect.succeed(failed("InvalidRequest")),
			}),
			catchCommon(failed),
		)
	},
})

class ClipboardError extends Schema.TaggedError<ClipboardError>()("ClipboardError", {
	cause: Schema.Defect(),
}) {}

/** `navigator.clipboard.writeText`; the toast waits for the browser's answer. */
export const CopyText = Command.define("CopyText", {
	args: { text: Schema.String, content: CopiedContent },
	messages: [ActionMessage.SucceededCopyText, ActionMessage.FailedCopyText],
	execute: ({ text, content }) =>
		Effect.tryPromise({
			try: () => navigator.clipboard.writeText(text),
			catch: (cause) => new ClipboardError({ cause }),
		}).pipe(
			Effect.as(ActionMessage.SucceededCopyText({ content })),
			Effect.catchTags({
				ClipboardError: () =>
					Effect.succeed(ActionMessage.FailedCopyText({ reason: "ClipboardDenied" })),
			}),
		),
})

/** The image viewer's `handleDownload`: a temporary `<a download target="_blank">` clicked and removed. */
export const DownloadImage = Command.define("DownloadImage", {
	args: { url: Schema.String, fileName: Schema.String },
	messages: [ActionMessage.CompletedDownloadImage],
	execute: ({ url, fileName }) =>
		Effect.sync(() => {
			const link = document.createElement("a")
			link.href = url
			link.download = fileName
			link.target = "_blank"
			document.body.appendChild(link)
			link.click()
			document.body.removeChild(link)
			return ActionMessage.CompletedDownloadImage()
		}),
})

/** The image viewer's `handleOpenInBrowser`: `window.open(url, "_blank")`. */
export const OpenUrl = Command.define("OpenUrl", {
	args: { url: Schema.String },
	messages: [ActionMessage.CompletedOpenUrl],
	execute: ({ url }) =>
		Effect.sync(() => {
			window.open(url, "_blank")
			return ActionMessage.CompletedOpenUrl()
		}),
})

/** The thread panel's "Generate thread name" (`channel.generateName`); the name arrives through sync. */
export const GenerateThreadName = Command.define("GenerateThreadName", {
	args: { channelId: ChannelId },
	messages: [ActionMessage.SucceededGenerateThreadName, ActionMessage.FailedGenerateThreadName],
	execute: ({ channelId }) => {
		const failed = (reason: GenerateThreadNameFailure) =>
			ActionMessage.FailedGenerateThreadName({ threadChannelId: channelId, reason })
		const fail = (reason: GenerateThreadNameFailure) => () => Effect.succeed(failed(reason))
		return HazelRpc.use((rpc) => rpc("channel.generateName", { channelId })).pipe(
			Effect.as(ActionMessage.SucceededGenerateThreadName({ threadChannelId: channelId })),
			Effect.catchTags({
				ChannelNotFoundError: fail("ThreadNotFound"),
				ThreadChannelNotFoundError: fail("ThreadNotFound"),
				InvalidChannelRequestError: fail("NotAThread"),
				OriginalMessageNotFoundError: fail("OriginalMessageNotFound"),
				ThreadContextQueryError: fail("ThreadContextUnavailable"),
				AIProviderUnavailableError: fail("AIUnavailable"),
				AIRateLimitError: fail("AIRateLimited"),
				AIResponseParseError: fail("AIResponseInvalid"),
				ThreadNameUpdateError: fail("SaveFailed"),
			}),
			catchCommon(failed),
		)
	},
})

/** `ChannelJoinBanner`'s "Join #channel": `joinChannelAction`, as the join modal runs it. */
export const JoinChannel = Command.define("JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	messages: [ActionMessage.SucceededJoinChannel, ActionMessage.FailedJoinChannel],
	execute: (args) =>
		joinChannelAction(args).pipe(
			Effect.as(ActionMessage.SucceededJoinChannel()),
			Effect.catchTags({
				ChannelNotFoundError: () =>
					Effect.succeed(ActionMessage.FailedJoinChannel({ reason: "NotFound" })),
			}),
			catchCommon((reason) => ActionMessage.FailedJoinChannel({ reason })),
		),
})
