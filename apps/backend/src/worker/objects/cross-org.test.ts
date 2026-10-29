/**
 * One org must never reach another org's channel: a client-chosen channel id already in use is
 * refused, `channel_index` never changes its owning org, a `ChannelObject` takes effects only
 * from the org that owns it (pinned by its first `setViewers`), and a chat-sync link must name a
 * live channel of the connection's own org.
 */
import { CurrentUser, InvalidChannelRequestError } from "@hazel/domain"
import { ChannelNotFoundError, CreateThreadRequest } from "@hazel/domain/rpc"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Context, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { requireMember } from "../../routes/integration-resources.http"
import { Directory } from "../../services/directory"
import { directoryReceivers } from "./effects/directory-effects"
import { CurrentEffectSender, type EffectSender } from "./effects/registry"
import { channelTarget, orgTarget } from "./kinds"
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

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

interface Org {
	readonly id: OrganizationId
	readonly owner: UserId
	readonly object: TestObject
}

/** An org with an owner and a Discord integration (rows written straight into its SQLite). */
const makeOrg = (objects: TestObjects) =>
	Effect.gen(function* () {
		const id = uuid() as OrganizationId
		const owner = uuid() as UserId
		const object = yield* objects.get(orgTarget(id))
		const db = object.storage.db
		db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Org', ?)`).run(id, `org-${id}`)
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'O', 'W')`,
		).run(owner, `ext-${owner}`, `${owner}@example.com`)
		db.prepare(
			`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'owner')`,
		).run(id, owner)
		db.prepare(
			`INSERT INTO integration_connections (provider, organizationId, level, status, connectedBy)
			 VALUES ('discord', ?, 'organization', 'active', ?)`,
		).run(id, owner)
		return { id, owner, object } satisfies Org
	})

const createChannel = (org: Org, id?: ChannelId) =>
	call(
		org.object,
		org.id,
		"channel.create",
		{
			...(id === undefined ? {} : { id }),
			name: "general",
			icon: null,
			type: "public",
			organizationId: org.id,
			parentChannelId: null,
			sectionId: null,
		},
		org.owner,
	)

const ok = <A>(exit: Exit.Exit<A, unknown>) =>
	Exit.isSuccess(exit) ? Effect.succeed(exit.value) : Effect.die(Cause.pretty(exit.cause))

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

/** Two orgs; A owns a public channel its owner reads. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const a = yield* makeOrg(objects)
	const b = yield* makeOrg(objects)
	const created = (yield* ok(yield* createChannel(a))) as { data: { id: ChannelId } }
	const channelId = created.data.id
	const channel = yield* objects.get(channelTarget(channelId))
	const index = () =>
		Effect.flatMap(Directory, (directory) => directory.channel(channelId)).pipe(
			Effect.provideContext(objects.directory),
			Effect.orDie,
		)
	const viewers = () =>
		(
			channel.storage.db.prepare(`SELECT userId, organizationId FROM channel_viewers`).all() as Array<{
				userId: string
				organizationId: string
			}>
		).map((row) => row.userId)
	return { objects, a, b, channelId, channel, index, viewers }
})

describe("cross-org channel isolation", () => {
	it("refuses a channel.create / createThread with another org's channel id", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				expect(world.viewers()).toEqual([world.a.owner])

				const taken = yield* createChannel(world.b, world.channelId)
				expect(failureOf(taken)).toBeInstanceOf(InvalidChannelRequestError)

				// B's own channel, then a thread under it named with A's channel id.
				const own = (yield* ok(yield* createChannel(world.b))) as { data: { id: ChannelId } }
				// The message lives in B's ChannelObject; createThread only names it.
				const messageId = uuid() as MessageId
				const thread = yield* call(
					world.b.object,
					world.b.id,
					"channel.createThread",
					new CreateThreadRequest({
						id: world.channelId,
						messageId,
						organizationId: world.b.id,
						channelId: own.data.id,
					}),
					world.b.owner,
				)
				expect(failureOf(thread)).toBeInstanceOf(InvalidChannelRequestError)

				// A's channel is untouched: still A's in the directory, still A's readers.
				const row = yield* world.index()
				expect(Option.getOrThrow(row).organizationId).toBe(world.a.id)
				expect(world.viewers()).toEqual([world.a.owner])
			}),
		))

	it("a ChannelObject refuses effects from any org but the one that owns it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const apply = (kind: string, payload: unknown, sender: EffectSender) =>
					world.channel.applyEffect({
						objectId: world.channelId,
						kind,
						payload,
						key: uuid(),
						sender,
					})
				const fromB: EffectSender = { kind: "org", id: world.b.id }

				// B claims the channel (its own org in the payload, or A's).
				for (const organizationId of [world.b.id, world.a.id]) {
					const takeover = yield* apply(
						"channel.setViewers",
						{
							organizationId,
							conversationId: null,
							viewers: [{ userId: world.b.owner, organizationId: world.b.id, role: "owner" }],
							bots: [],
						},
						fromB,
					)
					expect(takeover).toMatchObject({ _tag: "Rejected", retryable: false })
				}
				expect(world.viewers()).toEqual([world.a.owner])

				const system = {
					id: uuid(),
					channelId: world.channelId,
					authorId: world.b.owner,
					content: "spoofed",
					embeds: null,
				}
				expect((yield* apply("channel.postSystemMessage", system, fromB))._tag).toBe("Rejected")
				// Each kind only from its own sender: thread origins from a channel, uploads from the Worker.
				const origin = {
					parentChannelId: world.channelId,
					messageId: uuid(),
					authorId: world.b.owner,
					content: "x",
				}
				expect((yield* apply("channel.setThreadOrigin", origin, fromB))._tag).toBe("Rejected")
				const attachment = {
					id: uuid(),
					organizationId: world.a.id,
					channelId: world.channelId,
					uploadedBy: world.a.owner,
					fileName: "a.png",
					fileSize: 1,
				}
				expect(
					(yield* apply("channel.createAttachment", attachment, { kind: "org", id: world.a.id }))
						._tag,
				).toBe("Rejected")
				const messages = world.channel.storage.db
					.prepare(`SELECT count(*) AS n FROM messages`)
					.get() as { n: number }
				expect(messages.n).toBe(0)

				// The owning org still gets through (an empty viewer list: the channel was deleted).
				const fromA = yield* apply(
					"channel.setViewers",
					{
						organizationId: world.a.id,
						conversationId: null,
						viewers: [],
						bots: [],
						version: Date.now() + 1,
					},
					{ kind: "org", id: world.a.id },
				)
				expect(fromA._tag).toBe("Applied")
				expect(world.viewers()).toEqual([])
			}),
		))

	it("channel_index never moves a channel to another org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const upsert = directoryReceivers["directory.upsertChannelIndex"]
				const payload = {
					channelId: world.channelId,
					organizationId: world.b.id,
					hostChannelId: null,
					deletedAt: null,
				}
				const withSender = (sender: EffectSender) =>
					upsert(payload).pipe(
						Effect.provideService(CurrentEffectSender, sender),
						Effect.provideContext(objects(world)),
						Effect.exit,
					)
				// A sender that is not the payload's org is refused outright.
				const refused = yield* withSender({ kind: "org", id: world.a.id })
				expect((failureOf(refused) as { _tag?: string } | undefined)?._tag).toBe(
					"EffectSenderRefusedError",
				)
				// B's own OrgObject may send it, but the row stays A's (the upsert is conditional).
				expect(Exit.isSuccess(yield* withSender({ kind: "org", id: world.b.id }))).toBe(true)
				expect(Option.getOrThrow(yield* world.index()).organizationId).toBe(world.a.id)
			}),
		))

	it("chatSync.channelLink.create refuses a channel outside the connection's org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const connection = (yield* ok(
					yield* call(
						world.b.object,
						world.b.id,
						"chatSync.connection.create",
						{
							organizationId: world.b.id,
							provider: "discord",
							externalWorkspaceId: "111111111111111111",
							externalWorkspaceName: "Guild",
						},
						world.b.owner,
					),
				)) as { data: { id: string } }
				const link = yield* call(
					world.b.object,
					world.b.id,
					"chatSync.channelLink.create",
					{
						organizationId: world.b.id,
						syncConnectionId: connection.data.id,
						hazelChannelId: world.channelId,
						externalChannelId: "222222222222222222",
					},
					world.b.owner,
				)
				expect(failureOf(link)).toBeInstanceOf(ChannelNotFoundError)
				const links = world.channel.storage.db.prepare(`SELECT count(*) AS n FROM _outbox`).get() as {
					n: number
				}
				expect(links.n).toBe(0)
			}),
		))

	it("integration resources require membership of the org", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const as = (userId: UserId) =>
					requireMember(world.a.id).pipe(
						Effect.provideService(CurrentUser.Context, userOf(userId)),
						Effect.provideContext(objects(world)),
						Effect.exit,
					)
				// A's owner is indexed as a member by A's OrgObject (the seed bypassed it).
				yield* Effect.flatMap(Directory, (directory) =>
					directory.upsertMembership({
						userId: world.a.owner,
						organizationId: world.a.id,
						deletedAt: null,
					}),
				).pipe(Effect.provideContext(objects(world)), Effect.orDie)
				expect(Exit.isSuccess(yield* as(world.a.owner))).toBe(true)
				const outsider = yield* as(world.b.owner)
				expect((failureOf(outsider) as { _tag?: string } | undefined)?._tag).toBe("UnauthorizedError")
			}),
		))
})

const objects = (world: { readonly objects: TestObjects }): Context.Context<Directory> =>
	world.objects.directory
