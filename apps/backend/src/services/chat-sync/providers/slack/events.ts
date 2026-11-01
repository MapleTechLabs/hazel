/**
 * Slack's chat-sync source: an Events API delivery (`POST /webhooks/slack`, verified by the
 * route) → `ChatSyncInbound`s, routed like any provider's (`routeChatSyncInbound`). Hazel's own
 * posts come back as events too: they carry the app's id, and its reactions the bot's user, and
 * are dropped here. A thread reply routes by its channel and names its thread (`externalThreadId`).
 *
 * Every key is Slack's `event_id`, which a retried delivery keeps, so each event applies once.
 */
import { Slack } from "@hazel/integrations"
import { ExternalChannelId, ExternalMessageId, ExternalThreadId, ExternalUserId } from "@hazel/schema"
import { Effect, Option, Redacted } from "effect"
import type { ChatSyncAttachment, ChatSyncMention } from "../../chat-sync-effects"
import {
	type ChatSyncInbound,
	type ChatSyncInboundAuthor,
	routeChatSyncInbound,
} from "../../chat-sync-inbound"
import { ChatSyncInstallations } from "../../chat-sync-installations"

type EventCallback = Extract<Slack.SlackEnvelope, { readonly _tag: "EventCallback" }>

/** A Slack user's name and avatar (`users.info`); `None` when Slack cannot say. */
export type SlackUserLookup = (userId: string) => Effect.Effect<Option.Option<ChatSyncInboundAuthor>>

/** The install's bot user in this workspace: its reactions are Hazel's own. */
const botUserOf = (envelope: EventCallback) =>
	envelope.authorizations?.find((authorization) => authorization.is_bot)?.user_id ?? null

const isOwnOrBot = (envelope: EventCallback, message: Slack.SlackMessage) =>
	message.appId === envelope.api_app_id ||
	message.botId !== null ||
	(message.user !== null && message.user === botUserOf(envelope))

/**
 * The workspaces an event happened in: the delivery's team, and for a channel shared with another
 * workspace (Slack Connect) the team it belongs to and the installs it reached.
 */
const workspacesOf = (envelope: EventCallback): ReadonlyArray<string> => [
	...new Set(
		[
			envelope.team_id,
			envelope.context_team_id,
			...(envelope.authorizations ?? []).map((authorization) => authorization.team_id),
		].filter((team): team is string => typeof team === "string" && team.length > 0),
	),
]

/** A reply's thread: the parent's ts, unless the message is the parent itself. */
const threadOf = (message: { readonly ts: string; readonly threadTs: string | null }) =>
	message.threadTs !== null && message.threadTs !== message.ts
		? { inExternalThreadId: ExternalThreadId.make(message.threadTs) }
		: {}

/** Slack files are private to the workspace: linked by permalink, which Slack people can open. */
const attachmentsOf = (message: Slack.SlackMessage): ReadonlyArray<ChatSyncAttachment> =>
	message.files.flatMap((file) =>
		file.permalink === null
			? []
			: [
					{
						externalAttachmentId: file.id,
						fileName: file.name ?? file.title ?? "file",
						fileSize: file.size ?? 0,
						publicUrl: file.permalink,
					},
				],
	)

const MAX_MENTION_LOOKUPS = 10

/** Names for the users a message mentions, so ones Hazel cannot map still read as names. */
const mentionsOf = (text: string, lookupUser: SlackUserLookup) => {
	const pattern = new RegExp(Slack.SLACK_USER_MENTION_PATTERN.source, "g")
	const ids = [...new Set([...text.matchAll(pattern)].map((match) => match[1]!))].slice(
		0,
		MAX_MENTION_LOOKUPS,
	)
	return Effect.forEach(ids, (id) => lookupUser(id), { concurrency: 4 }).pipe(
		Effect.map((users) =>
			users.flatMap(
				(user): Array<ChatSyncMention> =>
					Option.isSome(user)
						? [{ externalUserId: user.value.externalUserId, displayName: user.value.displayName }]
						: [],
			),
		),
	)
}

/** The author of an event, falling back to the bare id when Slack cannot name them. */
const authorOf = (userId: string, lookupUser: SlackUserLookup) =>
	lookupUser(userId).pipe(
		Effect.map(
			Option.getOrElse(
				(): ChatSyncInboundAuthor => ({
					externalUserId: ExternalUserId.make(userId),
					displayName: "Slack user",
					avatarUrl: null,
				}),
			),
		),
	)

/** The chat-sync event a Slack event is, if any. */
export const slackInbound = Effect.fn("SlackEvents.inbound")(function* (
	envelope: EventCallback,
	event: Slack.SlackEvent,
	lookupUser: SlackUserLookup,
) {
	const dedupeKey = `slack:event:${envelope.event_id}`
	const base = { provider: "slack" as const, dedupeKey, externalWorkspaceIds: workspacesOf(envelope) }
	yield* Effect.annotateCurrentSpan({ "slack.event": event._tag, "slack.event_id": envelope.event_id })
	switch (event._tag) {
		case "MessagePosted": {
			const { message } = event
			if (isOwnOrBot(envelope, message) || message.user === null) return Option.none<ChatSyncInbound>()
			const text = Slack.slackMrkdwnToMarkdown(message.text)
			return Option.some<ChatSyncInbound>({
				...base,
				externalChannelId: ExternalChannelId.make(message.channel),
				author: yield* authorOf(message.user, lookupUser),
				event: {
					_tag: "MessageCreate",
					externalMessageId: ExternalMessageId.make(message.ts),
					externalWebhookId: null,
					content: text,
					externalReplyToMessageId: null,
					attachments: attachmentsOf(message),
					mentions: yield* mentionsOf(text, lookupUser),
					...threadOf(message),
				},
			})
		}
		case "MessageChanged": {
			const { message } = event
			if (isOwnOrBot(envelope, message)) return Option.none<ChatSyncInbound>()
			// Slack reports thread bookkeeping (a new reply) as a change with the same text.
			if (event.previousMessage !== null && event.previousMessage.text === message.text) {
				return Option.none<ChatSyncInbound>()
			}
			const text = Slack.slackMrkdwnToMarkdown(message.text)
			return Option.some<ChatSyncInbound>({
				...base,
				externalChannelId: ExternalChannelId.make(event.channel),
				author: null,
				event: {
					_tag: "MessageUpdate",
					externalMessageId: ExternalMessageId.make(message.ts),
					externalWebhookId: null,
					content: text,
					mentions: yield* mentionsOf(text, lookupUser),
					...threadOf(message),
				},
			})
		}
		case "MessageDeleted":
			return Option.some<ChatSyncInbound>({
				...base,
				externalChannelId: ExternalChannelId.make(event.channel),
				author: null,
				event: {
					_tag: "MessageDelete",
					externalMessageId: ExternalMessageId.make(event.deletedTs),
					externalWebhookId: null,
					...threadOf({ ts: event.deletedTs, threadTs: event.threadTs }),
				},
			})
		case "ReactionAdded":
		case "ReactionRemoved": {
			// Slack names no thread for a reaction: one on a thread reply finds no message in the
			// parent channel and is ignored there.
			if (event.user === botUserOf(envelope)) return Option.none<ChatSyncInbound>()
			return Option.some<ChatSyncInbound>({
				...base,
				externalChannelId: ExternalChannelId.make(event.item.channel),
				author: yield* authorOf(event.user, lookupUser),
				event: {
					_tag: event._tag === "ReactionAdded" ? "ReactionAdd" : "ReactionRemove",
					externalMessageId: ExternalMessageId.make(event.item.ts),
					emoji: event.reaction,
				},
			})
		}
		case "AppUninstalled":
		case "TokensRevoked":
		case "ChannelRenamed":
			return Option.none<ChatSyncInbound>()
	}
})

/** Whether the event ends the workspace's install (its bot token is dead). */
export const endsInstall = (event: Slack.SlackEvent) =>
	event._tag === "AppUninstalled" || (event._tag === "TokensRevoked" && event.bot.length > 0)

/** A Slack user Hazel could not look up: logged, and left unnamed. */
const unnamed = (userId: string) => (error: { readonly _tag: string; readonly message: string }) =>
	Effect.logWarning("Slack user lookup failed", { userId, error: error._tag, reason: error.message }).pipe(
		Effect.andThen(Effect.annotateCurrentSpan({ "slack.user_lookup_failed": error._tag })),
		Effect.as(Option.none<ChatSyncInboundAuthor>()),
	)

/** `users.info` answers, per isolate: an event names its author, and mentions repeat. */
const USER_TTL_MS = 10 * 60 * 1000
const MAX_CACHED_USERS = 5_000
/** Slack wants an answer within 3s: a slow lookup leaves the author unnamed instead. */
const USER_LOOKUP_TIMEOUT = "1 second"
const users = new Map<
	string,
	{ readonly user: Option.Option<ChatSyncInboundAuthor>; readonly until: number }
>()

/**
 * Apply one verified delivery: an uninstall drops the workspace's install; a message or reaction
 * goes to the orgs linked to its channel.
 */
export const dispatchSlackEvent = Effect.fn("SlackEvents.dispatch")(function* (envelope: EventCallback) {
	const event = Slack.decodeSlackEvent(envelope.event)
	yield* Effect.annotateCurrentSpan({
		"slack.team_id": envelope.team_id,
		"slack.event_type": Option.match(event, { onNone: () => "unsupported", onSome: (e) => e._tag }),
	})
	if (Option.isNone(event)) return
	const installations = yield* ChatSyncInstallations
	if (endsInstall(event.value)) {
		yield* Effect.logInfo("Slack app uninstalled from a workspace", { teamId: envelope.team_id })
		return yield* installations.remove("slack", envelope.team_id)
	}
	const api = yield* Slack.SlackApiClient
	const lookupUser: SlackUserLookup = (userId) =>
		Effect.gen(function* () {
			const key = `${envelope.team_id}:${userId}`
			const cached = users.get(key)
			if (cached !== undefined && cached.until > Date.now()) return cached.user
			const token = yield* installations.token("slack", envelope.team_id)
			if (Option.isNone(token)) return Option.none<ChatSyncInboundAuthor>()
			const user = yield* api.getUser(Redacted.value(token.value), userId)
			const found = Option.some<ChatSyncInboundAuthor>({
				externalUserId: ExternalUserId.make(user.id),
				displayName: user.displayName,
				avatarUrl: user.avatarUrl,
			})
			if (users.size >= MAX_CACHED_USERS) users.clear()
			users.set(key, { user: found, until: Date.now() + USER_TTL_MS })
			return found
		}).pipe(
			Effect.timeoutOption(USER_LOOKUP_TIMEOUT),
			Effect.map(Option.flatten),
			// The event still applies, its author unnamed; the reason (a dead token, say) is logged.
			Effect.catchTags({
				SlackApiError: unnamed(userId),
				DatabaseError: unnamed(userId),
				IntegrationEncryptionError: unnamed(userId),
				KeyVersionNotFoundError: unnamed(userId),
			}),
		)
	const inbound = yield* slackInbound(envelope, event.value, lookupUser)
	if (Option.isSome(inbound)) yield* routeChatSyncInbound(inbound.value)
})
