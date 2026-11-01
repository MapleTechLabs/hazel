/**
 * Chat sync across the objects (node SQLite): link CRUD keeping the directory's
 * `chat_sync_index` and the channel's links current; inbound Discord events routed by the index
 * through the `OrgObject` into the `ChannelObject` (dedupe, a new provider user, edits, deletes,
 * reactions); outbound `chatSync.outbound` for Hazel writes and none for inbound ones.
 */
import { CurrentUser } from "@hazel/domain"
import { CreateThreadRequest } from "@hazel/domain/rpc"
import { SQLite, schema } from "@hazel/db"
import type {
	ChannelId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	ExternalUserId,
	MessageId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Exit, Layer, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { callObject } from "../../worker/objects/calls"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { ConnectIntegrationCall, DisconnectIntegrationCall } from "../../worker/objects/org/integrations"
import { encodeInvokePrincipal } from "../../worker/objects/principal"
import { ObjectStubs } from "../../worker/objects/protocol"
import { makeTestObjects, type TestObject, type TestObjects } from "../../worker/objects/testing"
import { Directory } from "../directory"
import { readChatSyncLinks } from "./chat-sync-channel"
import { type ChatSyncInbound, routeChatSyncInbound } from "./chat-sync-inbound"
import { createDiscordGatewayDispatchHandlers } from "./providers/discord/gateway-dispatch"

const uuid = () => crypto.randomUUID()
const GUILD = "111111111111111111"
const DISCORD_CHANNEL = "222222222222222222" as ExternalChannelId

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

interface World {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly channel: TestObject
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly channelId: ChannelId
	readonly syncConnectionId: SyncConnectionId
	readonly channelLinkId: SyncChannelLinkId
	/** Route a Discord event the way the gateway object does. */
	readonly inbound: (event: ChatSyncInbound) => Effect.Effect<void>
	readonly index: () => Effect.Effect<
		ReadonlyArray<{ externalChannelId: string | null; channelId: string | null }>
	>
}

/** An org with an owner, a public channel, a Discord connection and a link for the channel. */
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
		`INSERT INTO integration_connections (provider, organizationId, level, status, connectedBy)
		 VALUES ('discord', ?, 'organization', 'active', ?)`,
	).run(orgId, owner)

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
	const channelId = created.data.id

	const connection = (yield* ok(
		yield* call(
			org,
			orgId,
			"chatSync.connection.create",
			{
				organizationId: orgId,
				provider: "discord",
				externalWorkspaceId: GUILD,
				externalWorkspaceName: "Guild",
			},
			owner,
		),
	)) as { data: { id: SyncConnectionId } }
	const link = (yield* ok(
		yield* call(
			org,
			orgId,
			"chatSync.channelLink.create",
			{
				organizationId: orgId,
				syncConnectionId: connection.data.id,
				hazelChannelId: channelId,
				externalChannelId: DISCORD_CHANNEL,
			},
			owner,
		),
	)) as { data: { id: SyncChannelLinkId } }

	const stubs = Layer.succeed(ObjectStubs, objects.stubs)
	const inbound = (event: ChatSyncInbound) =>
		routeChatSyncInbound(event).pipe(
			Effect.provide(stubs),
			Effect.provideContext(objects.directory),
			Effect.orDie,
		)
	const index = () =>
		Effect.flatMap(Directory, (directory) =>
			directory.db.run(
				SQLite.from(schema.chatSyncIndexTable)
					.select("externalChannelId", "channelId")
					.where(($) => [$.organizationId.eq(orgId)]),
			),
		).pipe(Effect.provideContext(objects.directory), Effect.orDie)

	return {
		objects,
		org,
		channel: yield* objects.get(channelTarget(channelId)),
		orgId,
		owner,
		channelId,
		syncConnectionId: connection.data.id,
		channelLinkId: link.data.id,
		inbound,
		index,
	} satisfies World
})

const discordCreate = (
	messageId: string,
	content: string,
	authorId = "333333333333333333",
): ChatSyncInbound => ({
	provider: "discord",
	externalChannelId: DISCORD_CHANNEL,
	dedupeKey: `discord:gateway:create:${messageId}`,
	author: { externalUserId: authorId as ExternalUserId, displayName: "Dana Discord", avatarUrl: null },
	event: {
		_tag: "MessageCreate",
		externalMessageId: messageId as ExternalMessageId,
		externalWebhookId: null,
		content,
		externalReplyToMessageId: null,
		attachments: [],
	},
})

const rows = <T>(object: TestObject, sql: string, ...params: Array<string>) =>
	object.storage.db.prepare(sql).all(...params) as Array<T>

const chatSyncOutbox = (object: TestObject) =>
	rows<{ n: number }>(object, `SELECT count(*) AS n FROM _outbox WHERE target = 'chat-sync'`)[0]!.n

describe("chat sync on the objects", () => {
	it("link CRUD keeps the directory index and the channel's links current", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const indexed = yield* world.index()
				expect(indexed.map((row) => row.externalChannelId).sort()).toEqual(
					[DISCORD_CHANNEL, null].sort(),
				)
				expect(indexed.find((row) => row.externalChannelId === DISCORD_CHANNEL)?.channelId).toBe(
					world.channelId,
				)

				const links = yield* world.channel.run(readChatSyncLinks)
				expect(links.links.map((link) => link.channelLinkId)).toEqual([world.channelLinkId])
				expect(links.links[0]?.direction).toBe("both")

				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.update",
						{
							organizationId: world.orgId,
							syncChannelLinkId: world.channelLinkId,
							direction: "external_to_hazel",
						},
						world.owner,
					),
				)
				expect((yield* world.channel.run(readChatSyncLinks)).links[0]?.direction).toBe(
					"external_to_hazel",
				)

				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.delete",
						{ organizationId: world.orgId, syncChannelLinkId: world.channelLinkId },
						world.owner,
					),
				)
				expect((yield* world.index()).map((row) => row.externalChannelId)).toEqual([null])
				expect((yield* world.channel.run(readChatSyncLinks)).links).toEqual([])

				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.connection.delete",
						{ organizationId: world.orgId, syncConnectionId: world.syncConnectionId },
						world.owner,
					),
				)
				expect(yield* world.index()).toEqual([])
			}),
		))

	it("inbound create maps a new Discord user, is deduped, and is not echoed back", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.inbound(discordCreate("444444444444444441", "hi from discord"))
				yield* world.inbound(discordCreate("444444444444444441", "hi from discord"))

				const messages = rows<{ id: string; content: string; authorId: string }>(
					world.channel,
					`SELECT id, content, authorId FROM messages`,
				)
				expect(messages.map((m) => m.content)).toEqual(["hi from discord"])
				const links = rows<{ hazelMessageId: string; source: string }>(
					world.channel,
					`SELECT hazelMessageId, source FROM chat_sync_message_links`,
				)
				expect(links).toEqual([{ hazelMessageId: messages[0]!.id, source: "external" }])

				// The provider user: a directory shadow, projected and made a member of the org.
				const shadow = yield* Effect.flatMap(Directory, (directory) =>
					directory.db.first(
						SQLite.from(schema.usersTable)
							.select("id", "userType", "firstName")
							.where(($) => [$.externalId.eq("discord-user-333333333333333333")]),
					),
				).pipe(Effect.provideContext(world.objects.directory), Effect.orDie)
				expect(shadow._tag).toBe("Some")
				const shadowId = shadow._tag === "Some" ? shadow.value.id : ""
				expect(messages[0]!.authorId).toBe(shadowId)
				expect(rows(world.org, `SELECT id FROM users WHERE id = ?`, shadowId)).toHaveLength(1)
				expect(
					rows(
						world.org,
						`SELECT id FROM organization_members WHERE userId = ? AND deletedAt IS NULL`,
						shadowId,
					),
				).toHaveLength(1)

				// No echo: nothing queued for, or sent to, Discord.
				expect(chatSyncOutbox(world.channel)).toBe(0)
				expect(world.objects.chatSyncCalls).toEqual([])
				// One receipt: the redelivery was deduped.
				expect(
					rows(world.channel, `SELECT id FROM chat_sync_event_receipts WHERE source = 'external'`),
				).toHaveLength(1)
			}),
		))

	it("inbound update, reactions and delete follow the message link, each once", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const externalMessageId = "444444444444444442" as ExternalMessageId
				yield* world.inbound(discordCreate(externalMessageId, "original"))
				const update: ChatSyncInbound = {
					provider: "discord",
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:update:${externalMessageId}:v1`,
					author: null,
					event: {
						_tag: "MessageUpdate",
						externalMessageId,
						externalWebhookId: null,
						content: "edited",
					},
				}
				yield* world.inbound(update)
				expect(rows<{ content: string }>(world.channel, `SELECT content FROM messages`)).toEqual([
					{ content: "edited" },
				])

				const reactor = {
					externalUserId: "555555555555555555" as ExternalUserId,
					displayName: "Rae",
					avatarUrl: null,
				}
				const reaction = (tag: "ReactionAdd" | "ReactionRemove"): ChatSyncInbound => ({
					provider: "discord",
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:reaction:${tag}:${externalMessageId}:${reactor.externalUserId}:🔥`,
					author: reactor,
					event: { _tag: tag, externalMessageId, emoji: "🔥" },
				})
				yield* world.inbound(reaction("ReactionAdd"))
				yield* world.inbound(reaction("ReactionAdd"))
				expect(rows(world.channel, `SELECT id FROM message_reactions`)).toHaveLength(1)
				yield* world.inbound(reaction("ReactionRemove"))
				expect(rows(world.channel, `SELECT id FROM message_reactions`)).toHaveLength(0)

				yield* world.inbound({
					provider: "discord",
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:delete:${externalMessageId}`,
					author: null,
					event: { _tag: "MessageDelete", externalMessageId, externalWebhookId: null },
				})
				expect(
					rows<{ deletedAt: string | null }>(world.channel, `SELECT deletedAt FROM messages`)[0]
						?.deletedAt,
				).not.toBeNull()
				expect(world.objects.chatSyncCalls).toEqual([])

				// An event for an unindexed channel goes nowhere.
				yield* world.inbound({
					...discordCreate("444444444444444449", "elsewhere"),
					externalChannelId: "999999999999999999" as ExternalChannelId,
				})
				expect(rows(world.channel, `SELECT id FROM messages`)).toHaveLength(1)
			}),
		))

	it("a Hazel message and its reaction go out to Discord once, through the channel's outbox", () =>
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
							content: "hello discord",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)) as { data: { id: string } }
				expect(world.objects.chatSyncCalls).toEqual([
					{ op: "createMessage", externalChannelId: DISCORD_CHANNEL, content: "hello discord" },
				])
				const links = rows<{ hazelMessageId: string; source: string }>(
					world.channel,
					`SELECT hazelMessageId, source FROM chat_sync_message_links`,
				)
				expect(links).toEqual([{ hazelMessageId: sent.data.id, source: "hazel" }])
				expect(chatSyncOutbox(world.channel)).toBe(0)

				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"messageReaction.toggle",
						{ messageId: sent.data.id, channelId: world.channelId, emoji: "👍" },
						world.owner,
					),
				)
				expect(world.objects.chatSyncCalls.map((c) => c.op)).toEqual(["createMessage", "addReaction"])
			}),
		))

	it("a retryable Discord failure keeps the delivery queued until it succeeds", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				world.objects.setChatSyncFailure(503)
				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: "later",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				expect(chatSyncOutbox(world.channel)).toBe(1)
				world.objects.setChatSyncFailure(undefined)
				world.channel.storage.db.exec(`UPDATE _outbox SET next_at = 0`)
				yield* world.channel.alarm
				expect(chatSyncOutbox(world.channel)).toBe(0)
				expect(world.objects.chatSyncCalls.map((c) => c.op)).toEqual(["createMessage"])
			}),
		))

	it("the message link a delivery writes reaches the channel's sockets in the same request", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: "broadcast my link",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				// The link row (written by the outbound delivery, after the write's flush) is flushed too.
				expect(world.channel.synced.sync.flushedSeq()).toBe(world.channel.synced.sync.headSeq())
				expect(rows(world.channel, `SELECT id FROM chat_sync_message_links`)).toHaveLength(1)
			}),
		))

	it("a Hazel thread on a synced message becomes a Discord thread, linked like its parent", () =>
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
							content: "Shall we ship Friday?\nmore detail",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)) as { data: { id: MessageId } }
				const externalMessageId = rows<{ externalMessageId: string }>(
					world.channel,
					`SELECT externalMessageId FROM chat_sync_message_links WHERE hazelMessageId = ?`,
					sent.data.id,
				)[0]!.externalMessageId

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
				const created = world.objects.chatSyncCalls.find((c) => c.op === "createThread")
				expect(created).toEqual({
					op: "createThread",
					externalChannelId: DISCORD_CHANNEL,
					externalMessageId,
					content: "Shall we ship Friday?",
				})
				// The org link is delivered by the parent's outbox (its alarm, here).
				yield* world.channel.alarm
				const externalThreadId = rows<{ externalThreadId: string }>(
					world.channel,
					`SELECT externalThreadId FROM chat_sync_message_links WHERE hazelMessageId = ?`,
					sent.data.id,
				)[0]!.externalThreadId
				expect(externalThreadId).not.toBeNull()
				expect(
					rows(
						world.org,
						`SELECT direction FROM chat_sync_channel_links WHERE hazelChannelId = ? AND externalChannelId = ?`,
						threadId,
						externalThreadId,
					),
				).toEqual([{ direction: "both" }])
				expect(
					(yield* world.index()).find((row) => row.channelId === threadId)?.externalChannelId,
				).toBe(externalThreadId)

				// Replies in the thread go to the Discord thread.
				const thread = yield* world.objects.get(channelTarget(threadId))
				expect((yield* thread.run(readChatSyncLinks)).links.map((l) => l.externalChannelId)).toEqual([
					externalThreadId,
				])
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
				expect(world.objects.chatSyncCalls.at(-1)).toEqual({
					op: "createMessage",
					externalChannelId: externalThreadId,
					content: "yes",
				})

				// Our own THREAD_CREATE echo from the gateway is dropped (bot-owned).
				const ingested: Array<unknown> = []
				const handlers = createDiscordGatewayDispatchHandlers({
					ingest: (inbound) => Effect.sync(() => void ingested.push(inbound)),
					isCurrentBotAuthor: (id) => Effect.succeed(id === "777777777777777777"),
				})
				yield* handlers.ingestThreadCreateEvent({
					id: externalThreadId,
					parent_id: DISCORD_CHANNEL,
					name: "Shall we ship Friday?",
					type: 11,
					owner_id: "777777777777777777",
				})
				expect(ingested).toEqual([])
			}),
		))

	it("inbound mentions become Hazel mentions: a linked account, a known shadow, else the name", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* Effect.provide(
					callObject(ConnectIntegrationCall, orgTarget(world.orgId), {
						provider: "discord",
						userId: world.owner,
						connectedBy: world.owner,
						externalAccountId: "666666666666666666",
						externalAccountName: "olive",
						settings: null,
						metadata: null,
						tokens: { accessToken: "token", refreshToken: null, expiresAt: null, scope: null },
					}),
					Layer.succeed(ObjectStubs, world.objects.stubs),
				).pipe(Effect.orDie)
				// Dana writes once, so the org knows her shadow.
				yield* world.inbound(discordCreate("444444444444444450", "hello", "333333333333333333"))
				const dana = rows<{ authorId: string }>(world.channel, `SELECT authorId FROM messages`)[0]!
					.authorId

				yield* world.inbound({
					...discordCreate(
						"444444444444444451",
						"<@666666666666666666> and <@!333333333333333333> meet <@777777777777777777> or <@888888888888888888>",
						"555555555555555555",
					),
					event: {
						_tag: "MessageCreate",
						externalMessageId: "444444444444444451" as ExternalMessageId,
						externalWebhookId: null,
						content:
							"<@666666666666666666> and <@!333333333333333333> meet <@777777777777777777> or <@888888888888888888>",
						externalReplyToMessageId: null,
						attachments: [],
						mentions: [
							{ externalUserId: "777777777777777777" as ExternalUserId, displayName: "Sam" },
						],
					},
				})
				const content = rows<{ content: string }>(
					world.channel,
					`SELECT content FROM messages ORDER BY createdAt DESC, rowid DESC LIMIT 1`,
				)[0]!.content
				expect(content).toBe(
					`@[userId:${world.owner}] and @[userId:${dana}] meet @Sam or <@888888888888888888>`,
				)
			}),
		))

	it("a provider user cannot mention or broadcast to Hazel users with Hazel's own syntax", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const spoof = `hey @[directive:channel] and @[userId:${world.owner}] <@777777777777777777>`
				yield* world.inbound({
					...discordCreate("444444444444444470", spoof),
					event: {
						_tag: "MessageCreate",
						externalMessageId: "444444444444444470" as ExternalMessageId,
						externalWebhookId: null,
						content: spoof,
						externalReplyToMessageId: null,
						attachments: [],
						mentions: [
							{
								externalUserId: "777777777777777777" as ExternalUserId,
								displayName: `[userId:${world.owner}]`,
							},
						],
					},
				})
				const content = rows<{ content: string }>(world.channel, `SELECT content FROM messages`)[0]!
					.content
				expect(content).not.toMatch(/@\[(userId|directive):/)
				expect(content).toBe(
					`hey @\u200B[directive:channel] and @\u200B[userId:${world.owner}] @userId:${world.owner}`,
				)
			}),
		))

	it("a provider thread on a synced message hangs off that message, without echoing back", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const externalMessageId = "444444444444444460" as ExternalMessageId
				yield* world.inbound(discordCreate(externalMessageId, "start here"))
				yield* world.inbound({
					provider: "discord",
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:thread:create:${externalMessageId}`,
					author: null,
					event: {
						_tag: "ThreadCreate",
						externalThreadId: externalMessageId as string as ExternalThreadId,
						name: "Start here",
						externalParentMessageId: externalMessageId,
					},
				})
				// The org's link and the parent's attach are outbox deliveries.
				yield* world.org.alarm
				const threadId = rows<{ hazelChannelId: string }>(
					world.org,
					`SELECT hazelChannelId FROM chat_sync_channel_links WHERE externalChannelId = ?`,
					externalMessageId,
				)[0]!.hazelChannelId
				expect(
					rows<{ threadChannelId: string | null }>(
						world.channel,
						`SELECT threadChannelId FROM messages`,
					),
				).toEqual([{ threadChannelId: threadId }])
				expect(
					rows<{ externalThreadId: string | null }>(
						world.channel,
						`SELECT externalThreadId FROM chat_sync_message_links`,
					),
				).toEqual([{ externalThreadId: externalMessageId }])
				// Inbound: no provider thread is created back.
				expect(chatSyncOutbox(world.channel)).toBe(0)
				expect(world.objects.chatSyncCalls).toEqual([])
			}),
		))

	it("a refused sender cannot link a thread at the org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const result = yield* world.org.applyEffect({
					objectId: world.orgId,
					kind: "org.chatSyncLinkThread",
					payload: {
						channelLinkId: world.channelLinkId,
						threadChannelId: uuid(),
						externalThreadId: "888888888888888888",
						externalThreadName: "x",
					},
					key: uuid(),
					sender: { kind: "channel", id: uuid() },
				})
				expect(result._tag).toBe("Applied")
				expect(rows(world.org, `SELECT id FROM chat_sync_channel_links`)).toHaveLength(1)
			}),
		))

	it("linking and unlinking a Discord account re-projects the linked channels' accounts", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const worker = <A, E>(effect: Effect.Effect<A, E, ObjectStubs>) =>
					effect.pipe(Effect.provide(Layer.succeed(ObjectStubs, world.objects.stubs)), Effect.orDie)
				expect((yield* world.channel.run(readChatSyncLinks)).accounts).toEqual([])

				yield* worker(
					callObject(ConnectIntegrationCall, orgTarget(world.orgId), {
						provider: "discord",
						userId: world.owner,
						connectedBy: world.owner,
						externalAccountId: "666666666666666666",
						externalAccountName: "olive",
						settings: null,
						metadata: null,
						tokens: { accessToken: "token", refreshToken: null, expiresAt: null, scope: null },
					}),
				)
				expect((yield* world.channel.run(readChatSyncLinks)).accounts).toEqual([
					{ userId: world.owner, provider: "discord", externalAccountId: "666666666666666666" },
				])

				// Outbound mentions now resolve to the Discord user.
				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: `hi @[userId:${world.owner}]`,
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				expect(world.objects.chatSyncCalls.at(-1)?.content).toBe("hi <@666666666666666666>")

				yield* worker(
					callObject(DisconnectIntegrationCall, orgTarget(world.orgId), {
						provider: "discord",
						userId: world.owner,
					}),
				)
				expect((yield* world.channel.run(readChatSyncLinks)).accounts).toEqual([])
			}),
		))
})
