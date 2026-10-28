import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, PubSub, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as Live from "../../../chat/live-state"
import * as FilesSubscriptions from "../files/subscriptions"
import {
	channelStream,
	messageChangesStream,
	messageHistoryStream,
	parentChannelStream,
	reactionsStream,
	threadPanelStream,
} from "../data"
import {
	attachmentsStream,
	botsStream,
	customEmojisStream,
	discordSyncedStream,
	membersStream,
	pinnedStream,
	presenceStream,
	replyTargetsStream,
	threadChannelsStream,
	threadMessagesStream,
	typingStream,
	usersStream,
} from "../lookup-data"
import type { PageSubscriptionInput } from "../../contract"
import * as Composer from "../../../composer/composer"
import {
	botCommandsStream,
	mentionableBotsStream,
	mentionMembersStream,
	ownMembershipStream,
} from "../../../composer/data"
import * as Draft from "../../../composer/draft"
import * as Typing from "../../../composer/typing"
import { uploadStream } from "../../../composer/upload"
import { MessageWindows } from "../../../data/message-windows"
import type { HazelApiClient, HazelRpc } from "../../../rpc"
import { globalTypingStream, leftWindowStream } from "../../../composer/window-events"
import { isMemberOf, Message, type Model } from "./page"

type Input = PageSubscriptionInput<Model>

/** The channel page's live queries; split from `page.ts` so the update loop has no collection imports. */

const byChannel = { channelId: ChannelId }
const channelOf = ({ model }: Input) => ({ channelId: model.channelId })

const chat = Subscription.make<Input, Message, MessageWindows>()((entry) => ({
	chatChannel: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			channelStream(channelId, (channel) => Message.UpdatedChannel({ channel })),
	}),
	chatParentChannel: entry(
		{ parentChannelId: Schema.NullOr(ChannelId) },
		{
			modelToDependencies: ({ model }) => ({
				parentChannelId: model.channel?.type === "thread" ? model.channel.parentChannelId : null,
			}),
			dependenciesToStream: ({ parentChannelId }) =>
				parentChannelId === null
					? Stream.make(Message.UpdatedParentChannel({ channel: null }))
					: parentChannelStream(parentChannelId, (channel) =>
							Message.UpdatedParentChannel({ channel }),
						),
		},
	),
	chatMessages: entry(
		{ channelId: ChannelId, limit: Schema.Number, offset: Schema.Number },
		{
			modelToDependencies: ({ model }) => ({
				channelId: model.channelId,
				limit: model.limit,
				offset: model.offset,
			}),
			// One live query per channel; paging moves its window instead of rebuilding it.
			keepAliveEquivalence: (previous, next) => previous.channelId === next.channelId,
			dependenciesToStream: ({ channelId, limit, offset }, readDependencies) =>
				messageChangesStream(channelId, { limit, offset }, readDependencies, ({ order, upserts }) =>
					Message.ChangedMessages({ order, upserts }),
				),
		},
	),
	// Restarts on every page and publishes the window, so the messages query moves only when paged;
	// holds the history the window needs, so scrolling back pages older messages in.
	chatMessagesWindow: entry(
		{ channelId: ChannelId, limit: Schema.Number, offset: Schema.Number },
		{
			modelToDependencies: ({ model }) => ({
				channelId: model.channelId,
				limit: model.limit,
				offset: model.offset,
			}),
			dependenciesToStream: (change) =>
				Stream.merge(
					Stream.fromEffect(
						Effect.gen(function* () {
							yield* PubSub.publish(yield* MessageWindows, change)
						}),
					).pipe(Stream.drain),
					messageHistoryStream(change.channelId, change),
				),
		},
	),
	// One live socket per streaming AI reply. The stream stays up while any reply is live and
	// connects or closes replies by id, so the others keep theirs.
	chatLiveReplies: entry(
		{ replies: Schema.Array(Live.LiveReply) },
		{
			modelToDependencies: ({ model }) => ({ replies: model.liveReplies }),
			keepAliveEquivalence: (previous, next) =>
				(previous.replies.length === 0) === (next.replies.length === 0),
			dependenciesToStream: ({ replies }, readDependencies) =>
				replies.length === 0
					? Stream.empty
					: Live.liveRepliesStream(() => readDependencies().replies).pipe(
							Stream.map((message) => Message.GotLiveMessage({ message })),
						),
		},
	),
	chatReactions: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			reactionsStream(channelId, (reactions) => Message.UpdatedReactions({ reactions })),
	}),
	chatUsers: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () => usersStream((users) => Message.UpdatedUsers({ users })),
		},
	),
	chatPresence: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () => presenceStream((presence) => Message.UpdatedPresence({ presence })),
		},
	),
	chatBots: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () => botsStream((bots) => Message.UpdatedBots({ bots })),
		},
	),
	chatCustomEmojis: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ model }) => ({ organizationId: model.channel?.organizationId ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: customEmojisStream(organizationId, (customEmojis) =>
							Message.UpdatedCustomEmojis({ customEmojis }),
						),
		},
	),
	chatAttachments: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			attachmentsStream(channelId, (attachments) => Message.UpdatedAttachments({ attachments })),
	}),
	chatDiscordSynced: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			discordSyncedStream(channelId, (messageIds) => Message.UpdatedDiscordSynced({ messageIds })),
	}),
	chatThreadChannels: entry(
		{ threadIds: Schema.Array(ChannelId) },
		{
			modelToDependencies: ({ model }) => ({ threadIds: model.threadIds }),
			dependenciesToStream: ({ threadIds }) =>
				threadChannelsStream(threadIds, (channels) => Message.UpdatedThreadChannels({ channels })),
		},
	),
	chatThreadMessages: entry(
		{ threadIds: Schema.Array(ChannelId) },
		{
			modelToDependencies: ({ model }) => ({ threadIds: model.threadIds }),
			dependenciesToStream: ({ threadIds }) =>
				threadMessagesStream(threadIds, (messages) => Message.UpdatedThreadMessages({ messages })),
		},
	),
	chatReplyTargets: entry(
		{ channelId: ChannelId, replyIds: Schema.Array(MessageId) },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId, replyIds: model.replyIds }),
			dependenciesToStream: ({ channelId, replyIds }) =>
				replyTargetsStream(channelId, replyIds, (targets) =>
					Message.UpdatedReplyTargets({ targets }),
				),
		},
	),
	chatThreadPanel: entry(
		{ threadChannelId: Schema.NullOr(ChannelId) },
		{
			// Not while `channel.createThread` runs: the thread's object would refuse the socket.
			modelToDependencies: ({ model }) => ({
				threadChannelId:
					model.threadPanel?.creation === "Created" ? model.threadPanel.threadChannelId : null,
			}),
			dependenciesToStream: ({ threadChannelId }) =>
				threadChannelId === null
					? Stream.empty
					: threadPanelStream(threadChannelId, (messages) =>
							Message.UpdatedThreadPanelMessages({ threadChannelId, messages }),
						),
		},
	),
	chatPinned: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			pinnedStream(channelId, (pins) => Message.UpdatedPinned({ pins })),
	}),
	chatMembers: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			membersStream(channelId, (members) => Message.UpdatedMembers({ members })),
	}),
	chatTyping: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			typingStream(channelId, (typing) => Message.UpdatedTyping({ typing })),
	}),
	// `useTypingIndicators`' one-second clock, only while someone has typed.
	chatTypingClock: entry(
		{ isTyping: Schema.Boolean },
		{
			modelToDependencies: ({ model }) => ({ isTyping: model.typing.length > 0 }),
			dependenciesToStream: ({ isTyping }) =>
				isTyping
					? Stream.concat(Stream.succeed(undefined), Stream.tick("1 second")).pipe(
							Stream.map(() => Message.TickedTypingClock({ nowMs: Date.now() })),
						)
					: Stream.empty,
		},
	),
}))

const toChannelComposer = (message: Composer.Message) =>
	Message.GotDraftMessage({ message: Draft.Message.GotComposerMessage({ message }) })

const uploadEntry = (which: "channel" | "thread") => ({
	modelToDependencies: ({ model }: Input) => {
		const draft = which === "channel" ? model.draft : (model.threadPanel?.draft ?? null)
		return {
			upload: draft === null ? null : Draft.currentUploadOf(draft),
			channelId: draft?.channelId ?? null,
			organizationId: model.channel?.organizationId ?? null,
		}
	},
	dependenciesToStream: ({ upload, channelId, organizationId }: UploadDependencies) =>
		upload === null || channelId === null || organizationId === null
			? Stream.empty
			: uploadStream({ fileId: upload.fileId, file: upload.file, channelId, organizationId }).pipe(
					Stream.map((event) => {
						const message = Draft.Message.ReceivedUploadEvent({ event })
						return which === "channel"
							? Message.GotDraftMessage({ message })
							: Message.GotThreadDraftMessage({ message })
					}),
				),
})

const UploadDependencies = Schema.Struct({
	upload: Schema.NullOr(Draft.CurrentUpload),
	channelId: Schema.NullOr(ChannelId),
	organizationId: Schema.NullOr(OrganizationId),
})
type UploadDependencies = typeof UploadDependencies.Type

export const TypingCleanup = Schema.Struct({
	channelId: ChannelId,
	indicators: Schema.Array(Typing.Indicator),
})
export type TypingCleanup = typeof TypingCleanup.Type
const isSameCleanup = Schema.toEquivalence(TypingCleanup)

/** The indicators the page's drafts hold (channel, and the open thread's). */
export const indicatorsOf = (model: Model): ReadonlyArray<Typing.Indicator> =>
	[model.draft.typing.indicator, model.threadPanel?.draft.typing.indicator ?? null].filter(
		(indicator): indicator is Typing.Indicator => indicator !== null,
	)

/**
 * `useTyping`'s unmount cleanup for a page that is left while typing. A restart inside the page is a
 * stop that already deleted; once the page is gone (or is another channel's) the latest dependencies
 * fall back to the stream's own, or name another channel, and the indicators are deleted.
 */
export const typingCleanupStream = <R>(
	own: TypingCleanup,
	readLatest: () => TypingCleanup,
	deleteIndicator: (indicator: Typing.Indicator) => Effect.Effect<void, never, R>,
): Stream.Stream<never, never, R> =>
	own.indicators.length === 0
		? Stream.empty
		: Stream.fromEffect(
				Effect.never.pipe(
					Effect.ensuring(
						Effect.suspend(() => {
							const latest = readLatest()
							const isPageLeft =
								latest.channelId !== own.channelId || isSameCleanup(latest, own)
							return isPageLeft
								? Effect.forEach(own.indicators, deleteIndicator, { discard: true })
								: Effect.void
						}),
					),
				),
			)

/** A dialog of the page holds the keyboard, so typed keys stay there (legacy checked the DOM for one). */
const hasOpenDialog = (model: Model) =>
	model.overlays.open._tag === "ImageViewer" ||
	model.overlays.open._tag === "ReactionPicker" ||
	model.overlays.open._tag === "ReactionModal" ||
	(model.overlays.open._tag === "Popover" && model.overlays.open.popover.isOpen) ||
	model.overlays.pinned.isOpen ||
	[model.draft, model.threadPanel?.draft ?? null].some(
		(draft) => draft !== null && (draft.emojiPicker.isOpen || draft.gifPicker.isOpen),
	)

/** The write path's streams: composer data, uploads, global typing and window blur. */
const write = Subscription.make<Input, Message, HazelRpc | HazelApiClient>()((entry) => ({
	composerMembers: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			mentionMembersStream(channelId, (members) =>
				toChannelComposer(Composer.Message.UpdatedMentionMembers({ members })),
			),
	}),
	composerBots: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.currentUser?.organizationId ?? null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: mentionableBotsStream(organizationId, (bots) =>
							toChannelComposer(Composer.Message.UpdatedMentionableBots({ bots })),
						),
		},
	),
	composerCommands: entry(
		{ organizationId: Schema.NullOr(OrganizationId) },
		{
			modelToDependencies: ({ shared }) => ({
				organizationId: shared.currentUser?.organizationId ?? null,
			}),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: botCommandsStream(organizationId, (commands) =>
							toChannelComposer(Composer.Message.UpdatedBotCommands({ commands })),
						),
		},
	),
	threadMembership: entry(
		{ threadChannelId: Schema.NullOr(ChannelId), userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: ({ model }) => ({
				threadChannelId: model.threadPanel?.threadChannelId ?? null,
				userId: model.currentUserId,
			}),
			dependenciesToStream: ({ threadChannelId, userId }) =>
				threadChannelId === null || userId === null
					? Stream.empty
					: ownMembershipStream(threadChannelId, userId, (memberId) =>
							Message.UpdatedThreadMember({ threadChannelId, memberId }),
						),
		},
	),
	typingCleanup: entry(TypingCleanup.fields, {
		modelToDependencies: ({ model }) => ({
			channelId: model.channelId,
			indicators: indicatorsOf(model),
		}),
		// Restarts on every change like the default; the variant only adds `readDependencies`.
		keepAliveEquivalence: isSameCleanup,
		dependenciesToStream: (own, readDependencies) =>
			typingCleanupStream(own, readDependencies, Typing.deleteIndicator),
	}),
	channelUpload: entry(UploadDependencies.fields, uploadEntry("channel")),
	threadUpload: entry(UploadDependencies.fields, uploadEntry("thread")),
	globalTyping: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model, shared }) => ({
				isActive:
					model.tab._tag === "Messages" &&
					isMemberOf(model) !== false &&
					!shared.isOverlayOpen &&
					!hasOpenDialog(model),
			}),
			dependenciesToStream: ({ isActive }) =>
				isActive ? globalTypingStream((key) => Message.PressedGlobalKey({ key })) : Stream.empty,
		},
	),
	leftWindow: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () => leftWindowStream(Message.LeftWindow()),
		},
	),
}))

const files = Subscription.lift(FilesSubscriptions.subscriptions)<Input, Message>({
	read: ({ model }) => (model.tab._tag === "Files" ? Option.some(model.tab.files) : Option.none()),
	toParentMessage: (message) => Message.GotFilesMessage({ message }),
})

export const subscriptions = Subscription.aggregate(chat, write, files)
