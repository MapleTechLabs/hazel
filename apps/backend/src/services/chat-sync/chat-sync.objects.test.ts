/**
 * Chat sync across the objects (node SQLite): link CRUD keeping the directory's
 * `chat_sync_index` and the channel's links current; inbound Discord events routed by the index
 * through the `OrgObject` into the `ChannelObject` (dedupe, a new provider user, edits, deletes,
 * reactions); outbound `chatSync.outbound` for Hazel writes and none for inbound ones.
 */
import { CreateThreadRequest } from "@hazel/domain/rpc"
import { SQLite, schema } from "@hazel/db"
import type {
	ChannelId,
	ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	ExternalUserId,
	ExternalWebhookId,
	MessageId,
	SyncChannelLinkId,
} from "@hazel/schema"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { describe, expect, it } from "vitest"
import { callObject } from "../../worker/objects/calls"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { ConnectIntegrationCall, DisconnectIntegrationCall } from "../../worker/objects/org/integrations"
import { ObjectStubs } from "../../worker/objects/protocol"
import type { TestObject } from "../../worker/objects/testing"
import { Directory } from "../directory"
import { readChatSyncLinks, writeChatSyncLinks } from "./chat-sync-channel"
import type { ChatSyncInbound } from "./chat-sync-inbound"
import { createDiscordGatewayDispatchHandlers } from "./providers/discord/gateway-dispatch"
import { callRpc, makeChatSyncWorld, ok, rows, runScoped } from "./testing-world"

const uuid = () => crypto.randomUUID()
const GUILD = "111111111111111111"
const DISCORD_CHANNEL = "222222222222222222" as ExternalChannelId

const call = callRpc
const run = runScoped

/** An org with an owner, a public channel, a Discord connection and a link for the channel. */
const makeWorld = Effect.gen(function* () {
	const world = yield* makeChatSyncWorld({
		provider: "discord",
		workspaceId: GUILD,
		externalChannelId: DISCORD_CHANNEL,
	})
	/** The org's rows in the directory's `chat_sync_index`. */
	const index = () =>
		Effect.flatMap(Directory, (directory) =>
			directory.db.run(
				SQLite.from(schema.chatSyncIndexTable)
					.select("externalChannelId", "channelId")
					.where(($) => [$.organizationId.eq(world.orgId)]),
			),
		).pipe(Effect.provideContext(world.objects.directory), Effect.orDie)
	return { ...world, index }
})

const discordCreate = (
	messageId: string,
	content: string,
	authorId = "333333333333333333",
): ChatSyncInbound => ({
	provider: "discord",
	externalWorkspaceIds: [GUILD],
	externalChannelId: DISCORD_CHANNEL,
	dedupeKey: `discord:gateway:create:${messageId}`,
	author: {
		externalUserId: authorId as ExternalUserId,
		displayName: "Dana Discord",
		avatarUrl: null,
		email: null,
		externalWorkspaceId: GUILD,
	},
	event: {
		_tag: "MessageCreate",
		externalMessageId: messageId as ExternalMessageId,
		externalWebhookId: null,
		content,
		externalReplyToMessageId: null,
		attachments: [],
	},
})

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

	it(
		"a new link imports the channel's history in pages, backdated and silent",
		() =>
			run(
				Effect.gen(function* () {
					const world = yield* makeWorld
					const HISTORY_CHANNEL = "555555555555555555" as ExternalChannelId
					const start = Date.UTC(2026, 0, 1)
					// 120 past messages, oldest first, a minute apart; the link asks for the last 110.
					const past = Array.from({ length: 120 }, (_, index) => {
						const id = `60000000000000${String(index).padStart(4, "0")}`
						const message = discordCreate(id, `old ${index}`)
						return {
							...message,
							externalChannelId: HISTORY_CHANNEL,
							dedupeKey: `discord:history:${id}`,
							event: { ...message.event, sentAt: start + index * 60_000 },
						} as ChatSyncInbound
					})
					world.objects.chatSyncHistory.set(HISTORY_CHANNEL, past)

					const created = (yield* ok(
						yield* call(
							world.org,
							world.orgId,
							"channel.create",
							{
								name: "history",
								icon: null,
								type: "public",
								organizationId: world.orgId,
								parentChannelId: null,
								sectionId: null,
							},
							world.owner,
						),
					)) as { data: { id: ChannelId } }
					yield* ok(
						yield* call(
							world.org,
							world.orgId,
							"chatSync.channelLink.create",
							{
								organizationId: world.orgId,
								syncConnectionId: world.syncConnectionId,
								hazelChannelId: created.data.id,
								externalChannelId: HISTORY_CHANNEL,
								historyLimit: 110,
							},
							world.owner,
						),
					)
					const channel = yield* world.objects.get(channelTarget(created.data.id))
					const imported = () =>
						rows<{ content: string; createdAt: string }>(
							channel,
							`SELECT content, createdAt FROM messages ORDER BY createdAt, id`,
						)
					// The org's alarm until nothing due is left (one drain delivers what was due when it began).
					const drain = Effect.gen(function* () {
						for (let round = 0; round < 50; round++) {
							const due = rows<{ n: number }>(
								world.org,
								`SELECT count(*) AS n FROM _outbox WHERE status = 'pending' AND next_at <= ?`,
								String(Date.now()),
							)[0]!.n
							if (due === 0) return
							yield* Effect.sleep("2 millis")
							yield* world.org.alarm
						}
					})
					// The first page (the newest 100), then the next once Discord's pause is over.
					yield* drain
					world.org.storage.db.exec(`UPDATE _outbox SET next_at = 0 WHERE status = 'pending'`)
					yield* drain

					const messages = imported()
					expect(messages.map((message) => message.content)).toEqual(
						past.slice(10).map((message) => (message.event as { content: string }).content),
					)
					// Stored as UTC without a zone (`2026-01-01 00:10:00.000`).
					expect(Date.parse(`${messages[0]!.createdAt.replace(" ", "T")}Z`)).toBe(
						start + 10 * 60_000,
					)
					expect(
						world.objects.chatSyncCalls.filter((entry) => entry.op === "fetchHistory"),
					).toHaveLength(2)
					// Old news: no notifications, no bot events, nothing synced back to Discord.
					expect(
						world.objects.deliveries.filter(
							(delivery) =>
								delivery.includes("org.messageCreated") ||
								delivery.includes("botGateway.messageEvent"),
						),
					).toEqual([])
					expect(chatSyncOutbox(channel)).toBe(0)

					// Importing again changes nothing: each message is linked once.
					yield* world.inbound(past[119]!)
					expect(imported()).toHaveLength(110)
				}),
			),
		// Two pages of real ingests (110 messages through the org and the channel).
		30_000,
	)

	it("inbound update, reactions and delete follow the message link, each once", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const externalMessageId = "444444444444444442" as ExternalMessageId
				yield* world.inbound(discordCreate(externalMessageId, "original"))
				const update: ChatSyncInbound = {
					provider: "discord",
					externalWorkspaceIds: [GUILD],
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
					email: null,
					externalWorkspaceId: GUILD,
				}
				const reaction = (tag: "ReactionAdd" | "ReactionRemove"): ChatSyncInbound => ({
					provider: "discord",
					externalWorkspaceIds: [GUILD],
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
					externalWorkspaceIds: [GUILD],
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

	it("a channel holding links from before their version asks the org for fresh ones, then posts", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				// A copy projected before this version (a thread's carried its parent's webhook).
				const current = yield* world.channel.run(readChatSyncLinks)
				yield* world.channel.run(
					writeChatSyncLinks({ links: current.links, accounts: current.accounts }),
				)
				yield* ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.create",
						{
							channelId: world.channelId,
							content: "after deploy",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: world.owner,
							deletedAt: null,
						},
						world.owner,
					),
				)
				// Held, not sent with the old copy; the org projects a fresh one.
				expect(world.objects.chatSyncCalls).toEqual([])
				expect(chatSyncOutbox(world.channel)).toBe(1)
				yield* world.channel.alarm
				yield* world.org.alarm
				expect((yield* world.channel.run(readChatSyncLinks)).version).toBe(2)

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
					threadOf: () => Effect.succeed(Option.none()),
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

	it("mentioning a provider user's shadow pings them on that provider", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				// Dana writes once from Discord, so the org knows her shadow.
				yield* world.inbound(discordCreate("444444444444444480", "hello", "333333333333333333"))
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
				expect(world.objects.chatSyncCalls.at(-1)?.content).toBe("ping <@333333333333333333>")
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
					externalWorkspaceIds: [GUILD],
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

	it("a Discord thread's first message lands even before the thread's own event, which then names it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const starter = "444444444444444470" as ExternalMessageId
				const externalThreadId = starter as string as ExternalThreadId
				yield* world.inbound(discordCreate(starter, "test back"))
				// The gateway routes a thread's message by its parent channel, naming the thread, so it
				// does not wait on the thread's own link being indexed.
				yield* world.inbound({
					...discordCreate("444444444444444471", "a thread"),
					event: {
						_tag: "MessageCreate",
						externalMessageId: "444444444444444471" as ExternalMessageId,
						externalWebhookId: null,
						content: "a thread",
						externalReplyToMessageId: null,
						attachments: [],
						inExternalThreadId: externalThreadId,
					},
				})
				yield* world.inbound({
					provider: "discord",
					externalWorkspaceIds: [GUILD],
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:thread:create:${externalThreadId}`,
					author: null,
					event: {
						_tag: "ThreadCreate",
						externalThreadId,
						name: "Ship plan",
						externalParentMessageId: starter,
					},
				})
				yield* world.org.alarm

				const links = rows<{ hazelChannelId: ChannelId; externalChannelName: string | null }>(
					world.org,
					`SELECT hazelChannelId, externalChannelName FROM chat_sync_channel_links WHERE externalChannelId = ?`,
					externalThreadId,
				)
				expect(links).toHaveLength(1)
				const threadId = links[0]!.hazelChannelId
				expect(links[0]!.externalChannelName).toBe("Ship plan")
				expect(rows(world.org, `SELECT name FROM channels WHERE id = ?`, threadId)).toEqual([
					{ name: "Ship plan" },
				])
				const thread = yield* world.objects.get(channelTarget(threadId))
				expect(rows(thread, `SELECT content FROM messages`)).toEqual([{ content: "a thread" }])
				expect(rows(world.channel, `SELECT content, threadChannelId FROM messages`)).toEqual([
					{ content: "test back", threadChannelId: threadId },
				])
			}),
		))

	it("a thread's link is its parent's: settings and direction follow it, and unlinking it stops the thread", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const starter = "444444444444444480" as ExternalMessageId
				yield* world.inbound(discordCreate(starter, "start here"))
				yield* world.inbound({
					provider: "discord",
					externalWorkspaceIds: [GUILD],
					externalChannelId: DISCORD_CHANNEL,
					dedupeKey: `discord:gateway:thread:create:${starter}`,
					author: null,
					event: {
						_tag: "ThreadCreate",
						externalThreadId: starter as string as ExternalThreadId,
						name: "Start here",
						externalParentMessageId: starter,
					},
				})
				yield* world.org.alarm
				const threadId = rows<{ hazelChannelId: ChannelId }>(
					world.org,
					`SELECT hazelChannelId FROM chat_sync_channel_links WHERE externalChannelId = ?`,
					starter,
				)[0]!.hazelChannelId
				// Settings list only the channel's link: it decides for its threads.
				const listed = (yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.list",
						{ organizationId: world.orgId, syncConnectionId: world.syncConnectionId },
						world.owner,
					),
				)) as { data: ReadonlyArray<{ id: string }> }
				expect(listed.data.map((link) => link.id)).toEqual([world.channelLinkId])
				// Nor can a thread be linked on its own.
				const linkThreadDirectly = yield* call(
					world.org,
					world.orgId,
					"chatSync.channelLink.create",
					{
						organizationId: world.orgId,
						syncConnectionId: world.syncConnectionId,
						hazelChannelId: threadId,
						externalChannelId: "888888888888888888",
					},
					world.owner,
				)
				expect(
					Exit.isFailure(linkThreadDirectly) && Cause.pretty(linkThreadDirectly.cause),
				).toContain("ChannelNotFoundError")

				const thread = yield* world.objects.get(channelTarget(threadId))
				const threadLinks = () =>
					thread.run(readChatSyncLinks).pipe(Effect.map((value) => value.links))

				// The parent's identity changes (a webhook provisioned): its threads see it.
				const webhookId = "555555555555555555"
				const settings = {
					outboundIdentity: {
						strategy: "webhook",
						providers: { discord: { kind: "discord.webhook", webhookId, webhookToken: "t" } },
					},
				}
				yield* world.org.applyEffect({
					objectId: world.orgId,
					kind: "org.chatSyncLinkSettings",
					payload: { channelLinkId: world.channelLinkId, settings },
					key: uuid(),
					sender: { kind: "channel", id: world.channelId },
				})
				yield* world.org.alarm
				const [linked] = yield* threadLinks()
				expect(linked).toMatchObject({
					externalChannelId: starter,
					settings,
					parent: { channelLinkId: world.channelLinkId, externalChannelId: DISCORD_CHANNEL },
				})

				// An event routed by the thread's own id (the gateway could not resolve its parent)
				// still lands, and still knows the parent's webhook for an echo.
				const byThreadId = (id: string, externalWebhookId: string | null): ChatSyncInbound => ({
					...discordCreate(id, `via ${id}`),
					externalChannelId: starter as string as ExternalChannelId,
					event: {
						_tag: "MessageCreate",
						externalMessageId: id as ExternalMessageId,
						externalWebhookId: externalWebhookId as ExternalWebhookId | null,
						content: `via ${id}`,
						externalReplyToMessageId: null,
						attachments: [],
					},
				})
				yield* world.inbound(byThreadId("444444444444444481", webhookId))
				yield* world.inbound(byThreadId("444444444444444482", null))
				yield* world.org.alarm
				expect(rows(thread, `SELECT content FROM messages`)).toEqual([
					{ content: "via 444444444444444482" },
				])

				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.update",
						{ syncChannelLinkId: world.channelLinkId, direction: "external_to_hazel" },
						world.owner,
					),
				)
				yield* world.org.alarm
				expect((yield* threadLinks()).map((link) => link.direction)).toEqual(["external_to_hazel"])

				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.delete",
						{ syncChannelLinkId: world.channelLinkId },
						world.owner,
					),
				)
				yield* world.org.alarm
				expect(yield* threadLinks()).toEqual([])
				// The thread's link went with its channel's, out of the index too.
				expect(
					rows<{ deletedAt: string | null }>(
						world.org,
						`SELECT deletedAt FROM chat_sync_channel_links WHERE hazelChannelId = ?`,
						threadId,
					)[0]!.deletedAt,
				).not.toBeNull()
				expect((yield* world.index()).some((row) => row.channelId === threadId)).toBe(false)

				// Linked again, to another Discord channel: an old thread link (one left from before
				// unlinking took threads along) does not take the new link as its parent.
				const relinked = (yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.create",
						{
							organizationId: world.orgId,
							syncConnectionId: world.syncConnectionId,
							hazelChannelId: world.channelId,
							externalChannelId: "999999999999999999",
						},
						world.owner,
					),
				)) as { data: { id: SyncChannelLinkId } }
				world.org.storage.db
					.prepare(
						`UPDATE chat_sync_channel_links SET deletedAt = NULL, isActive = 1 WHERE hazelChannelId = ?`,
					)
					.run(threadId)
				// Any change to the channel's link projects its threads again.
				yield* ok(
					yield* call(
						world.org,
						world.orgId,
						"chatSync.channelLink.update",
						{ syncChannelLinkId: relinked.data.id, direction: "both" },
						world.owner,
					),
				)
				yield* world.org.alarm
				expect(yield* threadLinks()).toEqual([])
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
