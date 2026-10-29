/**
 * The `OrgObject`'s slice on node SQLite: organizations, members, channels (update, delete, DMs,
 * threads), channel members, sections, emojis, webhooks and RSS, run through `invoke`, with their
 * projections (viewers, `channel_index`, `membership_index`, `org_index`, `webhook_index`,
 * `user_organizations`) checked where they land.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Fiber, Option, type Scope } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { CreateDmChannelRequest, CreateThreadRequest } from "@hazel/domain/rpc"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { channelTarget, orgTarget, userTarget } from "./kinds"
import { encodeInvokePrincipal } from "./principal"
import { makeFakeSocket } from "@hazel/sync-do/testing"
import { makeTestObjects, type TestObject, type TestObjects } from "./testing"

const uuid = () => crypto.randomUUID()

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

const ok = <A>(exit: Exit.Exit<A, unknown>) => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value as any
}

const failsWith = (exit: Exit.Exit<unknown, unknown>, tag: string) =>
	Exit.isFailure(exit) &&
	Option.match(Cause.findErrorOption(exit.cause), {
		onNone: () => false,
		onSome: (error) => (error as { _tag?: string })._tag === tag,
	})

const unauthorized = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) &&
	Option.match(Cause.findErrorOption(exit.cause), {
		onNone: () => false,
		onSome: (error) => error instanceof UnauthorizedError,
	})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const inDirectory = <A, E>(objects: TestObjects, effect: Effect.Effect<A, E, Directory>) =>
	effect.pipe(Effect.provideContext(objects.directory))

/** A directory `users` row (what `projectUsers` copies into the org). */
const directoryUser = (objects: TestObjects, id: UserId, firstName = "First") =>
	inDirectory(
		objects,
		Effect.flatMap(Directory, (directory) =>
			directory.db.run(
				SQLite.insertInto(schema.usersTable).values({
					id,
					externalId: `ext-${id}`,
					email: `${id}@example.com`,
					firstName,
					lastName: "Last",
				}),
			),
		),
	).pipe(Effect.orDie)

const rows = <T>(object: TestObject, query: string, ...params: Array<string>) =>
	object.storage.db.prepare(query).all(...params) as Array<T>

const viewersOf = (object: TestObject) =>
	rows<{ userId: string; role: string }>(object, `SELECT userId, role FROM channel_viewers ORDER BY userId`)

interface World {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly member: UserId
	readonly outsider: UserId
	readonly general: ChannelId
}

/** `organization.create` as the directory path forwards it, then `member` joins publicly. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const [owner, member, outsider] = [uuid(), uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, owner, "Olive")
	yield* directoryUser(objects, member, "Mel")
	yield* directoryUser(objects, outsider, "Otto")
	const org = yield* objects.get(orgTarget(orgId))
	ok(
		yield* call(
			org,
			orgId,
			"organization.create",
			{ name: "Acme", slug: "acme", logoUrl: null, settings: null, isPublic: false },
			owner,
		),
	)
	ok(yield* call(org, orgId, "organization.setPublicMode", { id: orgId, isPublic: true }, owner))
	ok(yield* call(org, orgId, "organization.joinViaPublicInvite", { slug: "acme" }, member))
	const [general] = rows<{ id: ChannelId }>(org, `SELECT id FROM channels WHERE name = 'general'`)
	return { objects, org, orgId, owner, member, outsider, general: general!.id } satisfies World
})

const createChannel = (world: World, type: "public" | "private", id: ChannelId = uuid() as ChannelId) =>
	Effect.gen(function* () {
		ok(
			yield* call(
				world.org,
				world.orgId,
				"channel.create",
				{
					id,
					name: `${type}-${id.slice(0, 4)}`,
					icon: null,
					type,
					organizationId: world.orgId,
					parentChannelId: null,
					sectionId: null,
				},
				world.owner,
			),
		)
		return { id, object: yield* world.objects.get(channelTarget(id)) }
	})

describe("OrgObject: organizations and members", () => {
	it("organization.create seeds the org and projects it everywhere", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, owner, member } = world

				expect(rows(org, `SELECT id FROM organizations`)).toEqual([{ id: orgId }])
				expect(
					rows<{ userId: string; role: string }>(
						org,
						`SELECT userId, role FROM organization_members ORDER BY role DESC`,
					).map((row) => row.role),
				).toEqual(["owner", "member"])
				// The joiners' directory rows were copied in.
				expect(
					rows<{ firstName: string }>(org, `SELECT firstName FROM users ORDER BY firstName`).map(
						(row) => row.firstName,
					),
				).toEqual(["Mel", "Olive"])

				// general's ChannelObject has both as viewers.
				const general = yield* objects.get(channelTarget(world.general))
				expect(
					viewersOf(general)
						.map((viewer) => viewer.userId)
						.sort(),
				).toEqual([owner, member].sort())

				// Directory: org_index (slug, public), membership_index; UserObject: user_organizations.
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.orgBySlug("acme")),
				)
				expect(Option.map(index, (row) => [row.id, row.isPublic])).toEqual(Option.some([orgId, true]))
				const memberships = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.memberCount(orgId)),
				)
				expect(memberships).toBe(2)
				const ownerObject = yield* objects.get(userTarget(owner))
				expect(rows(ownerObject, `SELECT organizationId FROM user_organizations`)).toEqual([
					{ organizationId: orgId },
				])
			}),
		))

	it("a member cannot update the org, rejoin, or take a used slug", () =>
		run(
			Effect.gen(function* () {
				const { objects, org, orgId, owner, member } = yield* makeWorld
				const denied = yield* call(
					org,
					orgId,
					"organization.update",
					{ id: orgId, name: "Mine" },
					member,
				)
				expect(unauthorized(denied)).toBe(true)
				const again = yield* call(
					org,
					orgId,
					"organization.joinViaPublicInvite",
					{ slug: "acme" },
					member,
				)
				expect(failsWith(again, "AlreadyMemberError")).toBe(true)

				yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) =>
						directory.upsertOrg({
							id: uuid() as OrganizationId,
							slug: "taken",
							name: "Other",
							deletedAt: null,
						}),
					),
				)
				const taken = yield* call(
					org,
					orgId,
					"organization.setSlug",
					{ id: orgId, slug: "taken" },
					owner,
				)
				expect(failsWith(taken, "OrganizationSlugAlreadyExistsError")).toBe(true)
			}),
		))

	it("removing a member cuts their channels, membership index and user_organizations", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, owner, member } = world
				const [membership] = rows<{ id: string }>(
					org,
					`SELECT id FROM organization_members WHERE userId = ?`,
					member,
				)
				ok(
					yield* call(
						org,
						orgId,
						"organizationMember.delete",
						{ id: membership!.id, organizationId: orgId },
						// Self-removal (the policy lets admins, not owners, remove others).
						member,
					),
				)
				const general = yield* objects.get(channelTarget(world.general))
				expect(viewersOf(general).map((viewer) => viewer.userId)).toEqual([owner])
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.membership(member, orgId)),
				)
				expect(Option.map(index, (row) => row.deletedAt !== null)).toEqual(Option.some(true))
				const memberObject = yield* objects.get(userTarget(member))
				expect(rows(memberObject, `SELECT organizationId FROM user_organizations`)).toEqual([])
			}),
		))

	it("a removal cuts the channel's viewers before it answers, even while another drain runs", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, owner, member, outsider } = world
				const general = yield* objects.get(channelTarget(world.general))
				// The outsider's join drains towards their (slow) UserObject and holds the drain.
				const slow = objects.hold(userTarget(outsider))
				const join = yield* Effect.forkChild(
					call(org, orgId, "organization.joinViaPublicInvite", { slug: "acme" }, outsider),
				)
				yield* slow.reached

				const [membership] = rows<{ id: string }>(
					org,
					`SELECT id FROM organization_members WHERE userId = ?`,
					member,
				)
				ok(
					yield* call(
						org,
						orgId,
						"organizationMember.delete",
						{ id: membership!.id, organizationId: orgId },
						member,
					),
				)
				// Not left to the alarm the held drain would schedule.
				expect(viewersOf(general).map((viewer) => viewer.userId)).not.toContain(member)
				expect(viewersOf(general).map((viewer) => viewer.userId)).toContain(owner)

				yield* slow.release
				ok(yield* Fiber.join(join))
				expect(
					viewersOf(general)
						.map((viewer) => viewer.userId)
						.sort(),
				).toEqual([owner, outsider].sort())
			}),
		))

	it("a channel drops a setViewers older than the one it applied", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, orgId, owner } = world
				const general = yield* objects.get(channelTarget(world.general))
				const [applied] = rows<{ value: string }>(
					general,
					`SELECT value FROM _object_meta WHERE key = 'viewersVersion'`,
				)
				const version = Number(applied!.value)
				const stale = (key: string, payloadVersion: number | undefined) =>
					general.applyEffect({
						objectId: world.general,
						kind: "channel.setViewers",
						payload: {
							organizationId: orgId,
							conversationId: null,
							viewers: [{ userId: owner, organizationId: orgId, role: "owner" }],
							bots: [],
							...(payloadVersion === undefined ? {} : { version: payloadVersion }),
						},
						key,
						sender: { kind: "org", id: orgId },
					})
				// An older versioned payload, and one queued before versions existed.
				yield* stale(uuid(), version - 1)
				yield* stale(uuid(), undefined)
				expect(viewersOf(general)).toHaveLength(2)
				// A newer one applies.
				yield* stale(uuid(), version + 1)
				expect(viewersOf(general).map((viewer) => viewer.userId)).toEqual([owner])
			}),
		))

	it("organization.delete marks the org and its memberships gone", () =>
		run(
			Effect.gen(function* () {
				const { objects, org, orgId, owner, member } = yield* makeWorld
				expect(
					unauthorized(yield* call(org, orgId, "organization.delete", { id: orgId }, member)),
				).toBe(true)
				ok(yield* call(org, orgId, "organization.delete", { id: orgId }, owner))
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.org(orgId)),
				)
				expect(Option.map(index, (row) => row.deletedAt !== null)).toEqual(Option.some(true))
				const ownerObject = yield* objects.get(userTarget(owner))
				expect(rows(ownerObject, `SELECT organizationId FROM user_organizations`)).toEqual([])
			}),
		))

	it("organization.delete empties its channels' and threads' viewers and closes their sockets", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, owner, member } = world
				const general = yield* objects.get(channelTarget(world.general))
				const message = ok(
					yield* call(
						general,
						world.general,
						"message.create",
						{
							channelId: world.general,
							content: "start a thread",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: member,
							deletedAt: null,
						},
						member,
					),
				)
				const threadId = uuid() as ChannelId
				ok(
					yield* call(
						org,
						orgId,
						"channel.createThread",
						new CreateThreadRequest({
							id: threadId,
							messageId: message.data.id,
							organizationId: orgId,
							channelId: world.general,
						}),
						owner,
					),
				)
				const thread = yield* objects.get(channelTarget(threadId))
				const sockets = [makeFakeSocket(), makeFakeSocket()]
				expect(yield* general.adopt(sockets[0]!, { userId: member, expiresAt: null })).toBe(
					"accepted",
				)
				expect(yield* thread.adopt(sockets[1]!, { userId: member, expiresAt: null })).toBe("accepted")
				const hello = JSON.stringify({ _tag: "Hello", since: null })
				yield* general.onMessage(sockets[0]!, hello)
				yield* thread.onMessage(sockets[1]!, hello)

				ok(yield* call(org, orgId, "organization.delete", { id: orgId }, owner))
				expect(viewersOf(general)).toEqual([])
				expect(viewersOf(thread)).toEqual([])
				for (const socket of sockets) expect(socket.closed).toBeDefined()
				// Routing refuses them too.
				for (const id of [world.general, threadId]) {
					const indexed = yield* inDirectory(
						objects,
						Effect.flatMap(Directory, (directory) => directory.channel(id)),
					)
					expect(Option.map(indexed, (row) => row.deletedAt !== null)).toEqual(Option.some(true))
				}
				// And the member can't write there any more.
				const denied = yield* call(
					general,
					world.general,
					"message.create",
					{
						channelId: world.general,
						content: "still here?",
						embeds: null,
						replyToMessageId: null,
						threadChannelId: null,
						authorId: member,
						deletedAt: null,
					},
					member,
				)
				expect(unauthorized(denied)).toBe(true)
			}),
		))
})

describe("OrgObject: channels", () => {
	it("channel.update is admin-only; channel.delete drops viewers and the index", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, owner, member } = world
				const channel = yield* createChannel(world, "public")
				expect(viewersOf(channel.object)).toHaveLength(2)

				expect(
					unauthorized(
						yield* call(org, orgId, "channel.update", { id: channel.id, name: "x" }, member),
					),
				).toBe(true)
				const renamed = ok(
					yield* call(org, orgId, "channel.update", { id: channel.id, name: "renamed" }, owner),
				)
				expect(renamed.data.name).toBe("renamed")
				expect(viewersOf(channel.object)).toHaveLength(2)
				// Bots heard nothing (none installed), and the outbox drained.
				expect(rows(org, `SELECT id FROM _outbox WHERE status = 'pending'`)).toEqual([])

				ok(yield* call(org, orgId, "channel.delete", { id: channel.id }, owner))
				expect(viewersOf(channel.object)).toEqual([])
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.channel(channel.id)),
				)
				expect(Option.map(index, (row) => row.deletedAt !== null)).toEqual(Option.some(true))
			}),
		))

	it("channel.createDm names the DM after both and refuses a duplicate", () =>
		run(
			Effect.gen(function* () {
				const { objects, org, orgId, owner, member } = yield* makeWorld
				const payload = new CreateDmChannelRequest({
					participantIds: [member],
					type: "single",
					organizationId: orgId,
				})
				const created = ok(yield* call(org, orgId, "channel.createDm", payload, owner))
				expect(created.data.name).toBe("Mel Last, Olive Last")
				const dm = yield* objects.get(channelTarget(created.data.id))
				expect(
					viewersOf(dm)
						.map((viewer) => viewer.userId)
						.sort(),
				).toEqual([owner, member].sort())
				const again = yield* call(org, orgId, "channel.createDm", payload, owner)
				expect(failsWith(again, "DmChannelAlreadyExistsError")).toBe(true)
			}),
		))

	it("channel.createThread creates the thread and links the parent message", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, org, orgId, member, outsider } = world
				const parent = yield* objects.get(channelTarget(world.general))
				const message = ok(
					yield* call(
						parent,
						world.general,
						"message.create",
						{
							channelId: world.general,
							content: "start a thread",
							embeds: null,
							replyToMessageId: null,
							threadChannelId: null,
							authorId: member,
							deletedAt: null,
						},
						member,
					),
				)
				const threadId = uuid() as ChannelId
				const payload = new CreateThreadRequest({
					id: threadId,
					messageId: message.data.id,
					organizationId: orgId,
					channelId: world.general,
				})
				expect(unauthorized(yield* call(org, orgId, "channel.createThread", payload, outsider))).toBe(
					true,
				)

				// Members lack `channels:write` (as before the port); the owner creates it.
				const thread = ok(yield* call(org, orgId, "channel.createThread", payload, world.owner))
				expect(thread.data).toMatchObject({
					id: threadId,
					type: "thread",
					parentChannelId: world.general,
				})
				expect(
					rows(parent, `SELECT threadChannelId FROM messages WHERE id = ?`, message.data.id),
				).toEqual([{ threadChannelId: threadId }])
				const threadObject = yield* objects.get(channelTarget(threadId))
				expect(viewersOf(threadObject)).toHaveLength(2)
				// A retry returns the same thread.
				expect(
					ok(yield* call(org, orgId, "channel.createThread", payload, world.owner)).data.id,
				).toBe(threadId)
			}),
		))

	it("channelMember.create: public channels are joinable, private ones are not", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { org, orgId, member } = world
				const open = yield* createChannel(world, "public")
				const closed = yield* createChannel(world, "private")
				ok(yield* call(org, orgId, "channelMember.create", { channelId: open.id }, member))
				expect(
					unauthorized(
						yield* call(org, orgId, "channelMember.create", { channelId: closed.id }, member),
					),
				).toBe(true)
				expect(viewersOf(closed.object).map((viewer) => viewer.userId)).toEqual([world.owner])

				ok(
					yield* call(
						org,
						orgId,
						"channelMember.clearNotifications",
						{ channelId: open.id },
						member,
					),
				)
			}),
		))
})

describe("OrgObject: org-local resources", () => {
	it("sections and custom emojis: admins create, members are refused", () =>
		run(
			Effect.gen(function* () {
				const { org, orgId, owner, member } = yield* makeWorld
				const section = { name: "Team", order: 0, organizationId: orgId }
				ok(yield* call(org, orgId, "channelSection.create", section, owner))
				expect(unauthorized(yield* call(org, orgId, "channelSection.create", section, member))).toBe(
					true,
				)

				const emoji = { organizationId: orgId, name: "party", imageUrl: "https://example.com/p.png" }
				ok(yield* call(org, orgId, "customEmoji.create", emoji, owner))
				expect(
					failsWith(
						yield* call(org, orgId, "customEmoji.create", emoji, owner),
						"CustomEmojiNameConflictError",
					),
				).toBe(true)
			}),
		))

	it("channelWebhook.create indexes the token and writes its bot to the directory", () =>
		run(
			Effect.gen(function* () {
				const { objects, org, orgId, owner, member, general } = yield* makeWorld
				const payload = { channelId: general, name: "CI" }
				expect(unauthorized(yield* call(org, orgId, "channelWebhook.create", payload, member))).toBe(
					true,
				)
				const created = ok(yield* call(org, orgId, "channelWebhook.create", payload, owner))

				const bot = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) =>
						directory.db.run(
							SQLite.from(schema.usersTable)
								.select("id", "userType")
								.where(($) => [$.id.eq(created.data.botUserId)]),
						),
					),
				)
				expect(bot.map((row) => row.userType)).toEqual(["machine"])
				const indexed = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) =>
						directory.db.run(
							SQLite.from(schema.webhookIndexTable)
								.select("webhookId")
								.where(($) => [$.webhookId.eq(created.data.id)]),
						),
					),
				)
				expect(indexed).toHaveLength(1)

				ok(
					yield* call(
						org,
						orgId,
						"channelWebhook.delete",
						{ id: created.data.id, organizationId: orgId },
						owner,
					),
				)
				const removed = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) =>
						directory.db.run(
							SQLite.from(schema.webhookIndexTable)
								.select("webhookId")
								.where(($) => [$.webhookId.eq(created.data.id)]),
						),
					),
				)
				expect(removed).toEqual([])
			}),
		))
})

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title><link>https://news.example.com</link>
<item><guid>a</guid><title>First</title><link>https://news.example.com/a</link></item>
<item><guid>b</guid><title>Second</title><link>https://news.example.com/b</link></item>
</channel></rss>`

describe("OrgObject: RSS", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it("the alarm polls due feeds and posts new items once", () =>
		run(
			Effect.gen(function* () {
				vi.stubGlobal(
					"fetch",
					vi.fn(
						async () =>
							new Response(FEED, {
								status: 200,
								headers: { "content-type": "application/rss+xml" },
							}),
					),
				)
				const { objects, org, orgId, owner, member, general } = yield* makeWorld
				const payload = { channelId: general, feedUrl: "https://news.example.com/feed" }
				expect(unauthorized(yield* call(org, orgId, "rssSubscription.create", payload, member))).toBe(
					true,
				)
				const created = ok(yield* call(org, orgId, "rssSubscription.create", payload, owner))
				expect(created.data.feedTitle).toBe("News")
				// The alarm is armed for the new (never fetched) subscription.
				expect(org.storage.alarm()).not.toBeNull()

				yield* org.alarm
				const channel = yield* objects.get(channelTarget(general))
				const posted = rows<{ authorId: string }>(channel, `SELECT authorId FROM messages`)
				expect(posted).toHaveLength(2)
				const [bot] = rows<{ id: string }>(
					org,
					`SELECT id FROM users WHERE externalId = 'integration-bot-rss'`,
				)
				expect(new Set(posted.map((row) => row.authorId))).toEqual(new Set([bot!.id]))
				expect(rows(org, `SELECT itemGuid FROM rss_posted_items ORDER BY itemGuid`)).toEqual([
					{ itemGuid: "a" },
					{ itemGuid: "b" },
				])

				// Due again: nothing new to post.
				org.storage.db.exec(`UPDATE rss_subscriptions SET lastFetchedAt = '2000-01-01 00:00:00.000'`)
				yield* org.alarm
				expect(rows(channel, `SELECT id FROM messages`)).toHaveLength(2)
			}),
		))

	it("a failing feed counts errors instead of posting", () =>
		run(
			Effect.gen(function* () {
				vi.stubGlobal(
					"fetch",
					vi.fn(async () => new Response(FEED, { status: 200 })),
				)
				const { org, orgId, owner, general } = yield* makeWorld
				ok(
					yield* call(
						org,
						orgId,
						"rssSubscription.create",
						{ channelId: general, feedUrl: "https://news.example.com/feed" },
						owner,
					),
				)
				vi.stubGlobal(
					"fetch",
					vi.fn(async () => new Response("down", { status: 503 })),
				)
				yield* org.alarm
				expect(rows(org, `SELECT consecutiveErrors FROM rss_subscriptions`)).toEqual([
					{ consecutiveErrors: 1 },
				])
				expect(rows(org, `SELECT id FROM rss_posted_items`)).toEqual([])
			}),
		))
})
