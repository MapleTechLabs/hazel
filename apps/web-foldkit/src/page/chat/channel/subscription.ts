import { ChannelId, MessageId, OrganizationId } from "@hazel/schema"
import { Option, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import * as FilesSubscriptions from "../files/subscriptions"
import { channelStream, messagesStream, parentChannelStream, reactionsStream } from "../data"
import {
	attachmentsStream,
	botsStream,
	customEmojisStream,
	discordSyncedStream,
	membersStream,
	presenceStream,
	replyTargetsStream,
	threadChannelsStream,
	threadMessagesStream,
	typingStream,
	usersStream,
} from "../lookup-data"
import type { PageSubscriptionInput } from "../../contract"
import { Message, type Model } from "./page"

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
		{ channelId: ChannelId, limit: Schema.Number },
		{
			modelToDependencies: ({ model }) => ({ channelId: model.channelId, limit: model.limit }),
			dependenciesToStream: ({ channelId, limit }) =>
				messagesStream(channelId, limit, (messages) => Message.UpdatedMessages({ messages })),
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

const files = Subscription.lift(FilesSubscriptions.subscriptions)<Input, Message>({
	read: ({ model }) => Option.fromNullishOr(model.files),
	toParentMessage: (message) => Message.GotFilesMessage({ message }),
})

export const subscriptions = Subscription.aggregate(chat, files)
