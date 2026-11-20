/**
 * For tests: a fake Slack workspace. Each action (someone posts, replies in a thread, edits,
 * joins...) emits the Events API deliveries Slack sends for it, whole request bodies in Slack's
 * order, the bookkeeping events included (a reply's `message_changed` on its parent, `channel_join`
 * notices), and reads each one the way the webhook does (`decodeSlackEnvelope`, then
 * `readSlackDelivery`). `users.info` answers from the simulated workspace's people.
 *
 * The shapes follow Slack's Events API docs (https://api.slack.com/events/message and its
 * subtypes). `replay` takes recorded request bodies as they are.
 */
import { Slack } from "@hazel/integrations"
import { ExternalUserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import type { ChatSyncInbound } from "../../chat-sync-inbound"
import { readSlackDelivery, type SlackDelivery, type SlackUserLookup } from "./events"

/** A Slack payload as JSON: an event, a nested message, or a delivery's body. */
export type SlackJson = Record<string, unknown>

export interface SlackSimUser {
	readonly id: string
	readonly name: string
	/** Their own team; a Slack Connect guest's differs from the workspace's. */
	readonly team: string
}

/** What a delivery did, for a test to check: ignored, ended the install, or became an inbound event. */
export type SlackSimOutcome = SlackDelivery["_tag"]

interface SimMessage {
	readonly ts: string
	readonly channel: string
	readonly user: string | null
	text: string
	readonly threadTs: string | null
	replies: Array<string>
	readonly extra: SlackJson
}

/** Message subtypes Slack posts in a channel (https://api.slack.com/events/message#subtypes). */
export const SLACK_MESSAGE_SUBTYPES = [
	"bot_message",
	"channel_archive",
	"channel_convert_to_private",
	"channel_convert_to_public",
	"channel_join",
	"channel_leave",
	"channel_name",
	"channel_posting_permissions",
	"channel_purpose",
	"channel_topic",
	"channel_unarchive",
	"ekm_access_denied",
	"file_comment",
	"file_mention",
	"file_share",
	"group_archive",
	"group_join",
	"group_leave",
	"group_name",
	"group_purpose",
	"group_topic",
	"group_unarchive",
	"huddle_thread",
	"me_message",
	"pinned_item",
	"reminder_add",
	"unpinned_item",
] as const

export const makeSlackSimulator = <E, R>(params: {
	/** The workspace Hazel is installed in. */
	readonly teamId: string
	readonly appId?: string
	/** Where inbound events go (the world's `inbound`). */
	readonly ingest: (inbound: ChatSyncInbound) => Effect.Effect<void, E, R>
}) => {
	const appId = params.appId ?? "A0HAZELAPP"
	const botUser = "U0HAZELBOT"
	const botId = "B0HAZELBOT"
	let seconds = 1_763_640_000
	let micro = 0
	const nextTs = () => `${seconds}.${String(++micro).padStart(6, "0")}`
	let eventCounter = 0
	let userCounter = 0

	const people = new Map<string, SlackSimUser>()
	const messages = new Map<string, SimMessage>()
	/** Every request body sent, in order, and what each became. */
	const sent: Array<{ readonly body: SlackJson; outcome: SlackSimOutcome | "Undecodable" }> = []

	/** As `users.info` answers. */
	const lookupUser: SlackUserLookup = (userId) =>
		Effect.succeed(
			Option.map(Option.fromNullishOr(people.get(userId)), (user) => ({
				externalUserId: ExternalUserId.make(user.id),
				displayName: user.name,
				avatarUrl: null,
				email: user.team === params.teamId ? null : `${user.name.toLowerCase()}@guest.example`,
				externalWorkspaceId: user.team,
			})),
		)

	/** The request body Slack POSTs for an event. */
	const envelopeOf = (event: SlackJson) => ({
		token: "verification-token",
		team_id: params.teamId,
		context_team_id: params.teamId,
		api_app_id: appId,
		event,
		type: "event_callback",
		event_id: `Ev${String(++eventCounter).padStart(8, "0")}`,
		event_time: seconds,
		authorizations: [
			{
				enterprise_id: null,
				team_id: params.teamId,
				user_id: botUser,
				is_bot: true,
				is_enterprise_install: false,
			},
		],
		is_ext_shared_channel: false,
		event_context: `4-${eventCounter}`,
	})

	/** Delivers request bodies in order, as the webhook reads them. */
	const deliver = (...bodies: ReadonlyArray<SlackJson>) =>
		Effect.forEach(
			bodies,
			(body) =>
				Effect.gen(function* () {
					// Over the wire, as the webhook parses it.
					// SAFETY: a JSON round trip of an object literal is an object.
					const wire = JSON.parse(JSON.stringify(body)) as SlackJson
					const entry: (typeof sent)[number] = { body: wire, outcome: "Undecodable" }
					sent.push(entry)
					const envelope = Slack.decodeSlackEnvelope(wire)
					if (Option.isNone(envelope) || envelope.value._tag !== "EventCallback") return
					const delivery = yield* readSlackDelivery(envelope.value, lookupUser)
					entry.outcome = delivery._tag
					if (delivery._tag === "Inbound") yield* params.ingest(delivery.inbound)
				}),
			{ discard: true },
		)

	const send = (...events: ReadonlyArray<SlackJson>) => deliver(...events.map(envelopeOf))

	const messageOf = (ts: string) => {
		const message = messages.get(ts)
		if (message === undefined) throw new Error(`unknown message ${ts}`)
		return message
	}

	/**
	 * A message as Slack nests it (in `message_changed`) or posts it. Fields left `undefined` are
	 * absent once the body goes over the wire (`deliver` sends it through JSON).
	 */
	const messageBody = (message: SimMessage): SlackJson => {
		const hasReplies = message.replies.length > 0
		return {
			type: "message",
			user: message.user ?? undefined,
			text: message.text,
			ts: message.ts,
			team: params.teamId,
			// A parent with replies carries its thread's bookkeeping; a reply names its parent.
			thread_ts: hasReplies ? message.ts : (message.threadTs ?? undefined),
			parent_user_id:
				message.threadTs !== null && message.threadTs !== message.ts
					? messageOf(message.threadTs).user
					: undefined,
			reply_count: hasReplies ? message.replies.length : undefined,
			reply_users: hasReplies
				? [...new Set(message.replies.map((ts) => messageOf(ts).user))]
				: undefined,
			latest_reply: hasReplies ? message.replies.at(-1) : undefined,
			...message.extra,
		}
	}

	const post = (
		channel: string,
		user: SlackSimUser | null,
		text: string,
		extra: SlackJson = {},
		threadTs: string | null = null,
	) => {
		const message: SimMessage = {
			ts: nextTs(),
			channel,
			user: user?.id ?? null,
			text,
			threadTs,
			replies: [],
			extra,
		}
		messages.set(message.ts, message)
		return message
	}

	const postEvent = (message: SimMessage) => ({
		...messageBody(message),
		channel: message.channel,
		event_ts: message.ts,
		channel_type: "channel",
	})

	/** A `message_changed`: an edit (`edited`), or Slack's bookkeeping on a thread's parent. */
	const changed = (
		message: SimMessage,
		previous: SlackJson,
		options: { readonly edited?: boolean } = {},
	) => {
		const ts = nextTs()
		return {
			type: "message",
			subtype: "message_changed",
			hidden: true,
			message: {
				...messageBody(message),
				edited: options.edited ? { user: message.user, ts } : undefined,
			},
			previous_message: previous,
			channel: message.channel,
			ts,
			event_ts: ts,
			channel_type: "channel",
		}
	}

	return {
		botUser,
		appId,
		sent,

		/** Someone in the workspace (or, with `team`, a Slack Connect guest from another one). */
		user: (name: string, team = params.teamId): SlackSimUser => {
			const user = { id: `U0${String(++userCounter).padStart(8, "0")}`, name, team }
			people.set(user.id, user)
			return user
		},

		/** Someone posts a message. */
		say: (channel: string, user: SlackSimUser, text: string) =>
			Effect.suspend(() => {
				const message = post(channel, user, text, { client_msg_id: crypto.randomUUID() })
				return send(postEvent(message)).pipe(Effect.as(message.ts))
			}),

		/**
		 * Someone replies in a message's thread: the reply, then the parent's bookkeeping
		 * `message_changed` (its reply count; same text). `broadcast` also sends it to the channel.
		 */
		reply: (
			parentTs: string,
			user: SlackSimUser,
			text: string,
			options: { readonly broadcast?: boolean } = {},
		) =>
			Effect.suspend(() => {
				const parent = messageOf(parentTs)
				const before = messageBody(parent)
				const message = post(
					parent.channel,
					user,
					text,
					options.broadcast
						? { subtype: "thread_broadcast" }
						: { client_msg_id: crypto.randomUUID() },
					parent.ts,
				)
				parent.replies.push(message.ts)
				return send(postEvent(message), changed(parent, before)).pipe(Effect.as(message.ts))
			}),

		/** Someone edits their message. */
		edit: (ts: string, text: string) =>
			Effect.suspend(() => {
				const message = messageOf(ts)
				const before = messageBody(message)
				message.text = text
				return send(changed(message, before, { edited: true }))
			}),

		/** A message is deleted. */
		remove: (ts: string) =>
			Effect.suspend(() => {
				const message = messageOf(ts)
				messages.delete(ts)
				const eventTs = nextTs()
				return send({
					type: "message",
					subtype: "message_deleted",
					hidden: true,
					deleted_ts: message.ts,
					channel: message.channel,
					previous_message: messageBody(message),
					// A thread reply's deletion names its thread.
					thread_ts:
						message.threadTs !== null && message.threadTs !== message.ts
							? message.threadTs
							: undefined,
					ts: eventTs,
					event_ts: eventTs,
					channel_type: "channel",
				})
			}),

		/** Someone reacts (`emoji` is Slack's name, without colons). */
		react: (ts: string, user: SlackSimUser, emoji: string) =>
			Effect.suspend(() => {
				const message = messageOf(ts)
				return send({
					type: "reaction_added",
					user: user.id,
					reaction: emoji,
					item_user: message.user,
					item: { type: "message", channel: message.channel, ts: message.ts },
					event_ts: nextTs(),
				})
			}),

		/** Someone takes back their reaction. */
		unreact: (ts: string, user: SlackSimUser, emoji: string) =>
			Effect.suspend(() => {
				const message = messageOf(ts)
				return send({
					type: "reaction_removed",
					user: user.id,
					reaction: emoji,
					item_user: message.user,
					item: { type: "message", channel: message.channel, ts: message.ts },
					event_ts: nextTs(),
				})
			}),

		/** Someone shares a file with a comment. */
		shareFile: (channel: string, user: SlackSimUser, text: string, fileName: string) =>
			Effect.suspend(() => {
				const fileId = `F0${String(++userCounter).padStart(8, "0")}`
				const message = post(channel, user, text, {
					subtype: "file_share",
					upload: true,
					display_as_bot: false,
					files: [
						{
							id: fileId,
							name: fileName,
							title: fileName,
							mimetype: "application/pdf",
							size: 1024,
							url_private: `https://files.slack.com/files-pri/${params.teamId}-${fileId}/${fileName}`,
							permalink: `https://acme.slack.com/files/${user.id}/${fileId}/${fileName}`,
						},
					],
				})
				return send(postEvent(message)).pipe(Effect.as(message.ts))
			}),

		/** `/me waves`. */
		me: (channel: string, user: SlackSimUser, text: string) =>
			Effect.suspend(() => send(postEvent(post(channel, user, text, { subtype: "me_message" })))),

		/** Someone joins the channel: Slack's `channel_join` notice. */
		join: (channel: string, user: SlackSimUser) =>
			Effect.suspend(() =>
				send(
					postEvent(
						post(channel, user, `<@${user.id}> has joined the channel`, {
							subtype: "channel_join",
						}),
					),
				),
			),

		/** Someone sets the topic: Slack's `channel_topic` notice. */
		setTopic: (channel: string, user: SlackSimUser, topic: string) =>
			Effect.suspend(() =>
				send(
					postEvent(
						post(channel, user, `<@${user.id}> set the channel topic: ${topic}`, {
							subtype: "channel_topic",
							topic,
						}),
					),
				),
			),

		/** Someone pins a message: `pin_added`, and the `pinned_item` notice. */
		pin: (ts: string, user: SlackSimUser) =>
			Effect.suspend(() => {
				const message = messageOf(ts)
				const eventTs = nextTs()
				return send(
					{
						type: "pin_added",
						user: user.id,
						channel_id: message.channel,
						item: { type: "message", channel: message.channel, message: messageBody(message) },
						event_ts: eventTs,
					},
					postEvent(
						post(message.channel, user, `<@${user.id}> pinned a message to this channel.`, {
							subtype: "pinned_item",
							item_type: "C",
						}),
					),
				)
			}),

		/** Another app's bot posts. */
		botSays: (channel: string, text: string) =>
			Effect.suspend(() =>
				send(
					postEvent(
						post(channel, null, text, {
							subtype: "bot_message",
							bot_id: "B0OTHERBOT",
							username: "CI",
						}),
					),
				),
			),

		/** Hazel's own post, echoed back by Slack (it carries Hazel's app id). */
		hazelPosts: (channel: string, text: string) =>
			Effect.suspend(() =>
				send(
					postEvent(
						post(channel, { id: botUser, name: "Hazel", team: params.teamId }, text, {
							bot_id: botId,
							app_id: appId,
						}),
					),
				),
			),

		/** A message of any subtype, posted as Slack posts it. */
		raw: (channel: string, user: SlackSimUser, text: string, extra: SlackJson) =>
			Effect.suspend(() => send(postEvent(post(channel, user, text, extra)))),

		/** Any event, wrapped in a delivery. */
		event: send,

		/** Recorded request bodies, delivered as they are. */
		replay: (bodies: ReadonlyArray<SlackJson>) => deliver(...bodies),

		/** The deliveries so far, one line each with what it became, for a failing test's message. */
		log: () =>
			sent
				.map(
					({ body, outcome }) =>
						`${outcome.padEnd(11)} ${JSON.stringify(body.event).slice(0, 160)}`,
				)
				.join("\n"),
	}
}
