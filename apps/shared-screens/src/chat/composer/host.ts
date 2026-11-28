// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the composer asks of the app that mounts it: the channel page's requests (reply, edit, focus,
 * typing from outside the field), the files it holds and uploads, the bot command endpoint, and the
 * drafts kept per channel. The web's implementations are `web-foldkit/src/root/composer.ts`.
 */
import { AttachmentId, BotId, ChannelId, MessageId, OrganizationId } from "@hazel/schema"
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect"
import { HeldFile, Mode } from "./model"

/** What the page around the composer asks of it. */
export const ComposerRequest = Schema.Union([
	Schema.TaggedStruct("Reply", { messageId: MessageId, author: Schema.String, text: Schema.String }),
	Schema.TaggedStruct("Edit", { messageId: MessageId, content: Schema.String }),
	Schema.TaggedStruct("Focus", {}),
	/** A key typed, or text pasted, outside any field: it goes into the draft. */
	Schema.TaggedStruct("InsertText", { text: Schema.String }),
	/** Files pasted outside any field, held by the host. */
	Schema.TaggedStruct("AddFiles", { files: Schema.Array(HeldFile) }),
	Schema.TaggedStruct("OpenEmojiPicker", {}),
	Schema.TaggedStruct("OpenGifPicker", {}),
	Schema.TaggedStruct("Attach", {}),
])
export type ComposerRequest = typeof ComposerRequest.Type

/** What the composer tells the page around it. */
export const ComposerNotice = Schema.Union([
	/** A message went out: the channel's list scrolls to its end. */
	Schema.TaggedStruct("Sent", { channelId: ChannelId }),
	/** Escape with nothing to cancel: the channel is marked read (Discord). */
	Schema.TaggedStruct("Escaped", { channelId: ChannelId }),
	/** Shift+Tab out of the field: the focus goes to the messages. */
	Schema.TaggedStruct("Left", { channelId: ChannelId }),
])
export type ComposerNotice = typeof ComposerNotice.Type

/** The thread panel's composer: its thread, and whether the thread exists yet. */
export const ThreadTarget = Schema.Struct({ threadChannelId: ChannelId, ready: Schema.Boolean })
export type ThreadTarget = typeof ThreadTarget.Type

export class ComposerHost extends Context.Service<
	ComposerHost,
	{
		readonly requests: (channelId: ChannelId) => Stream.Stream<ComposerRequest>
		readonly notify: (notice: ComposerNotice) => Effect.Effect<void>
		/** Whether files are being dragged over the page (the drop zone shows). */
		readonly dragging: Stream.Stream<boolean>
		/** The open thread panel's thread, null while none is open. */
		readonly thread: Stream.Stream<ThreadTarget | null>
	}
>()("hazel/composer/ComposerHost") {}

/** Why an upload failed, in today's words. */
export const UploadFailure = Schema.Literals(["TooLarge", "Unsupported", "Rejected", "Network", "Failed"])
export type UploadFailure = typeof UploadFailure.Type

export const UploadEvent = Schema.Union([
	Schema.TaggedStruct("Progressed", { progress: Schema.Finite }),
	Schema.TaggedStruct("Uploaded", { attachmentId: AttachmentId }),
	Schema.TaggedStruct("Failed", { reason: UploadFailure }),
])
export type UploadEvent = typeof UploadEvent.Type

/** The files the composer attaches; the host holds the bytes, the composer their ids. */
export class ComposerFiles extends Context.Service<
	ComposerFiles,
	{
		/** The platform's picker; a cancelled pick is no files. */
		readonly pick: Effect.Effect<ReadonlyArray<HeldFile>>
		/** The files of the composer's last `files` event (a drop or a paste on it). */
		readonly dropped: Effect.Effect<ReadonlyArray<HeldFile>>
		/** Uploads a held file to the channel: progress, then how it ended. */
		readonly upload: (args: {
			readonly localId: string
			readonly organizationId: OrganizationId
			readonly channelId: ChannelId
		}) => Stream.Stream<UploadEvent>
		/** The file left the draft (removed or sent): the host lets its bytes and preview go. */
		readonly release: (localId: string) => Effect.Effect<void>
	}
>()("hazel/composer/ComposerFiles") {}

export const BotCommandFailure = Schema.Literals([
	"BotNotFound",
	"BotNotInstalled",
	"CommandNotFound",
	"ExecutionFailed",
	"Unavailable",
])
export type BotCommandFailure = typeof BotCommandFailure.Type

/** `bot-commands.executeBotCommand`, over the app's HTTP API. */
export class BotCommands extends Context.Service<
	BotCommands,
	{
		readonly execute: (args: {
			readonly orgId: OrganizationId
			readonly botId: BotId
			readonly commandName: string
			readonly channelId: ChannelId
			readonly arguments: ReadonlyArray<{ readonly name: string; readonly value: string }>
		}) => Effect.Effect<void, BotCommandFailure>
	}
>()("hazel/composer/BotCommands") {}

/**
 * The requests of the screens around a composer (reply, edit, focus), by channel: one hub per app,
 * so a list asks the composer of its own channel and two composers never share one.
 */
export class ComposerRequests extends Context.Service<
	ComposerRequests,
	{
		readonly send: (channelId: ChannelId, request: ComposerRequest) => Effect.Effect<void>
		readonly of: (channelId: ChannelId) => Stream.Stream<ComposerRequest>
	}
>()("hazel/composer/ComposerRequests") {
	static readonly layer = Layer.effect(
		this,
		Effect.map(
			PubSub.unbounded<{ readonly channelId: ChannelId; readonly request: ComposerRequest }>(),
			(hub) => ({
				send: (channelId: ChannelId, request: ComposerRequest) =>
					Effect.asVoid(PubSub.publish(hub, { channelId, request })),
				of: (channelId: ChannelId) =>
					Stream.fromPubSub(hub).pipe(
						Stream.filter((entry) => entry.channelId === channelId),
						Stream.map((entry) => entry.request),
					),
			}),
		),
	)
}

/** What a channel's draft keeps while the user is elsewhere. */
export const SavedDraft = Schema.Struct({ text: Schema.String, mode: Mode })
export type SavedDraft = typeof SavedDraft.Type

/** Each channel's unsent draft, for this run of the app. */
export class Drafts extends Context.Service<
	Drafts,
	{
		readonly read: (channelId: ChannelId) => SavedDraft | undefined
		readonly write: (channelId: ChannelId, draft: SavedDraft) => void
	}
>()("hazel/composer/Drafts") {
	static readonly layer = Layer.sync(this, () => makeDrafts())
}

/** An empty store; an empty plain draft is forgotten. */
export const makeDrafts = (): Drafts["Service"] => {
	const drafts = new Map<ChannelId, SavedDraft>()
	return {
		read: (channelId) => drafts.get(channelId),
		write: (channelId, draft) => {
			if (draft.text === "" && draft.mode._tag === "Plain") drafts.delete(channelId)
			else drafts.set(channelId, draft)
		},
	}
}
