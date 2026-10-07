import { ChannelId, MessageId, OrganizationId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as FilesSubscriptions from "../files/subscriptions"
import {
	channelStream,
	messageChangesStream,
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
import { uploadStream } from "../../../composer/upload"
import type { HazelRpc } from "../../../rpc"
import { globalTypingStream, leftWindowStream } from "../../../composer/window-events"
import { isMemberOf, Message, type Model } from "./page"

type Input = PageSubscriptionInput<Model>

/** The channel page's live queries; split from `page.ts` so the update loop has no collection imports. */

const byChannel = { channelId: ChannelId }
const channelOf = ({ model }: Input) => ({ channelId: model.channelId })

const chat = Subscription.make<Input, Message>()((entry) => ({
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
			modelToDependencies: ({ model }) => ({ channelId: model.channelId, limit: model.limit, offset: model.offset }),
			dependenciesToStream: ({ channelId, limit, offset }) =>
				messageChangesStream(channelId, limit, offset, ({ order, upserts }) =>
					Message.ChangedMessages({ order, upserts }),
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
		{ replyIds: Schema.Array(MessageId) },
		{
			modelToDependencies: ({ model }) => ({ replyIds: model.replyIds }),
			dependenciesToStream: ({ replyIds }) =>
				replyTargetsStream(replyIds, (targets) => Message.UpdatedReplyTargets({ targets })),
		},
	),
	chatThreadPanel: entry(
		{ threadChannelId: Schema.NullOr(ChannelId) },
		{
			modelToDependencies: ({ model }) => ({
				threadChannelId: model.overlays.thread?.threadChannelId ?? null,
			}),
			dependenciesToStream: ({ threadChannelId }) =>
				threadChannelId === null
					? Stream.make(Message.UpdatedThreadPanelMessages({ messages: [] }))
					: threadPanelStream(threadChannelId, (messages) =>
							Message.UpdatedThreadPanelMessages({ messages }),
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
		const draft = which === "channel" ? model.draft : model.threadDraft
		return {
			upload: draft?.currentUpload ?? null,
			channelId: draft?.channelId ?? null,
			organizationId: model.channel?.organizationId ?? null,
		}
	},
	dependenciesToStream: ({ upload, channelId, organizationId }: UploadDependencies) =>
		upload === null || channelId === null || organizationId === null
			? Stream.empty
			: uploadStream({ fileId: upload.fileId, file: upload.file, channelId, organizationId }).pipe(
					Stream.map((event) => {
						const message = Draft.Message.GotUploadEvent({ event })
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

/** The write path's streams: composer data, uploads, global typing and window blur. */
const write = Subscription.make<Input, Message, HazelRpc>()((entry) => ({
	composerMembers: entry(byChannel, {
		modelToDependencies: channelOf,
		dependenciesToStream: ({ channelId }) =>
			mentionMembersStream(channelId, (members) =>
				toChannelComposer(Composer.Message.UpdatedMentionMembers({ members })),
			),
	}),
	composerBots: entry(
		{ organizationId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.currentUser?.organizationId ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: mentionableBotsStream(organizationId, (bots) =>
							toChannelComposer(Composer.Message.UpdatedMentionableBots({ bots })),
						),
		},
	),
	composerCommands: entry(
		{ organizationId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: ({ shared }) => ({ organizationId: shared.currentUser?.organizationId ?? null }),
			dependenciesToStream: ({ organizationId }) =>
				organizationId === null
					? Stream.empty
					: botCommandsStream(organizationId, (commands) =>
							toChannelComposer(Composer.Message.UpdatedBotCommands({ commands })),
						),
		},
	),
	threadMembership: entry(
		{ threadChannelId: Schema.NullOr(ChannelId), userId: Schema.NullOr(Schema.String) },
		{
			modelToDependencies: ({ model }) => ({
				threadChannelId: model.overlays.thread?.threadChannelId ?? null,
				userId: model.currentUserId,
			}),
			dependenciesToStream: ({ threadChannelId, userId }) =>
				threadChannelId === null || userId === null
					? Stream.empty
					: ownMembershipStream(threadChannelId, userId, (memberId) => Message.UpdatedThreadMember({ memberId })),
		},
	),
	channelUpload: entry(UploadDependencies.fields, uploadEntry("channel")),
	threadUpload: entry(UploadDependencies.fields, uploadEntry("thread")),
	globalTyping: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model }) => ({ isActive: model.tab === "messages" && isMemberOf(model) !== false }),
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
	read: ({ model }) => Option.fromNullishOr(model.files),
	toParentMessage: (message) => Message.GotFilesMessage({ message }),
})

export const subscriptions = Subscription.aggregate(chat, write, files)
