/**
 * Slack chat sync across the objects (node SQLite): a connection only to the workspace the org
 * installed in; a new link prepared (the bot joins); Events API deliveries turned into inbound
 * events (own posts dropped, a first reply makes a Hazel thread on its parent); Hazel replies in
 * a thread posted to `<channel>/<thread ts>`.
 */
import { CreateThreadRequest } from "@hazel/domain/rpc"
import type { Slack } from "@hazel/integrations"
import type { ChannelId, ExternalChannelId, MessageId } from "@hazel/schema"
import { Cause, Effect, Exit, Option } from "effect"
import { describe, expect, it } from "vitest"
import { channelTarget } from "../../../../worker/objects/kinds"
import { makeTestObjects, type TestObjects } from "../../../../worker/objects/testing"
import { callRpc, makeChatSyncOrg, ok, rows, runScoped } from "../../testing-world"
import { type SlackUserLookup, slackHistoryInbound, slackInbound } from "./events"

const TEAM = "T0HAZEL01"
const SLACK_CHANNEL = "C0GENERAL1" as ExternalChannelId
const APP = "A0HAZELAPP"
const BOT_USER = "U0HAZELBOT"

const uuid = () => crypto.randomUUID()

const call = callRpc
const run = runScoped

/** `U0GUEST…` users are Slack Connect guests from another company's team, with an email. */
const lookupUser: SlackUserLookup = (userId) =>
	Effect.succeed(
		Option.some({
			externalUserId: userId as never,
			displayName: `Slack ${userId}`,
			avatarUrl: null,
			email: userId.startsWith("U0GUEST") ? `${userId.toLowerCase()}@globex.example` : null,
			externalWorkspaceId: userId.startsWith("U0GUEST") ? "T0GLOBEX01" : TEAM,
		}),
	)

const envelope = (
	eventId: string,
	team = TEAM,
): Extract<Slack.SlackEnvelope, { readonly _tag: "EventCallback" }> => ({
	_tag: "EventCallback",
	team_id: team,
	api_app_id: APP,
	event_id: eventId,
	event_time: 1_700_000_000,
	event: null,
	authorizations: [{ team_id: team, user_id: BOT_USER, is_bot: true }],
})

const slackMessage = (
	ts: string,
	text: string,
	extra: Partial<Slack.SlackMessage> = {},
): Slack.SlackMessage => ({
	channel: SLACK_CHANNEL,
	channelType: "channel",
	user: "U0DANA0001",
	botId: null,
	appId: null,
	username: null,
	text,
	ts,
	threadTs: null,
	files: [],
	edited: null,
	...extra,
})

/** An org installed in `team`, a channel, and a Slack connection; `linkChannel` links it to `SLACK_CHANNEL`. */
const makeOrg = (objects: TestObjects, team = TEAM) =>
	Effect.gen(function* () {
		const org = yield* makeChatSyncOrg(objects, {
			provider: "slack",
			workspaceId: team,
			installedIn: team,
		})
		/** A Slack event, read as the webhook reads it, delivered from `fromTeam`. */
		const inbound = (eventId: string, event: Slack.SlackEvent, fromTeam = team) =>
			Effect.gen(function* () {
				const found = yield* slackInbound(envelope(eventId, fromTeam), event, lookupUser)
				if (Option.isSome(found)) yield* org.inbound(found.value)
			})
		return {
			...org,
			linkChannel: (historyLimit?: number) => org.linkChannel(SLACK_CHANNEL, historyLimit),
			inbound,
		}
	})

/** One org with its channel linked to `SLACK_CHANNEL`. */
const makeWorld = Effect.gen(function* () {
	const world = yield* makeOrg(yield* makeTestObjects)
	yield* ok(yield* world.linkChannel())
	return world
})

describe("Slack chat sync on the objects", () => {
	it("connects only to the workspace the org installed Hazel in", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const other = yield* world.connectTo("T0SOMEONEELSE")
				expect(Exit.isFailure(other)).toBe(true)
				expect(Cause.pretty((other as Exit.Failure<unknown, unknown>).cause)).toContain(
					"ChatSyncIntegrationNotConnectedError",
				)
			}),
		))

	it("an event from another workspace reaches no link, even for the same channel id", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.inbound(
					"Ev90",
					{
						_tag: "MessagePosted",
						subtype: "message",
						message: slackMessage("1700000000.000900", "x"),
					},
					"T0ATTACKER",
				)
				expect(rows(world.channel, `SELECT id FROM messages`)).toEqual([])
			}),
		))

	it("a second org in the same workspace cannot take a channel another org syncs", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const other = yield* makeOrg(world.objects)
				const taken = yield* other.linkChannel()
				expect(Exit.isFailure(taken)).toBe(true)
				expect(Cause.pretty((taken as Exit.Failure<unknown, unknown>).cause)).toContain(
					"ChatSyncChannelLinkExistsError",
				)
				// The channel's events still reach the first org only.
				yield* world.inbound("Ev91", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000910", "still ours"),
				})
				expect(rows(world.channel, `SELECT content FROM messages`)).toEqual([
					{ content: "still ours" },
				])
				expect(rows(other.channel, `SELECT id FROM messages`)).toEqual([])
			}),
		))

	it("records each author of the channel with their Slack team and email", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.inbound("Ev80", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000800", "hello", { user: "U0GUEST001" }),
				})
				yield* world.inbound("Ev81", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000810", "again", { user: "U0GUEST001" }),
				})
				yield* world.inbound("Ev82", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000820", "hi"),
				})
				expect(
					rows(
						world.org,
						`SELECT hazelChannelId, provider, externalUserId, externalWorkspaceId, email
						 FROM chat_sync_channel_authors ORDER BY externalUserId`,
					),
				).toEqual([
					{
						hazelChannelId: world.channelId,
						provider: "slack",
						externalUserId: "U0DANA0001",
						externalWorkspaceId: TEAM,
						email: null,
					},
					{
						hazelChannelId: world.channelId,
						provider: "slack",
						externalUserId: "U0GUEST001",
						externalWorkspaceId: "T0GLOBEX01",
						email: "u0guest001@globex.example",
					},
				])
			}),
		))

	it("an author seen through a replaced mirror moves to the live one on their next message", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const message = (ts: string) =>
					world.inbound(`Ev9${ts.slice(-2)}`, {
						_tag: "MessagePosted",
						subtype: "message",
						message: slackMessage(`1700000000.0009${ts.slice(-2)}`, "hello", {
							user: "U0GUEST001",
						}),
					})
				yield* message("10")
				const [link] = rows<{ id: string }>(world.org, `SELECT id FROM chat_sync_channel_links`)
				// As if recorded through an older mirror a moment ago (within the hour the write is skipped).
				world.org.storage.db
					.prepare(`UPDATE chat_sync_channel_authors SET syncChannelLinkId = 'old-mirror'`)
					.run()
				yield* message("20")
				expect(rows(world.org, `SELECT syncChannelLinkId FROM chat_sync_channel_authors`)).toEqual([
					{ syncChannelLinkId: link!.id },
				])
			}),
		))

	it("a thread reply's author counts for the parent channel's mirror, never the thread's", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const parentLink = () =>
					rows<{ id: string }>(
						world.org,
						`SELECT id FROM chat_sync_channel_links WHERE hazelChannelId = ?`,
						world.channelId,
					)[0]!.id
				const reply = (event: string, ts: string, user: string) =>
					world.inbound(event, {
						_tag: "MessagePosted",
						subtype: "message",
						message: slackMessage(ts, "in the thread", { user, threadTs: "1700000000.000900" }),
					})
				yield* world.inbound("Ev90", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000900", "parent"),
				})
				// A thread-only author, and one already seen in the channel who then replies.
				yield* world.inbound("Ev91", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000905", "hello", { user: "U0GUESTB02" }),
				})
				yield* reply("Ev92", "1700000000.000910", "U0GUEST001")
				yield* reply("Ev93", "1700000000.000920", "U0GUESTB02")
				expect(
					rows(
						world.org,
						`SELECT hazelChannelId, syncChannelLinkId, externalUserId FROM chat_sync_channel_authors
						 WHERE externalUserId LIKE 'U0GUEST%' ORDER BY externalUserId`,
					),
				).toEqual([
					{
						hazelChannelId: world.channelId,
						syncChannelLinkId: parentLink(),
						externalUserId: "U0GUEST001",
					},
					{
						hazelChannelId: world.channelId,
						syncChannelLinkId: parentLink(),
						externalUserId: "U0GUESTB02",
					},
				])
			}),
		))

	it("a new link is prepared: the bot joins the Slack channel", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.org.alarm
				expect(world.objects.chatSyncPrepared).toEqual([SLACK_CHANNEL])
			}),
		))

	it("Slack messages come in as markdown with their author; Hazel's own posts do not", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.inbound("Ev01", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000100", "*ship* it <https://hazel.sh|today>"),
				})
				// Redelivered by Slack: the same event id, applied once.
				yield* world.inbound("Ev01", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000100", "*ship* it <https://hazel.sh|today>"),
				})
				// Hazel's own post, echoed back.
				yield* world.inbound("Ev02", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000200", "from hazel", {
						appId: APP,
						botId: "B0HAZEL",
					}),
				})
				const messages = rows<{ content: string }>(world.channel, `SELECT content FROM messages`)
				expect(messages).toEqual([{ content: "**ship** it [today](https://hazel.sh)" }])
			}),
		))

	it("mentioning a Slack user's shadow pings them in Slack", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				// Dana writes once from Slack, so the org knows her shadow.
				yield* world.inbound("Ev20", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage("1700000000.000900", "hello"),
				})
				const dana = rows<{ authorId: string }>(world.channel, `SELECT authorId FROM messages`)[0]!
					.authorId
				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: `ping @[userId:${dana}]`,
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				expect(world.objects.chatSyncCalls.at(-1)?.content).toBe("ping <@U0DANA0001>")
			}),
		))

	it("a linked channel's history brings its threads: replies after their parent, in a Hazel thread", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeOrg(yield* makeTestObjects)
				const parentTs = "1700000000.000300"
				const entry = (fromReplies: boolean, ts: string, text: string, threadTs: string | null) =>
					slackHistoryInbound(
						{ subtype: null, message: slackMessage(ts, text, { threadTs }), replyCount: 0 },
						TEAM,
						lookupUser,
						fromReplies,
					).pipe(Effect.map(Option.getOrThrow))
				// As the Slack client serves a page: each message, then its thread's replies.
				world.objects.chatSyncHistory.set(SLACK_CHANNEL, [
					yield* entry(false, "1700000000.000100", "before", null),
					yield* entry(false, parentTs, "parent", parentTs),
					yield* entry(true, "1700000000.000400", "first reply", parentTs),
					yield* entry(true, "1700000000.000500", "second reply", parentTs),
					yield* entry(false, "1700000000.000600", "after", null),
				])
				yield* ok(yield* world.linkChannel(50))
				for (let round = 0; round < 10; round++) {
					yield* Effect.sleep("2 millis")
					yield* world.org.alarm
				}

				const threadLinks = rows<{ hazelChannelId: string }>(
					world.org,
					`SELECT hazelChannelId FROM chat_sync_channel_links WHERE externalChannelId = ?`,
					`${SLACK_CHANNEL}/${parentTs}`,
				)
				expect(threadLinks).toHaveLength(1)
				const threadId = threadLinks[0]!.hazelChannelId
				expect(
					rows<{ content: string; threadChannelId: string | null }>(
						world.channel,
						`SELECT content, threadChannelId FROM messages ORDER BY createdAt, rowid`,
					),
				).toEqual([
					{ content: "before", threadChannelId: null },
					{ content: "parent", threadChannelId: threadId },
					{ content: "after", threadChannelId: null },
				])
				const thread = yield* world.objects.get(channelTarget(threadId as ChannelId))
				expect(
					rows<{ content: string }>(
						thread,
						`SELECT content FROM messages ORDER BY createdAt, rowid`,
					),
				).toEqual([{ content: "first reply" }, { content: "second reply" }])
				// Old news: nothing went back out to Slack.
				expect(world.objects.chatSyncCalls.filter((entry) => entry.op !== "fetchHistory")).toEqual([])
			}),
		))

	it("a first Slack reply makes a Hazel thread on its parent; later replies join it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const parentTs = "1700000000.000300"
				yield* world.inbound("Ev10", {
					_tag: "MessagePosted",
					subtype: "message",
					message: slackMessage(parentTs, "parent"),
				})
				const reply = (eventId: string, ts: string, text: string) =>
					world.inbound(eventId, {
						_tag: "MessagePosted",
						subtype: "message",
						message: slackMessage(ts, text, { threadTs: parentTs }),
					})
				yield* reply("Ev11", "1700000000.000400", "first reply")
				yield* reply("Ev12", "1700000000.000500", "second reply")
				yield* world.org.alarm

				const threadLinks = rows<{ hazelChannelId: string }>(
					world.org,
					`SELECT hazelChannelId FROM chat_sync_channel_links WHERE externalChannelId = ?`,
					`${SLACK_CHANNEL}/${parentTs}`,
				)
				expect(threadLinks).toHaveLength(1)
				const threadId = threadLinks[0]!.hazelChannelId
				expect(rows(world.org, `SELECT id FROM channels WHERE type = 'thread'`)).toHaveLength(1)
				// The parent message points at its thread; the replies live in the thread.
				expect(
					rows<{ content: string; threadChannelId: string | null }>(
						world.channel,
						`SELECT content, threadChannelId FROM messages`,
					),
				).toEqual([{ content: "parent", threadChannelId: threadId }])
				const thread = yield* world.objects.get(channelTarget(threadId as ChannelId))
				expect(
					rows<{ content: string }>(
						thread,
						`SELECT content FROM messages ORDER BY createdAt, rowid`,
					),
				).toEqual([{ content: "first reply" }, { content: "second reply" }])
				// Nothing went back out to Slack.
				expect(world.objects.chatSyncCalls).toEqual([])
			}),
		))

	it("a Hazel thread on a synced message posts its replies into the Slack thread", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const sent = (yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: "Plan for Friday",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)) as { data: { id: MessageId } }
				const posted = world.objects.chatSyncCalls.find((c) => c.op === "createMessage")
				expect(posted?.externalChannelId).toBe(SLACK_CHANNEL)

				const threadId = uuid() as ChannelId
				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"channel.createThread",
						new CreateThreadRequest({
							id: threadId,
							messageId: sent.data.id,
							organizationId: world.orgId,
							channelId: world.channelId,
						}),
						world.owner,
					),
				)
				yield* world.channel.alarm
				const thread = yield* world.objects.get(channelTarget(threadId))
				yield* ok(
					yield* call(
						thread,
						threadId,
						"message.create",
						{
							channelId: threadId,
							content: "yes",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				const parentTs = rows<{ externalMessageId: string }>(
					world.channel,
					`SELECT externalMessageId FROM chat_sync_message_links WHERE hazelMessageId = ?`,
					sent.data.id,
				)[0]!.externalMessageId
				expect(world.objects.chatSyncCalls.at(-1)).toEqual({
					op: "createMessage",
					externalChannelId: `${SLACK_CHANNEL}/${parentTs}`,
					content: "yes",
				})
			}),
		))
})
