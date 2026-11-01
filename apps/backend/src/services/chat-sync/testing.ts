/** For tests: chat-sync providers whose every client records its calls instead of sending. */
import type { ExternalMessageId, ExternalThreadId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import { ChatSyncProviders, chatSyncProvidersOf } from "./chat-sync-providers"
import { type ChatSyncClient, ChatSyncProviderApiError, type ChatSyncProviderId } from "./provider"
import { chatSyncProviders } from "./providers"

/** One provider call a recording client saw. */
export interface ChatSyncCall {
	readonly op: string
	readonly externalChannelId?: string
	readonly externalMessageId?: string
	readonly content?: string
	readonly emoji?: string
}

/**
 * Every provider's client records each call and answers with fresh external ids. Set `fail` to
 * make calls fail (with that status) until it is cleared.
 */
export const makeRecordingChatSyncProviders = (options?: { readonly attachmentPublicUrlBase?: string }) => {
	const calls: Array<ChatSyncCall> = []
	/** External channels a new link prepared (kept apart: every link makes one). */
	const prepared: Array<string> = []
	const control: { fail: number | undefined } = { fail: undefined }
	let counter = 0
	const nextId = () => `${900000000000000000 + ++counter}`

	const recordingClient = (provider: string): ChatSyncClient => {
		const record = <A>(call: ChatSyncCall, value: () => A) =>
			Effect.suspend(() => {
				if (control.fail !== undefined) {
					return Effect.fail(
						new ChatSyncProviderApiError({
							provider,
							message: `${call.op} failed`,
							status: control.fail,
						}),
					)
				}
				calls.push(call)
				return Effect.succeed(value())
			})
		return {
			prepareLink: (link) => Effect.sync(() => void prepared.push(link.externalChannelId)),
			postMessage: ({ link }, message) =>
				record(
					{
						op: message.attachments.length > 0 ? "createMessageWithAttachments" : "createMessage",
						externalChannelId: link.externalChannelId,
						content: message.content,
					},
					() => nextId() as ExternalMessageId,
				),
			updateMessage: ({ link }, message) =>
				record(
					{
						op: "updateMessage",
						externalChannelId: link.externalChannelId,
						externalMessageId: message.externalMessageId,
						content: message.content,
					},
					() => undefined,
				),
			deleteMessage: ({ link }, message) =>
				record(
					{
						op: "deleteMessage",
						externalChannelId: link.externalChannelId,
						externalMessageId: message.externalMessageId,
					},
					() => undefined,
				),
			addReaction: ({ link }, reaction) =>
				record(
					{
						op: "addReaction",
						externalChannelId: link.externalChannelId,
						externalMessageId: reaction.externalMessageId,
						emoji: reaction.emoji,
					},
					() => undefined,
				),
			removeReaction: ({ link }, reaction) =>
				record(
					{
						op: "removeReaction",
						externalChannelId: link.externalChannelId,
						externalMessageId: reaction.externalMessageId,
						emoji: reaction.emoji,
					},
					() => undefined,
				),
			// As a real client answers: the thread's link key (Discord's is the message's id too).
			createThread: ({ link }, thread) =>
				record(
					{
						op: "createThread",
						externalChannelId: link.externalChannelId,
						externalMessageId: thread.externalMessageId,
						content: thread.name,
					},
					() =>
						chatSyncProviders[link.provider as ChatSyncProviderId].threadChannelId(
							link.externalChannelId,
							thread.externalMessageId,
						) as ExternalThreadId,
				),
		}
	}

	const layer = Layer.succeed(
		ChatSyncProviders,
		chatSyncProvidersOf(
			Object.fromEntries(Object.keys(chatSyncProviders).map((id) => [id, recordingClient(id)])),
			Option.fromNullishOr(options?.attachmentPublicUrlBase),
		),
	)

	return { layer, calls, prepared, control }
}
