/**
 * Slack chat sync across the objects (node SQLite): a connection only to the workspace the org
 * installed in; a new link prepared (the bot joins); Events API deliveries turned into inbound
 * events (own posts dropped, a first reply makes a Hazel thread on its parent); Hazel replies in
 * a thread posted to `<channel>/<thread ts>`.
 */
import { CurrentUser } from "@hazel/domain"
import { CreateThreadRequest } from "@hazel/domain/rpc"
import type { Slack } from "@hazel/integrations"
import type { ChannelId, MessageId, OrganizationId, SyncConnectionId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../../../rpc/dispatch"
import { channelTarget, orgTarget } from "../../../../worker/objects/kinds"
import { encodeInvokePrincipal } from "../../../../worker/objects/principal"
import { ObjectStubs } from "../../../../worker/objects/protocol"
import { makeTestObjects, type TestObject } from "../../../../worker/objects/testing"
import { routeChatSyncInbound } from "../../chat-sync-inbound"
import { type SlackUserLookup, slackInbound } from "./events"

const TEAM = "T0HAZEL01"
const SLACK_CHANNEL = "C0GENERAL1"
const APP = "A0HAZELAPP"
const BOT_USER = "U0HAZELBOT"

const uuid = () => crypto.randomUUID()

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

const call = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, user: string) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	})

const ok = <A>(exit: Exit.Exit<A, unknown>) =>
	Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.die(Cause.pretty(exit.cause))

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const rows = <T>(object: TestObject, sql: string, ...params: Array<string>) =>
	object.storage.db.prepare(sql).all(...params) as Array<T>

const lookupUser: SlackUserLookup = (userId) =>
	Effect.succeed(
		Option.some({ externalUserId: userId as never, displayName: `Slack ${userId}`, avatarUrl: null }),
	)

const envelope = (eventId: string): Extract<Slack.SlackEnvelope, { readonly _tag: "EventCallback" }> => ({
	_tag: "EventCallback",
	team_id: TEAM,
	api_app_id: APP,
	event_id: eventId,
	event_time: 1_700_000_000,
	event: null,
	authorizations: [{ team_id: TEAM, user_id: BOT_USER, is_bot: true }],
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

/** An org installed in `TEAM`, a channel, and a Slack connection with a link for it. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const owner = uuid() as UserId
	const org = yield* objects.get(orgTarget(orgId))
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	db.prepare(
		`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'Olive', 'Owner')`,
	).run(owner, `ext-${owner}`, `${owner}@example.com`)
	db.prepare(`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'owner')`).run(
		orgId,
		owner,
	)
	db.prepare(
		`INSERT INTO integration_connections (provider, organizationId, level, status, connectedBy, externalAccountId)
		 VALUES ('slack', ?, 'organization', 'active', ?, ?)`,
	).run(orgId, owner, TEAM)

	const created = (yield* ok(
		yield* call(
			org,
			orgId,
			"channel.create",
			{
				name: "general",
				icon: null,
				type: "public",
				organizationId: orgId,
				parentChannelId: null,
				sectionId: null,
			},
			owner,
		),
	)) as { data: { id: ChannelId } }
	const connectTo = (externalWorkspaceId: string) =>
		call(
			org,
			orgId,
			"chatSync.connection.create",
			{ organizationId: orgId, provider: "slack", externalWorkspaceId, externalWorkspaceName: "Acme" },
			owner,
		)
	const connection = (yield* ok(yield* connectTo(TEAM))) as { data: { id: SyncConnectionId } }
	yield* ok(
		yield* call(
			org,
			orgId,
			"chatSync.channelLink.create",
			{
				organizationId: orgId,
				syncConnectionId: connection.data.id,
				hazelChannelId: created.data.id,
				externalChannelId: SLACK_CHANNEL,
			},
			owner,
		),
	)
	const stubs = Layer.succeed(ObjectStubs, objects.stubs)
	const inbound = (eventId: string, event: Slack.SlackEvent) =>
		Effect.gen(function* () {
			const found = yield* slackInbound(envelope(eventId), event, lookupUser)
			if (Option.isSome(found)) yield* routeChatSyncInbound(found.value)
		}).pipe(Effect.provide(stubs), Effect.provideContext(objects.directory), Effect.orDie)
	return {
		objects,
		org,
		orgId,
		owner,
		channelId: created.data.id,
		channel: yield* objects.get(channelTarget(created.data.id)),
		connectTo,
		inbound,
	}
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
