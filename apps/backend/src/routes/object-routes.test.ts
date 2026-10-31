/**
 * The api Worker's HTTP routes that write into the objects, on node SQLite (`makeTestObjects`):
 * the public API's message create (HTTP, bot token), an incoming webhook, and a GitHub push.
 * Each must land in the channel's `ChannelObject` with `message.create`'s side effects.
 */
import { createHash } from "node:crypto"
import { NodeHttpPlatform, NodeServices } from "@effect/platform-node"
import { BotRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { BotsApiGroup, MessagesApiGroup } from "@hazel/domain/http"
import type { BotId, ChannelId, ChannelWebhookId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Context, Effect, Exit, Layer, Option, type Scope } from "effect"
import { Etag, HttpRouter } from "effect/http"
import { HttpApi, HttpApiBuilder } from "effect/http-api"
import { describe, expect, it } from "vitest"
import { Directory } from "../services/directory"
import { RateLimiterAllowAll } from "../services/rate-limiter"
import { callObject } from "../worker/objects/calls"
import { channelTarget, orgTarget } from "../worker/objects/kinds"
import { ConnectIntegrationCall } from "../worker/objects/org/integrations"
import { ObjectStubs } from "../worker/objects/protocol"
import { makeTestObjects, type TestObject, type TestObjects } from "../worker/objects/testing"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../rpc/dispatch"
import { encodeInvokePrincipal } from "../worker/objects/principal"
import { HttpApiV1BotsLive } from "./api-v1/bots.http"
import { HttpMessagesApiLive } from "./api-v1/messages.http"
import { deliverWebhook } from "./incoming-webhooks.http"
import { dispatchGitHubEvent } from "./webhooks.http"

const uuid = () => crypto.randomUUID()
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

interface World {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly orgId: OrganizationId
	readonly alice: UserId
	readonly channelId: ChannelId
	readonly channel: TestObject
	/** Run against the test objects as the api Worker would (stubs, directory). */
	readonly worker: <A, E>(effect: Effect.Effect<A, E, ObjectStubs | Directory>) => Effect.Effect<A, E>
}

/** An org with alice, one public channel whose viewers include `extraViewers`. */
const makeWorld = (
	extraViewers: ReadonlyArray<UserId> = [],
	bots: ReadonlyArray<{ botId: BotId; botUserId: UserId }> = [],
) =>
	Effect.gen(function* () {
		const objects = yield* makeTestObjects
		const orgId = uuid() as OrganizationId
		const alice = uuid() as UserId
		const channelId = uuid() as ChannelId
		const org = yield* objects.get(orgTarget(orgId))
		const db = org.storage.db
		db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
		for (const userId of [alice, ...extraViewers]) {
			db.prepare(
				`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
			).run(uuid(), orgId, userId)
		}
		db.prepare(
			`INSERT INTO channels (id, name, type, organizationId) VALUES (?, 'general', 'public', ?)`,
		).run(channelId, orgId)
		db.prepare(`INSERT INTO channel_members (channelId, userId, isMuted) VALUES (?, ?, 0)`).run(
			channelId,
			alice,
		)
		const channel = yield* objects.get(channelTarget(channelId))
		const applied = yield* channel.applyEffect({
			objectId: channelId,
			kind: "channel.setViewers",
			payload: {
				organizationId: orgId,
				conversationId: null,
				viewers: [alice, ...extraViewers].map((userId) => ({
					userId,
					organizationId: orgId,
					role: "member",
				})),
				bots,
			},
			key: `viewers:${channelId}`,
			sender: { kind: "org", id: orgId },
		})
		expect(applied._tag).toBe("Applied")
		const directory = Context.get(objects.directory, Directory)
		yield* directory.upsertChannel({
			channelId,
			organizationId: orgId,
			hostChannelId: null,
			deletedAt: null,
		})
		const worker = <A, E>(effect: Effect.Effect<A, E, ObjectStubs | Directory>) =>
			effect.pipe(
				Effect.provideService(ObjectStubs, objects.stubs),
				Effect.provideContext(objects.directory),
			)
		return { objects, org, orgId, alice, channelId, channel, worker } satisfies World
	}).pipe(Effect.orDie)

const messagesIn = (object: TestObject) =>
	object.storage.db
		.prepare(`SELECT id, authorId, content, embeds FROM messages ORDER BY createdAt`)
		.all() as Array<{
		id: string
		authorId: string
		content: string
		embeds: string | null
	}>

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

/** The public bot API over `world`'s objects, authenticated as the bot holding `token`. */
const botHttp = (world: World, token: string) =>
	Effect.gen(function* () {
		const directory = Context.get(world.objects.directory, Directory)
		const routes = Layer.mergeAll(HttpMessagesApiLive, HttpApiV1BotsLive).pipe(
			Layer.provideMerge(BotRepo.layer),
			Layer.provideMerge(Layer.succeed(Database.Database, directory.db)),
			Layer.provideMerge(Layer.succeedContext(world.objects.directory)),
			Layer.provideMerge(Layer.succeed(ObjectStubs, world.objects.stubs)),
			Layer.provideMerge(RateLimiterAllowAll),
		)
		const app = HttpApiBuilder.layer(
			HttpApi.make("HazelApp").add(MessagesApiGroup).add(BotsApiGroup),
		).pipe(
			Layer.provideMerge(routes),
			Layer.provideMerge(HttpRouter.layer),
			Layer.provideMerge(Etag.layer),
			Layer.provideMerge(NodeServices.layer),
			Layer.provideMerge(NodeHttpPlatform.layer),
		)
		const { handler, dispose } = HttpRouter.toWebHandler(app as never, { disableLogger: true })
		yield* Effect.addFinalizer(() => Effect.promise(() => dispose()))
		const request = (path: string, init: RequestInit = {}) =>
			Effect.promise(() =>
				handler(
					new Request(`http://localhost${path}`, {
						...init,
						headers: {
							authorization: `Bearer ${token}`,
							"content-type": "application/json",
						},
					}),
					Context.empty() as Context.Context<any>,
				),
			)
		const json = (response: Response) =>
			Effect.promise(async () => {
				if (response.status !== 200) {
					throw new Error(`${response.status} ${response.url}: ${await response.text()}`)
				}
				return (await response.json()) as any
			})
		return { request, json }
	})

/** A directory bot row for `botId`, authenticated by `token`. */
const insertDirectoryBot = (
	world: World,
	bot: { botId: BotId; botUserId: UserId; token: string; scopes?: ReadonlyArray<string> },
) =>
	Context.get(world.objects.directory, Directory)
		.db.run(
			SQLite.insertInto(schema.botsTable).values({
				id: bot.botId,
				userId: bot.botUserId,
				createdBy: world.alice,
				name: "Helper",
				apiTokenHash: sha256(bot.token),
				scopes: bot.scopes === undefined ? null : [...bot.scopes],
			}),
		)
		.pipe(Effect.orDie)

/** Run `tag` on `object` as `userId`, the way the api Worker forwards it. */
const invokeAs = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, userId: UserId) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({
				user: new CurrentUser.Schema({
					id: userId,
					organizationId: null,
					role: "member",
					email: `${userId}@example.com`,
					isOnboarded: true,
					timezone: null,
					settings: null,
				}),
				botScopes: null,
			}),
		})
		return yield* decodeExit(rpc, structuredClone(response).exit)
	}).pipe(Effect.orDie)

describe("public API (v1) messages", () => {
	it("creates a bot's message in the ChannelObject, with its bot gateway event", async () => {
		const botId = uuid() as BotId
		const botUserId = uuid() as UserId
		const token = `hzl_bot_${uuid()}`

		await run(
			Effect.gen(function* () {
				const world = yield* makeWorld([botUserId], [{ botId, botUserId }])
				yield* insertDirectoryBot(world, { botId, botUserId, token })
				const { request, json } = yield* botHttp(world, token)

				const body = yield* json(
					yield* request("/api/v1/messages", {
						method: "POST",
						body: JSON.stringify({
							channelId: world.channelId,
							content: "deployed",
							replyToMessageId: null,
							threadChannelId: null,
							embeds: null,
						}),
					}),
				)
				expect(String(body.transactionId).startsWith(`channel:${world.channelId}:`)).toBe(true)
				expect(messagesIn(world.channel)).toMatchObject([
					{ id: body.data.id, authorId: botUserId, content: "deployed" },
				])
				expect(world.objects.published).toMatchObject([
					{ botId, envelope: { eventType: "message.create" } },
				])

				// A message id alone cannot be routed: the update must name its channel.
				const unrouted = yield* request(`/api/v1/messages/${body.data.id}`, {
					method: "PATCH",
					body: JSON.stringify({ content: "edited" }),
				})
				expect(unrouted.status).toBe(404)

				yield* json(
					yield* request(`/api/v1/messages/${body.data.id}`, {
						method: "PATCH",
						body: JSON.stringify({ channelId: world.channelId, content: "edited" }),
					}),
				)
				expect(messagesIn(world.channel)).toMatchObject([{ content: "edited" }])

				const listed = yield* json(yield* request(`/api/v1/messages?channel_id=${world.channelId}`))
				expect(listed.data.map((m: { id: string }) => m.id)).toEqual([body.data.id])
			}),
		)
	})
})

describe("public API (v1) for bots outside Hazel", () => {
	it("holds a bot to the scopes it declared, as RPC does", () =>
		run(
			Effect.gen(function* () {
				const botId = uuid() as BotId
				const botUserId = uuid() as UserId
				const token = `hzl_bot_${uuid()}`
				const world = yield* makeWorld([botUserId], [{ botId, botUserId }])
				yield* insertDirectoryBot(world, { botId, botUserId, token, scopes: ["messages:read"] })
				const { request } = yield* botHttp(world, token)
				const refused = yield* request("/api/v1/messages", {
					method: "POST",
					body: JSON.stringify({
						channelId: world.channelId,
						content: "not allowed",
						replyToMessageId: null,
						threadChannelId: null,
						embeds: null,
					}),
				})
				expect(refused.status).toBe(401)
				expect(messagesIn(world.channel)).toEqual([])
				const listed = yield* request(`/api/v1/messages?channel_id=${world.channelId}`)
				expect(listed.status).toBe(200)
			}),
		))

	it("a button press reaches the bot that posted it; threads and people by id", () =>
		run(
			Effect.gen(function* () {
				const botId = uuid() as BotId
				const botUserId = uuid() as UserId
				const otherBotId = uuid() as BotId
				const otherBotUserId = uuid() as UserId
				const token = `hzl_bot_${uuid()}`
				const world = yield* makeWorld(
					[botUserId, otherBotUserId],
					[
						{ botId, botUserId },
						{ botId: otherBotId, botUserId: otherBotUserId },
					],
				)
				for (const [userId, userType, name] of [
					[world.alice, "user", "Alice"],
					[botUserId, "machine", "Maple"],
				] as const) {
					world.org.storage.db
						.prepare(
							`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, ?, '', ?)`,
						)
						.run(userId, `ext-${userId}`, `${userId}@example.com`, name, userType)
				}
				yield* insertDirectoryBot(world, {
					botId,
					botUserId,
					token,
					scopes: ["messages:read", "messages:write", "channels:write"],
				})
				yield* Context.get(world.objects.directory, Directory)
					.db.run(
						SQLite.insertInto(schema.usersTable).values({
							id: botUserId,
							externalId: `bot_${botUserId}`,
							email: `${botUserId}@bot.hazel.sh`,
							firstName: "Maple",
							lastName: "",
							userType: "machine",
						}),
					)
					.pipe(Effect.orDie)
				const { request, json } = yield* botHttp(world, token)

				const posted = yield* json(
					yield* request("/api/v1/messages", {
						method: "POST",
						body: JSON.stringify({
							channelId: world.channelId,
							content: "Restart checkout?",
							replyToMessageId: null,
							threadChannelId: null,
							embeds: [
								{
									description: "Maple wants to restart checkout",
									actions: [
										{ id: "approve:call_1", label: "Approve", style: "primary" },
										{ id: "deny:call_1", label: "Deny", disabled: true },
									],
								},
							],
						}),
					}),
				)
				const messageId = posted.data.id
				// Message events name their author, read from the directory.
				const created = {
					eventType: "message.create",
					author: { id: botUserId, displayName: "Maple", isBot: true },
				}
				expect(world.objects.published.map((entry) => entry.envelope)).toMatchObject([
					created,
					created,
				])
				world.objects.published.length = 0

				// A deleted author is named nowhere: the event goes out without one.
				const directory = Context.get(world.objects.directory, Directory)
				const setDeleted = (deletedAt: Date | null) =>
					directory.db
						.run(
							SQLite.update(schema.usersTable)
								.set({ deletedAt })
								.where(($) => [$.id.eq(botUserId)]),
						)
						.pipe(Effect.orDie)
				yield* setDeleted(new Date())
				yield* json(
					yield* request("/api/v1/messages", {
						method: "POST",
						body: JSON.stringify({
							channelId: world.channelId,
							content: "from a deleted author",
							replyToMessageId: null,
							threadChannelId: null,
							embeds: null,
						}),
					}),
				)
				const anonymous = world.objects.published.map((entry) => entry.envelope)
				expect(anonymous).toHaveLength(2)
				expect(anonymous.every((envelope) => !("author" in envelope))).toBe(true)
				yield* setDeleted(null)
				world.objects.published.length = 0

				const press = (actionId: string, userId: UserId = world.alice) =>
					invokeAs(
						world.channel,
						world.channelId,
						"message.interact",
						{ channelId: world.channelId, messageId, actionId },
						userId,
					)
				const pressed = yield* press("approve:call_1")
				expect(Exit.isSuccess(pressed)).toBe(true)
				// Only the bot that posted the message hears about it.
				expect(world.objects.published).toMatchObject([
					{
						botId,
						envelope: {
							eventType: "interaction.create",
							payload: {
								actionId: "approve:call_1",
								messageId,
								channelId: world.channelId,
								orgId: world.orgId,
								userId: world.alice,
								// Alice has no name here, and a bot never gets her email instead.
								userName: "Unknown",
							},
						},
					},
				])
				expect((failureOf(yield* press("deny:call_1")) as { _tag: string })._tag).toBe(
					"MessageActionUnavailableError",
				)
				expect((failureOf(yield* press("nope")) as { _tag: string })._tag).toBe(
					"MessageActionUnavailableError",
				)
				// Someone who cannot read the channel cannot press its buttons.
				expect(failureOf(yield* press("approve:call_1", uuid() as UserId))).toBeDefined()

				// The org's access rows for the channel, which a thread copies (this world sets the
				// channel's viewers by hand rather than through the org).
				for (const userId of [world.alice, botUserId, otherBotUserId]) {
					world.org.storage.db
						.prepare(
							`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`,
						)
						.run(userId, world.channelId, world.orgId)
				}

				// A thread on the bot's own message; asking again answers with the same thread.
				const thread = yield* json(
					yield* request(`/api/v1/channels/${world.channelId}/threads`, {
						method: "POST",
						body: JSON.stringify({ messageId }),
					}),
				)
				expect(thread.data).toMatchObject({
					parentChannelId: world.channelId,
					organizationId: world.orgId,
				})
				const again = yield* json(
					yield* request(`/api/v1/channels/${world.channelId}/threads`, {
						method: "POST",
						body: JSON.stringify({ messageId }),
					}),
				)
				expect(again.data.id).toBe(thread.data.id)

				// A mention inside the thread answers with that same thread, not a thread on a thread.
				const inThread = yield* json(
					yield* request("/api/v1/messages", {
						method: "POST",
						body: JSON.stringify({
							channelId: thread.data.id,
							content: "follow-up",
							replyToMessageId: null,
							threadChannelId: null,
							embeds: null,
						}),
					}),
				)
				const sameThread = yield* json(
					yield* request(`/api/v1/channels/${thread.data.id}/threads`, {
						method: "POST",
						body: JSON.stringify({ messageId: inThread.data.id }),
					}),
				)
				expect(sameThread.data.id).toBe(thread.data.id)

				const users = yield* json(
					yield* request(
						`/api/v1/organizations/${world.orgId}/users?ids=${world.alice},not-a-uuid,${botUserId},${uuid()}`,
					),
				)
				expect(
					[...users.data].sort((a: { displayName: string }, b: { displayName: string }) =>
						a.displayName.localeCompare(b.displayName),
					),
				).toMatchObject([
					{ id: world.alice, displayName: "Alice", isBot: false },
					{ id: botUserId, displayName: "Maple", isBot: true },
				])
			}),
		))
})

describe("public API (v1) bot channels", () => {
	it("lists the channels a bot can post in, and refuses a bot without channels:read", () =>
		run(
			Effect.gen(function* () {
				const reader = {
					botId: uuid() as BotId,
					botUserId: uuid() as UserId,
					token: `hzl_bot_${uuid()}`,
				}
				const writer = {
					botId: uuid() as BotId,
					botUserId: uuid() as UserId,
					token: `hzl_bot_${uuid()}`,
				}
				const world = yield* makeWorld([reader.botUserId, writer.botUserId])
				// The org's computed access for each bot user, as `syncChannelAccess` writes it.
				for (const bot of [reader, writer]) {
					world.org.storage.db
						.prepare(
							`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`,
						)
						.run(bot.botUserId, world.channelId, world.orgId)
				}
				yield* insertDirectoryBot(world, { ...reader, scopes: ["channels:read", "messages:write"] })
				yield* insertDirectoryBot(world, { ...writer, scopes: ["messages:write", "channels:write"] })
				const path = `/api/v1/organizations/${world.orgId}/bot-channels`

				const allowed = yield* botHttp(world, reader.token)
				expect(yield* allowed.json(yield* allowed.request(path))).toEqual({
					data: [{ id: world.channelId, name: "general", private: false }],
				})
				const refused = yield* botHttp(world, writer.token)
				expect((yield* refused.request(path)).status).toBe(401)
			}),
		))
})

describe("incoming webhooks", () => {
	const seedWebhook = (world: World, options: { readonly enabled: boolean }) =>
		Effect.gen(function* () {
			const webhookId = uuid() as ChannelWebhookId
			const botUserId = uuid() as UserId
			const token = uuid()
			world.org.storage.db
				.prepare(
					`INSERT INTO channel_webhooks (id, channelId, organizationId, botUserId, name, tokenHash, tokenSuffix, isEnabled, createdBy)
					 VALUES (?, ?, ?, ?, 'CI', ?, 'abcd', ?, ?)`,
				)
				.run(
					webhookId,
					world.channelId,
					world.orgId,
					botUserId,
					sha256(token),
					options.enabled ? 1 : 0,
					world.alice,
				)
			yield* Context.get(world.objects.directory, Directory).upsertWebhook({
				webhookId,
				organizationId: world.orgId,
				channelId: world.channelId,
				tokenHash: sha256(token),
			})
			return { webhookId, botUserId, token }
		}).pipe(Effect.orDie)

	it("posts the message as the webhook's bot and refuses a bad token or a disabled webhook", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld()
				const hook = yield* seedWebhook(world, { enabled: true })

				const posted = yield* world.worker(
					deliverWebhook({
						webhookId: hook.webhookId,
						token: hook.token,
						provider: null,
						content: `build passed @[userId:${world.alice}]`,
						embeds: null,
					}),
				)
				expect(posted.channelId).toBe(world.channelId)
				expect(messagesIn(world.channel)).toMatchObject([
					{
						id: posted.messageId,
						authorId: hook.botUserId,
						content: `build passed @[userId:${world.alice}]`,
					},
				])
				const lastUsed = world.org.storage.db
					.prepare(`SELECT lastUsedAt FROM channel_webhooks WHERE id = ?`)
					.get(hook.webhookId) as { lastUsedAt: string | null }
				expect(lastUsed.lastUsedAt).not.toBeNull()
				// `message.create`'s side effects ran: the mention reached alice's unread count.
				const member = world.org.storage.db
					.prepare(`SELECT notificationCount FROM channel_members WHERE userId = ?`)
					.get(world.alice) as { notificationCount: number }
				expect(member.notificationCount).toBe(1)

				const badToken = yield* world
					.worker(
						deliverWebhook({
							webhookId: hook.webhookId,
							token: "nope",
							provider: null,
							content: "x",
							embeds: null,
						}),
					)
					.pipe(Effect.exit)
				expect(failureOf(badToken)).toMatchObject({ _tag: "InvalidWebhookTokenError" })

				const disabled = yield* seedWebhook(world, { enabled: false })
				const refused = yield* world
					.worker(
						deliverWebhook({
							webhookId: disabled.webhookId,
							token: disabled.token,
							provider: null,
							content: "x",
							embeds: null,
						}),
					)
					.pipe(Effect.exit)
				expect(failureOf(refused)).toMatchObject({ _tag: "WebhookDisabledError" })
				expect(messagesIn(world.channel)).toHaveLength(1)
			}),
		))

	it("authors a provider webhook's message with the provider's shared bot", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld()
				const hook = yield* seedWebhook(world, { enabled: true })
				yield* world.worker(
					deliverWebhook({
						webhookId: hook.webhookId,
						token: hook.token,
						provider: "railway",
						content: "",
						embeds: [{ title: "Deploy succeeded" }],
					}),
				)
				const [message] = messagesIn(world.channel)
				const bot = world.org.storage.db
					.prepare(`SELECT id FROM users WHERE externalId = 'integration-bot-railway'`)
					.get() as { id: string }
				expect(message?.authorId).toBe(bot.id)
				expect(JSON.parse(message!.embeds!)).toMatchObject([{ title: "Deploy succeeded" }])
			}),
		))
})

describe("GitHub webhooks", () => {
	it("posts a push to the subscribed channel once, through the installation's org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld()
				// Connecting the GitHub App indexes its installation in the directory.
				yield* world.worker(
					callObject(ConnectIntegrationCall, orgTarget(world.orgId), {
						provider: "github",
						userId: null,
						connectedBy: world.alice,
						externalAccountId: "acme",
						externalAccountName: "acme",
						settings: null,
						metadata: { installationId: "777" },
						tokens: { accessToken: "ghs_test", refreshToken: null, expiresAt: null, scope: null },
					}),
				)
				const indexed = yield* Context.get(world.objects.directory, Directory).integration(
					"github",
					"777",
				)
				expect(Option.map(indexed, (row) => row.organizationId)).toEqual(Option.some(world.orgId))

				world.org.storage.db
					.prepare(
						`INSERT INTO github_subscriptions (id, channelId, organizationId, repositoryId, repositoryFullName, repositoryOwner, repositoryName, enabledEvents, createdBy)
						 VALUES (?, ?, ?, 42, 'acme/app', 'acme', 'app', '["push"]', ?)`,
					)
					.run(uuid(), world.channelId, world.orgId, world.alice)

				const push = {
					ref: "refs/heads/main",
					before: "a".repeat(40),
					compare: "https://github.com/acme/app/compare/a...b",
					installation: { id: 777 },
					repository: { id: 42, full_name: "acme/app", html_url: "https://github.com/acme/app" },
					sender: {
						login: "octo",
						html_url: "https://github.com/octo",
						avatar_url: "https://x/y.png",
					},
					commits: [{ id: "b".repeat(40), message: "Fix the thing\n\nbody" }],
				}
				const delivery = { eventType: "push", deliveryId: uuid(), payload: push }
				const result = yield* world.worker(dispatchGitHubEvent(delivery))
				expect(result).toMatchObject({ processed: true, messagesCreated: 1 })

				const [message] = messagesIn(world.channel)
				const bot = world.org.storage.db
					.prepare(`SELECT id FROM users WHERE externalId = 'integration-bot-github'`)
					.get() as { id: string }
				expect(message?.authorId).toBe(bot.id)
				expect(JSON.parse(message!.embeds!)).toMatchObject([{ title: "acme/app" }])

				// GitHub redelivers on failure: the same delivery posts nothing new.
				yield* world.worker(dispatchGitHubEvent(delivery))
				expect(messagesIn(world.channel)).toHaveLength(1)

				// An installation no org connected is acknowledged and skipped.
				const unknown = yield* world.worker(
					dispatchGitHubEvent({
						...delivery,
						deliveryId: uuid(),
						payload: { ...push, installation: { id: 999 } },
					}),
				)
				expect(unknown).toMatchObject({ processed: false })
			}),
		))

	it("suspends and removes the connection on installation events", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld()
				yield* world.worker(
					callObject(ConnectIntegrationCall, orgTarget(world.orgId), {
						provider: "github",
						userId: null,
						connectedBy: world.alice,
						externalAccountId: "acme",
						externalAccountName: "acme",
						settings: null,
						metadata: { installationId: "778" },
						tokens: { accessToken: "ghs_test", refreshToken: null, expiresAt: null, scope: null },
					}),
				)
				const installation = (action: string) => ({
					eventType: "installation",
					deliveryId: uuid(),
					payload: {
						action,
						installation: { id: 778, account: { login: "acme", type: "Organization" } },
						sender: { login: "octo" },
					},
				})
				const statusOf = () =>
					world.org.storage.db
						.prepare(
							`SELECT status, deletedAt FROM integration_connections WHERE provider = 'github'`,
						)
						.get() as { status: string; deletedAt: string | null }

				yield* world.worker(dispatchGitHubEvent(installation("suspend")))
				expect(statusOf()).toMatchObject({ status: "suspended", deletedAt: null })

				yield* world.worker(dispatchGitHubEvent(installation("deleted")))
				expect(statusOf().status).toBe("revoked")
				expect(statusOf().deletedAt).not.toBeNull()
				const indexed = yield* Context.get(world.objects.directory, Directory).integration(
					"github",
					"778",
				)
				expect(Option.isNone(indexed)).toBe(true)
			}),
		))
})
