/**
 * For tests: a fake Discord guild. Each action (someone posts, replies, starts a thread, pins...)
 * emits the gateway dispatches Discord sends for it, whole payloads in Discord's order, system
 * notices included, and feeds them through the production router (`./gateway-router.ts`). The
 * handlers' own tests build only the fields the code reads; this sends what Discord sends, so a
 * payload the code forgot to look at (a message's `type`, a starter message's update) still
 * reaches it.
 *
 * The payload shapes follow Discord's gateway docs (https://discord.com/developers/docs/events/gateway-events).
 * `replay` takes recorded `{ t, d }` frames as they are, for sessions captured from a real guild.
 */
import { Effect } from "effect"
import { DISCORD_ROUTED_EVENTS, type DiscordRoutedEvent, makeDiscordGatewayRouter } from "./gateway-router"
import { makeDiscordThreadParents } from "./thread-parents"
import type { ChatSyncInbound } from "../../chat-sync-inbound"

/** Discord message types (https://discord.com/developers/docs/resources/message#message-object-message-types). */
export const DiscordMessageType = {
	Default: 0,
	RecipientAdd: 1,
	RecipientRemove: 2,
	Call: 3,
	ChannelNameChange: 4,
	ChannelIconChange: 5,
	ChannelPinnedMessage: 6,
	UserJoin: 7,
	GuildBoost: 8,
	GuildBoostTier1: 9,
	GuildBoostTier2: 10,
	GuildBoostTier3: 11,
	ChannelFollowAdd: 12,
	GuildDiscoveryDisqualified: 14,
	GuildDiscoveryRequalified: 15,
	GuildDiscoveryGracePeriodInitialWarning: 16,
	GuildDiscoveryGracePeriodFinalWarning: 17,
	ThreadCreated: 18,
	Reply: 19,
	ChatInputCommand: 20,
	ThreadStarterMessage: 21,
	GuildInviteReminder: 22,
	ContextMenuCommand: 23,
	AutoModerationAction: 24,
	RoleSubscriptionPurchase: 25,
	InteractionPremiumUpsell: 26,
	StageStart: 27,
	StageEnd: 28,
	StageSpeaker: 29,
	StageTopic: 31,
	GuildApplicationPremiumSubscription: 32,
	GuildIncidentAlertModeEnabled: 36,
	GuildIncidentAlertModeDisabled: 37,
	GuildIncidentReportRaid: 38,
	GuildIncidentReportFalseAlarm: 39,
	PurchaseNotification: 44,
	PollResult: 46,
} as const

export interface DiscordSimUser {
	readonly id: string
	readonly username: string
	readonly global_name: string | null
	readonly avatar: string | null
	readonly discriminator: "0"
	readonly bot?: boolean
}

/** One gateway dispatch: its event name (`t`) and payload (`d`). */
export interface DiscordFrame {
	readonly t: string
	readonly d: Record<string, unknown>
}

interface SimMessage {
	readonly id: string
	readonly channel_id: string
	readonly author: DiscordSimUser
	content: string
	type: number
}

interface SimChannel {
	readonly id: string
	readonly type: number
	readonly name: string
	readonly parent_id: string | null
	readonly owner_id: string | null
}

export const makeDiscordSimulator = <E, R>(params: {
	readonly guildId: string
	/** Where the router's inbound events go (the world's `inbound`). */
	readonly ingest: (inbound: ChatSyncInbound) => Effect.Effect<void, E, R>
}) => {
	let snowflake = 1_300_000_000_000_000_000n
	const nextId = () => String(++snowflake)
	let clock = Date.parse("2026-11-20T12:00:00.000Z")
	const now = () => new Date((clock += 1000)).toISOString()

	const bot: DiscordSimUser = {
		id: nextId(),
		username: "hazel",
		global_name: "Hazel",
		avatar: null,
		discriminator: "0",
		bot: true,
	}
	const channels = new Map<string, SimChannel>()
	const messages = new Map<string, SimMessage>()
	/** Every frame sent, in order, for a failing test to print. */
	const frames: Array<DiscordFrame> = []

	const threadParents = makeDiscordThreadParents((channelId) => {
		// As `GET /channels/:id` answers: the session asks for a channel it has not seen.
		const channel = channels.get(channelId)
		return channel === undefined
			? Effect.fail(new Error(`unknown channel ${channelId}`))
			: Effect.succeed({ ...channel })
	})
	const router = makeDiscordGatewayRouter({
		ingest: params.ingest,
		isCurrentBotAuthor: (authorId) => Effect.succeed(authorId === bot.id),
		threadParents,
	})

	const isRouted = (t: string): t is DiscordRoutedEvent =>
		(DISCORD_ROUTED_EVENTS as ReadonlyArray<string>).includes(t)

	/** Sends frames in order, as the gateway would; events the session does not subscribe to are dropped. */
	const send = (...sent: ReadonlyArray<DiscordFrame>) =>
		Effect.forEach(
			sent,
			(frame) => {
				frames.push(frame)
				return isRouted(frame.t) ? router.dispatch(frame.t, frame.d) : Effect.void
			},
			{ discard: true },
		)

	const user = (username: string, globalName: string | null = null): DiscordSimUser => ({
		id: nextId(),
		username,
		global_name: globalName,
		avatar: null,
		discriminator: "0",
	})

	const messagePayload = (
		message: SimMessage,
		extra: Record<string, unknown> = {},
	): Record<string, unknown> => ({
		id: message.id,
		channel_id: message.channel_id,
		guild_id: params.guildId,
		type: message.type,
		content: message.content,
		author: message.author,
		member: { roles: [], joined_at: "2026-01-01T00:00:00.000Z" },
		mentions: [],
		mention_roles: [],
		mention_everyone: false,
		attachments: [],
		embeds: [],
		components: [],
		pinned: false,
		tts: false,
		flags: 0,
		timestamp: now(),
		edited_timestamp: null,
		...extra,
	})

	const post = (
		channelId: string,
		author: DiscordSimUser,
		content: string,
		type: number,
		extra: Record<string, unknown> = {},
	) =>
		Effect.gen(function* () {
			const message: SimMessage = { id: nextId(), channel_id: channelId, author, content, type }
			messages.set(message.id, message)
			yield* send({ t: "MESSAGE_CREATE", d: messagePayload(message, extra) })
			return message.id
		})

	const threadPayload = (thread: SimChannel) => ({
		id: thread.id,
		guild_id: params.guildId,
		parent_id: thread.parent_id,
		owner_id: thread.owner_id,
		type: thread.type,
		name: thread.name,
		last_message_id: null,
		message_count: 0,
		member_count: 1,
		rate_limit_per_user: 0,
		flags: 0,
		thread_metadata: {
			archived: false,
			auto_archive_duration: 4320,
			archive_timestamp: now(),
			locked: false,
		},
		newly_created: true,
	})

	const messageOf = (messageId: string) => {
		const message = messages.get(messageId)
		if (message === undefined) throw new Error(`unknown message ${messageId}`)
		return message
	}

	return {
		bot,
		frames,
		user,

		/** A text channel the guild has; announced with `GUILD_CREATE` like a session's start. */
		textChannel: (name: string, id = nextId()) =>
			Effect.gen(function* () {
				const channel: SimChannel = { id, type: 0, name, parent_id: null, owner_id: null }
				channels.set(id, channel)
				yield* send({
					t: "GUILD_CREATE",
					d: {
						id: params.guildId,
						channels: [{ ...channel, guild_id: params.guildId }],
						threads: [],
					},
				})
				return id
			}),

		/** Someone posts a message. */
		say: (channelId: string, author: DiscordSimUser, content: string) =>
			post(channelId, author, content, DiscordMessageType.Default),

		/** Someone replies to a message. */
		reply: (messageId: string, author: DiscordSimUser, content: string) => {
			const parent = messageOf(messageId)
			return post(parent.channel_id, author, content, DiscordMessageType.Reply, {
				message_reference: {
					type: 0,
					message_id: parent.id,
					channel_id: parent.channel_id,
					guild_id: params.guildId,
				},
				referenced_message: messagePayload(parent),
			})
		},

		/** A bot, a webhook or a system notice of any `type`, posted as Discord posts it. */
		raw: post,

		/**
		 * Someone starts a public thread on a message: the thread takes the message's id, Discord
		 * announces the thread, updates the starter message with it, and posts the "started a
		 * thread" notice (type 18) in the channel.
		 */
		startThreadOnMessage: (messageId: string, owner: DiscordSimUser, name?: string) =>
			Effect.gen(function* () {
				const starter = messageOf(messageId)
				const thread: SimChannel = {
					id: starter.id,
					type: 11,
					name: name ?? starter.content.slice(0, 100),
					parent_id: starter.channel_id,
					owner_id: owner.id,
				}
				channels.set(thread.id, thread)
				yield* send(
					{ t: "THREAD_CREATE", d: threadPayload(thread) },
					{ t: "MESSAGE_UPDATE", d: messagePayload(starter, { thread: threadPayload(thread) }) },
				)
				yield* post(starter.channel_id, owner, thread.name, DiscordMessageType.ThreadCreated, {
					message_reference: { type: 0, channel_id: thread.id, guild_id: params.guildId },
				})
				return thread.id
			}),

		/**
		 * Someone starts a thread with no starter message (the "+" button): its own id, the type 18
		 * notice in the channel, then their first message inside it.
		 */
		startThread: (
			channelId: string,
			owner: DiscordSimUser,
			name: string,
			firstMessage: string,
			options: { readonly private?: boolean } = {},
		) =>
			Effect.gen(function* () {
				const thread: SimChannel = {
					id: nextId(),
					type: options.private ? 12 : 11,
					name,
					parent_id: channelId,
					owner_id: owner.id,
				}
				channels.set(thread.id, thread)
				yield* send({ t: "THREAD_CREATE", d: threadPayload(thread) })
				if (!options.private) {
					yield* post(channelId, owner, name, DiscordMessageType.ThreadCreated, {
						message_reference: { type: 0, channel_id: thread.id, guild_id: params.guildId },
					})
				}
				yield* post(thread.id, owner, firstMessage, DiscordMessageType.Default)
				return thread.id
			}),

		/** Someone edits their message. */
		edit: (messageId: string, content: string) =>
			Effect.suspend(() => {
				const message = messageOf(messageId)
				message.content = content
				return send({ t: "MESSAGE_UPDATE", d: messagePayload(message, { edited_timestamp: now() }) })
			}),

		/** A message is deleted. */
		remove: (messageId: string) =>
			Effect.suspend(() => {
				const message = messageOf(messageId)
				messages.delete(messageId)
				return send({
					t: "MESSAGE_DELETE",
					d: { id: message.id, channel_id: message.channel_id, guild_id: params.guildId },
				})
			}),

		/** Someone reacts with a unicode emoji. */
		react: (messageId: string, who: DiscordSimUser, emoji: string) =>
			Effect.suspend(() => {
				const message = messageOf(messageId)
				return send({
					t: "MESSAGE_REACTION_ADD",
					d: {
						user_id: who.id,
						channel_id: message.channel_id,
						message_id: message.id,
						guild_id: params.guildId,
						member: { user: who, roles: [] },
						emoji: { id: null, name: emoji },
						message_author_id: message.author.id,
						burst: false,
						type: 0,
					},
				})
			}),

		/** Someone takes back their reaction. */
		unreact: (messageId: string, who: DiscordSimUser, emoji: string) =>
			Effect.suspend(() => {
				const message = messageOf(messageId)
				return send({
					t: "MESSAGE_REACTION_REMOVE",
					d: {
						user_id: who.id,
						channel_id: message.channel_id,
						message_id: message.id,
						guild_id: params.guildId,
						emoji: { id: null, name: emoji },
						burst: false,
						type: 0,
					},
				})
			}),

		/** Someone pins a message: its update, then the "pinned a message" notice (type 6). */
		pin: (messageId: string, who: DiscordSimUser) =>
			Effect.gen(function* () {
				const message = messageOf(messageId)
				yield* send({ t: "MESSAGE_UPDATE", d: messagePayload(message, { pinned: true }) })
				yield* post(message.channel_id, who, "", DiscordMessageType.ChannelPinnedMessage, {
					message_reference: {
						type: 0,
						message_id: message.id,
						channel_id: message.channel_id,
						guild_id: params.guildId,
					},
				})
			}),

		/** Someone joins the guild: the welcome notice (type 7) in the system channel. */
		join: (channelId: string, who: DiscordSimUser) =>
			post(channelId, who, "", DiscordMessageType.UserJoin),

		/** Recorded frames, sent as they are. */
		replay: (recorded: ReadonlyArray<DiscordFrame>) => send(...recorded),

		/** The frames sent so far, one line each, for a failing test's message. */
		log: () => frames.map((frame) => `${frame.t} ${JSON.stringify(frame.d).slice(0, 160)}`).join("\n"),
	}
}
