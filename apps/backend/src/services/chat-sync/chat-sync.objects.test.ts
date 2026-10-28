/**
 * Chat sync across the objects (node SQLite): link CRUD keeping the directory's
 * `chat_sync_index` and the channel's links current; inbound Discord events routed by the index
 * through the `OrgObject` into the `ChannelObject` (dedupe, a new provider user, edits, deletes,
 * reactions); outbound `chatSync.outbound` for Hazel writes and none for inbound ones.
 */
import { CurrentUser } from "@hazel/domain"
import { SQLite, schema } from "@hazel/db"
import type {
	ChannelId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalUserId,
	OrganizationId,
	SyncChannelLinkId,
	SyncConnectionId,
	UserId,
} from "@hazel/schema"
import { Cause, Effect, Exit, Layer, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { encodeInvokePrincipal } from "../../worker/objects/principal"
import { ObjectStubs } from "../../worker/objects/protocol"
import { makeTestObjects, type TestObject, type TestObjects } from "../../worker/objects/testing"
import { Directory } from "../directory"
import { readChatSyncLinks } from "./chat-sync-channel"
import { routeDiscordInbound } from "./discord-gateway-service"
import type { DiscordInbound } from "./discord-gateway-shared"

const uuid = () => crypto.randomUUID()
const GUILD = "111111111111111111"
const DISCORD_CHANNEL = "222222222222222222" as ExternalChannelId

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		organizationId: null,
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
	readonly inbound: (event: DiscordInbound) => Effect.Effect<void>
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
	const inbound = (event: DiscordInbound) =>
		routeDiscordInbound(event).pipe(
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
): DiscordInbound => ({
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
				const update: DiscordInbound = {
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
				const reaction = (tag: "ReactionAdd" | "ReactionRemove"): DiscordInbound => ({
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
})
