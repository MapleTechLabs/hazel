/**
 * Message search on the objects (node SQLite, FTS5): the `OrgObject`'s index follows its
 * channels' writes, answers only from channels the caller can read, reaches Connect guests
 * through their mounts, and backfills from existing messages.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { CreateDmChannelRequest, CreateThreadRequest, type MessageSearchResponse } from "@hazel/domain/rpc"
import type { ChannelId, ConnectInviteId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { resolveTarget } from "../../rpc/routing"
import { Directory } from "../../services/directory"
import { channelTarget, formatTarget, orgTarget } from "./kinds"
import { parseSnippet, prepareMessageSearch, toFtsQuery, toSearchText } from "./org/message-search"
import { encodeInvokePrincipal } from "./principal"
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

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const directoryUser = (objects: TestObjects, id: UserId, firstName: string) =>
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
	).pipe(Effect.provideContext(objects.directory), Effect.orDie)

const messagePayload = (channelId: ChannelId, authorId: UserId, content: string) => ({
	channelId,
	content,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	authorId,
	deletedAt: null,
})

const makeOrg = (objects: TestObjects, name: string, slug: string, owner: UserId, member: UserId) =>
	Effect.gen(function* () {
		const id = uuid() as OrganizationId
		const object = yield* objects.get(orgTarget(id))
		ok(
			yield* call(
				object,
				id,
				"organization.create",
				{ name, slug, logoUrl: null, settings: null, isPublic: false },
				owner,
			),
		)
		ok(yield* call(object, id, "organization.setPublicMode", { id, isPublic: true }, owner))
		ok(yield* call(object, id, "organization.joinViaPublicInvite", { slug }, member))
		return { id, object }
	})

type Org = Effect.Success<ReturnType<typeof makeOrg>>

const makeChannel = (org: Org, as: UserId, type: "public" | "private", name: string) =>
	Effect.gen(function* () {
		const id = uuid() as ChannelId
		ok(
			yield* call(
				org.object,
				org.id,
				"channel.create",
				{
					id,
					name,
					icon: null,
					type,
					organizationId: org.id,
					parentChannelId: null,
					sectionId: null,
				},
				as,
			),
		)
		return id
	})

/** Org A: a1 (owner), a2 (member); org B: b1, b2; `outsider` belongs to neither. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const [a1, a2, b1, b2, outsider] = [uuid(), uuid(), uuid(), uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, a1, "Ada")
	yield* directoryUser(objects, a2, "Abe")
	yield* directoryUser(objects, b1, "Bea")
	yield* directoryUser(objects, b2, "Bob")
	const a = yield* makeOrg(objects, "Acme", "acme", a1, a2)
	const b = yield* makeOrg(objects, "Beta", "beta", b1, b2)
	return { objects, a, b, a1, a2, b1, b2, outsider }
})

type World = Effect.Success<typeof makeWorld>

const send = (world: World, channelId: ChannelId, as: UserId, content: string) =>
	Effect.gen(function* () {
		const object = yield* world.objects.get(channelTarget(channelId))
		const created = ok(
			yield* call(object, channelId, "message.create", messagePayload(channelId, as, content), as),
		)
		return created.data.id as MessageId
	})

const search = (org: Org, as: UserId, payload: Record<string, unknown>) =>
	Effect.map(
		call(org.object, org.id, "message.search", { organizationId: org.id, query: "", ...payload }, as),
		(exit) => ok(exit) as MessageSearchResponse,
	)

const ids = (response: MessageSearchResponse) => response.results.map((hit) => hit.messageId)

/**
 * Flush the objects' outboxes until nothing is left: a reply that arrives while its target's drain
 * is running waits for the next one (in workerd, the alarm the flush rearms).
 */
const settle = (objects: ReadonlyArray<TestObject>) =>
	Effect.gen(function* () {
		for (let round = 0; round < 20; round++) {
			for (const object of objects) yield* object.afterCommit
			const pending = objects.some(
				(object) =>
					(
						object.storage.db
							.prepare(`SELECT count(*) AS n FROM _outbox WHERE status = 'pending'`)
							.get() as {
							n: number
						}
					).n > 0,
			)
			if (!pending) return
		}
	})

describe("message search", () => {
	it("indexes creates, edits and deletes; matches words by prefix, with filters and paging", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, a1, a2 } = world
				const general = yield* makeChannel(a, a1, "public", "general")
				const random = yield* makeChannel(a, a1, "public", "random")

				const first = yield* send(world, general, a1, "Deploying the **search** index today")
				const second = yield* send(world, general, a2, `Thanks @[userId:${a1}], searching works`)
				const third = yield* send(world, random, a1, "Lunch?")

				const hits = yield* search(a, a2, { query: "sear" })
				expect(ids(hits)).toEqual([second, first])
				expect(hits.indexing).toBe(false)
				const top = hits.results[0]!
				expect(top.channelId).toBe(general)
				expect(top.authorId).toBe(a2)
				expect(top.snippet).toBe("Thanks @Ada Last, searching works")
				expect(top.highlights.map((h) => top.snippet.slice(h.start, h.end))).toEqual(["searching"])

				// Mentions are searchable by name; markdown markers are not indexed.
				expect(ids(yield* search(a, a2, { query: "ada" }))).toEqual([second])
				expect(ids(yield* search(a, a2, { query: "**" }))).toEqual([])

				// Filters alone, and with words.
				expect(ids(yield* search(a, a2, { authorId: a1 }))).toEqual([third, first])
				expect(ids(yield* search(a, a2, { channelId: random }))).toEqual([third])
				expect(ids(yield* search(a, a2, { query: "search", authorId: a2 }))).toEqual([second])
				expect(ids(yield* search(a, a2, { after: new Date(Date.now() + 60_000) }))).toEqual([])
				expect(ids(yield* search(a, a2, { before: new Date(Date.now() + 60_000) })).length).toBe(3)

				// Paging.
				const page1 = yield* search(a, a2, { query: "sear", limit: 1 })
				expect(ids(page1)).toEqual([second])
				const page2 = yield* search(a, a2, { query: "sear", limit: 1, cursor: page1.nextCursor })
				expect(ids(page2)).toEqual([first])
				expect(page2.nextCursor).toBeNull()

				// Edit and delete follow.
				const generalObject = yield* world.objects.get(channelTarget(general))
				ok(
					yield* call(
						generalObject,
						general,
						"message.update",
						{ channelId: general, id: first, content: "Rolled back" },
						a1,
					),
				)
				expect(ids(yield* search(a, a2, { query: "search" }))).toEqual([second])
				expect(ids(yield* search(a, a2, { query: "rolled" }))).toEqual([first])
				ok(
					yield* call(
						generalObject,
						general,
						"message.delete",
						{ channelId: general, id: second },
						a2,
					),
				)
				expect(ids(yield* search(a, a2, { query: "search" }))).toEqual([])
			}),
		))

	it("answers only from channels the caller can read: private, DM, thread", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, a1, a2, b1, outsider } = world
				const open = yield* makeChannel(a, a1, "public", "open")
				const secret = yield* makeChannel(a, a1, "private", "secret")
				const inOpen = yield* send(world, open, a1, "budget open")
				const inSecret = yield* send(world, secret, a1, "budget secret")

				// A thread under the private channel inherits its readers.
				const threadId = uuid() as ChannelId
				ok(
					yield* call(
						a.object,
						a.id,
						"channel.createThread",
						new CreateThreadRequest({
							id: threadId,
							messageId: inSecret,
							organizationId: a.id,
							channelId: secret,
						}),
						a1,
					),
				)
				const inThread = yield* send(world, threadId, a1, "budget thread")

				// A DM between a1 and a2 is theirs only.
				const dm = ok(
					yield* call(
						a.object,
						a.id,
						"channel.createDm",
						new CreateDmChannelRequest({
							participantIds: [a2],
							type: "single",
							organizationId: a.id,
						}),
						a1,
					),
				).data.id as ChannelId
				const inDm = yield* send(world, dm, a2, "budget dm")

				expect(new Set(ids(yield* search(a, a1, { query: "budget" })))).toEqual(
					new Set([inOpen, inSecret, inThread, inDm]),
				)
				expect(new Set(ids(yield* search(a, a2, { query: "budget" })))).toEqual(
					new Set([inOpen, inDm]),
				)
				// Asking for a channel by id does not get around access.
				expect(ids(yield* search(a, a2, { query: "budget", channelId: secret }))).toEqual([])
				expect(ids(yield* search(a, b1, { query: "budget" }))).toEqual([])
				expect(ids(yield* search(a, outsider, { query: "budget" }))).toEqual([])

				// Search only runs in the org's own object.
				const elsewhere = yield* call(
					world.b.object,
					world.b.id,
					"message.search",
					{ organizationId: a.id, query: "budget" },
					a1,
				)
				expect(
					Exit.isFailure(elsewhere) &&
						Option.getOrUndefined(Cause.findErrorOption(elsewhere.cause)) instanceof
							UnauthorizedError,
				).toBe(true)
			}),
		))

	it("refuses index changes from channels of another org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const foreign = yield* makeChannel(world.b, world.b1, "public", "theirs")
				const result = yield* world.a.object.applyEffect({
					objectId: world.a.id,
					kind: "org.indexMessages",
					payload: {
						upsert: [
							{
								id: uuid(),
								authorId: world.b1,
								conversationId: null,
								createdAt: Date.now(),
								content: "planted",
							},
						],
						remove: [],
					},
					key: uuid(),
					sender: { kind: "channel", id: foreign },
				})
				expect(result._tag).toBe("Rejected")
				const fromOrg = yield* world.a.object.applyEffect({
					objectId: world.a.id,
					kind: "org.indexConnectMessages",
					payload: {
						conversationId: uuid(),
						channelId: foreign,
						upsert: [],
						remove: [],
						replace: true,
					},
					key: uuid(),
					sender: { kind: "org", id: world.b.id },
				})
				expect(fromOrg._tag).toBe("Rejected")
				expect(world.a.object.storage.db.prepare(`SELECT * FROM message_search`).all()).toEqual([])
			}),
		))

	it("Connect: the host indexes the shared channel, guests find it under their mount", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, a, b, a1, a2, b1 } = world
				const hostChannelId = yield* makeChannel(a, a1, "private", "partners")
				const before = yield* send(world, hostChannelId, a1, "kickoff notes")

				const created = ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.invite.create",
						{
							channelId: hostChannelId,
							target: { kind: "slug", value: "beta" },
							allowGuestMemberAdds: true,
						},
						a1,
					),
				)
				ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.invite.accept",
						{ inviteId: created.data.id as ConnectInviteId, guestOrganizationId: b.id },
						b1,
					),
				)
				const [mount] = b.object.storage.db
					.prepare(`SELECT channelId FROM connect_conversation_channels WHERE role = 'guest'`)
					.all() as Array<{ channelId: ChannelId }>
				const guestChannelId = mount!.channelId

				const fromHost = yield* send(world, hostChannelId, a1, "kickoff agenda")
				// A guest writes through its mount id; the message lives in the host channel.
				const host = yield* objects.get(channelTarget(hostChannelId))
				const fromGuest = ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(guestChannelId, b1, "kickoff reply"),
						b1,
					),
				).data.id as MessageId

				// Host org: under the host channel, for its readers.
				const hostHits = yield* search(a, a1, { query: "kickoff" })
				expect(new Set(ids(hostHits))).toEqual(new Set([before, fromHost, fromGuest]))
				expect(new Set(hostHits.results.map((hit) => hit.channelId))).toEqual(
					new Set([hostChannelId]),
				)
				expect(ids(yield* search(a, a2, { query: "kickoff" }))).toEqual([])

				// Guest org: what was written after the share, under the mount.
				const guestHits = yield* search(b, b1, { query: "kickoff" })
				expect(new Set(ids(guestHits))).toEqual(new Set([fromHost, fromGuest]))
				expect(new Set(guestHits.results.map((hit) => hit.channelId))).toEqual(
					new Set([guestChannelId]),
				)

				// A host reindex reaches the guests too, older messages included.
				yield* a.object.run(prepareMessageSearch({ fresh: false, objectId: a.id }))
				a.object.storage.db
					.prepare(`DELETE FROM _object_meta WHERE key = 'messageSearchVersion'`)
					.run()
				yield* a.object.run(prepareMessageSearch({ fresh: false, objectId: a.id }))
				yield* settle([a.object, host, b.object])
				expect(new Set(ids(yield* search(b, b1, { query: "kickoff" })))).toEqual(
					new Set([before, fromHost, fromGuest]),
				)
			}),
		))

	it("backfills existing messages page by page when the index predates its version", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, a1, a2 } = world
				const channelId = yield* makeChannel(a, a1, "public", "archive")
				const channel = yield* world.objects.get(channelTarget(channelId))
				// Imported rows: written straight into the channel, no message events.
				const insert = channel.storage.db.prepare(
					`INSERT INTO messages (id, channelId, authorId, content, createdAt) VALUES (?, ?, ?, ?, ?)`,
				)
				for (let i = 0; i < 450; i++) {
					const at = new Date(Date.UTC(2025, 0, 1, 0, 0, i))
						.toISOString()
						.replace("T", " ")
						.slice(0, 23)
					insert.run(uuid(), channelId, a1, `archived note ${i}`, at)
				}
				insert.run(uuid(), channelId, a1, "deleted note", "2025-01-02 00:00:00.000")
				channel.storage.db
					.prepare(`UPDATE messages SET deletedAt = createdAt WHERE content = 'deleted note'`)
					.run()
				expect((yield* search(a, a2, { query: "archived" })).results.length).toBe(0)

				// A fresh activation records the version without a backfill.
				yield* a.object.run(prepareMessageSearch({ fresh: true, objectId: a.id }))
				expect(a.object.storage.db.prepare(`SELECT * FROM message_search_backfill`).all()).toEqual([])

				// An object from before search shipped: no version yet. Until the outbox delivers the
				// page requests (this search's own flush does), searches say the index is incomplete.
				a.object.storage.db
					.prepare(`DELETE FROM _object_meta WHERE key = 'messageSearchVersion'`)
					.run()
				yield* a.object.run(prepareMessageSearch({ fresh: false, objectId: a.id }))
				const pending = yield* search(a, a2, { query: "archived" })
				expect(pending.indexing).toBe(true)
				// Once versioned, activation does nothing more.
				yield* a.object.run(prepareMessageSearch({ fresh: false, objectId: a.id }))
				yield* settle([a.object, channel])
				const count = a.object.storage.db
					.prepare(`SELECT count(*) AS n FROM message_search WHERE channelId = ?`)
					.get(channelId) as { n: number }
				expect(count.n).toBe(450)
				const done = yield* search(a, a2, { query: "archived", limit: 100 })
				expect(done.indexing).toBe(false)
				expect(done.results.length).toBe(100)
				expect(done.results[0]!.snippet).toBe("archived note 449")
				expect(ids(yield* search(a, a2, { query: "deleted" }))).toEqual([])
			}),
		))

	it("routes message.search to the payload's OrgObject", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const organizationId = uuid() as OrganizationId
				const target = yield* resolveTarget(
					"message.search",
					{ organizationId, query: "x" },
					userOf(uuid()),
				).pipe(Effect.provideContext(objects.directory))
				expect(formatTarget(target)).toBe(`org:${organizationId}`)
			}),
		))
})

describe("message search text", () => {
	it("turns markdown into plain text", () => {
		const names = new Map([["u1", "Ada Last"]])
		expect(
			toSearchText(
				"## Title\n> quoted **bold** `code` [docs](https://x.dev) @[userId:u1] @[userId:u2] @[directive:here]",
				(id) => names.get(id),
			),
		).toBe("Title quoted bold code docs https://x.dev @Ada Last @here")
	})

	it("quotes words as prefix terms and drops punctuation", () => {
		expect(toFtsQuery(`he said "hi" OR-NOT*`)).toBe(`"he"* "said"* "hi"* "OR"* "NOT"*`)
		expect(toFtsQuery("?!")).toBe("")
	})

	it("reads highlight offsets out of a snippet", () => {
		expect(parseSnippet("a \u0002bc\u0003 d \u0002e\u0003")).toEqual({
			snippet: "a bc d e",
			highlights: [
				{ start: 2, end: 4 },
				{ start: 7, end: 8 },
			],
		})
	})
})
