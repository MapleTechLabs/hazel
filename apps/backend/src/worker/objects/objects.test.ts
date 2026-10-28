/**
 * The object shells on node SQLite: handler-in-object invoke round trips (encoded payload and
 * exit, typed errors), routing, `channel.create` projecting `setViewers` to its `ChannelObject`
 * (with inbox dedupe and outbox retry), and per-principal visibility.
 */
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { Channel, ChannelMember, Message, Organization, User } from "@hazel/domain/models"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { makeFakeSocket, type FakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, Option, Schema } from "effect"
import { CurrentBotScopes } from "@hazel/domain/scopes"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { resolveTarget } from "../../rpc/routing"
import { Directory } from "../../services/directory"
import { channelTarget, orgTarget } from "./kinds"
import { currentInvokePrincipal, encodeInvokePrincipal } from "./principal"
import { makeTestObjects, type TestObject } from "./testing"

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

/** Call `tag` on `object` as `user`, the way the api Worker forwards it, and decode the exit. */
const call = (object: TestObject, objectId: string, tag: HazelRpcTag, payload: unknown, user: string) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null }),
		})
		// The answer must survive a DO call's structured clone.
		const cloned = structuredClone(response)
		return yield* decodeExit(rpc, cloned.exit)
	})

const run = <A, E>(effect: Effect.Effect<A, E, import("effect").Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

interface Seed {
	readonly orgId: OrganizationId
	readonly owner: UserId
	readonly member: UserId
	readonly outsider: UserId
}

/** An org with an owner and a member (rows written straight into its SQLite). */
const seedOrg = (org: TestObject): Seed => {
	const seed: Seed = {
		orgId: uuid() as OrganizationId,
		owner: uuid() as UserId,
		member: uuid() as UserId,
		outsider: uuid() as UserId,
	}
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(seed.orgId)
	for (const [id, role] of [
		[seed.owner, "owner"],
		[seed.member, "member"],
	] as const) {
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'First', 'Last')`,
		).run(id, `ext-${id}`, `${id}@example.com`)
		db.prepare(`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, ?)`).run(
			seed.orgId,
			id,
			role,
		)
	}
	return seed
}

const createChannel = (
	org: TestObject,
	seed: Seed,
	type: "public" | "private",
	options?: { readonly addAllMembers?: boolean },
) =>
	Effect.gen(function* () {
		const exit = yield* call(
			org,
			seed.orgId,
			"channel.create",
			{
				name: `${type}-channel`,
				icon: null,
				type,
				organizationId: seed.orgId,
				parentChannelId: null,
				sectionId: null,
				addAllMembers: options?.addAllMembers ?? false,
			},
			seed.owner,
		)
		if (Exit.isFailure(exit)) return yield* Effect.die(Cause.pretty(exit.cause))
		return exit.value as { readonly data: { readonly id: ChannelId }; readonly transactionId: string }
	})

const hello = (object: TestObject, socket: FakeSocket) =>
	object.onMessage(socket, JSON.stringify({ _tag: "Hello", since: null }))

const upserts = (socket: FakeSocket, table: string) =>
	socket
		.frames()
		.filter((frame) => frame._tag === "Rows" && frame.table === table)
		.flatMap((frame) => frame.upserts as Array<Record<string, unknown>>)

const messagePayload = (channelId: ChannelId, authorId: UserId, content: string) => ({
	channelId,
	content,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	authorId,
	deletedAt: null,
})

describe("objects", () => {
	it("channel.create runs in the OrgObject and projects viewers, the index and txid", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const org = yield* objects.get(orgTarget("o"))
				const seed = seedOrg(org)
				const created = yield* createChannel(org, seed, "public")
				const channelId = created.data.id

				expect(created.transactionId).toMatch(new RegExp(`^org:${seed.orgId}:\\d+$`))
				expect(org.synced.sync.flushedSeq()).toBeGreaterThanOrEqual(
					Number(created.transactionId.split(":")[2]),
				)

				// setViewers reached the channel's object before the RPC answered.
				const channel = yield* objects.get(channelTarget(channelId))
				const viewers = channel.storage.db
					.prepare(`SELECT userId, role FROM channel_viewers ORDER BY role`)
					.all() as Array<{ userId: string; role: string }>
				expect(viewers).toEqual([
					{ userId: seed.member, role: "member" },
					{ userId: seed.owner, role: "owner" },
				])
				const outbox = org.storage.db.prepare(`SELECT count(*) AS n FROM _outbox`).get() as {
					n: number
				}
				expect(outbox.n).toBe(0)

				const index = yield* Effect.flatMap(Directory, (directory) =>
					directory.channel(channelId),
				).pipe(Effect.provideContext(objects.directory))
				expect(Option.map(index, (row) => row.organizationId)).toEqual(Option.some(seed.orgId))
			}),
		))

	it("message.create runs in the ChannelObject: viewers allowed, others get a typed error", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const org = yield* objects.get(orgTarget("o"))
				const seed = seedOrg(org)
				const { data } = yield* createChannel(org, seed, "public")
				const channel = yield* objects.get(channelTarget(data.id))
				// A bot installed in the org gets the channel's message events.
				channel.storage.db
					.prepare(`INSERT INTO channel_bots (botId, botUserId) VALUES (?, ?)`)
					.run(uuid(), uuid())

				const ok = yield* call(
					channel,
					data.id,
					"message.create",
					messagePayload(data.id, seed.member, "hello"),
					seed.member,
				)
				expect(Exit.isSuccess(ok)).toBe(true)
				const response = Exit.isSuccess(ok)
					? (ok.value as { data: { content: string; authorId: string }; transactionId: string })
					: undefined
				expect(response?.data.content).toBe("hello")
				expect(response?.data.authorId).toBe(seed.member)
				expect(response?.transactionId).toMatch(new RegExp(`^channel:${data.id}:\\d+$`))
				expect(objects.published.map((p) => p.envelope.eventType)).toEqual(["message.create"])

				const denied = yield* call(
					channel,
					data.id,
					"message.create",
					messagePayload(data.id, seed.outsider, "nope"),
					seed.outsider,
				)
				expect(Exit.isFailure(denied)).toBe(true)
				if (Exit.isFailure(denied)) {
					const error = Cause.findErrorOption(denied.cause)
					expect(Option.isSome(error) && error.value instanceof UnauthorizedError).toBe(true)
				}
			}),
		))

	it("setViewers is applied once per outbox key", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const org = yield* objects.get(orgTarget("o"))
				const seed = seedOrg(org)
				const first = yield* createChannel(org, seed, "public")
				const channel = yield* objects.get(channelTarget(first.data.id))
				const [delivery] = objects.deliveries.filter((d) => d.includes("channel.setViewers"))
				const key = delivery!.split(" ")[2]!

				const again = yield* channel.applyEffect({
					objectId: first.data.id,
					kind: "channel.setViewers",
					payload: { organizationId: seed.orgId, conversationId: null, viewers: [], bots: [] },
					key,
					sender: { kind: "org", id: seed.orgId },
				})
				expect(again._tag).toBe("Duplicate")
				const viewers = channel.storage.db
					.prepare(`SELECT count(*) AS n FROM channel_viewers`)
					.get() as {
					n: number
				}
				expect(viewers.n).toBe(2)
			}),
		))

	it("outbox delivery is retried until the target is reachable", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const org = yield* objects.get(orgTarget("o"))
				const seed = seedOrg(org)
				// Pre-pick the channel id so it can be made unreachable before it is created.
				const channelId = uuid() as ChannelId
				objects.setUnreachable(channelTarget(channelId), true)
				const exit = yield* call(
					org,
					seed.orgId,
					"channel.create",
					{
						id: channelId,
						name: "later",
						icon: null,
						type: "public",
						organizationId: seed.orgId,
						parentChannelId: null,
						sectionId: null,
					},
					seed.owner,
				)
				expect(Exit.isSuccess(exit)).toBe(true)
				const pending = () =>
					(
						org.storage.db
							.prepare(`SELECT count(*) AS n FROM _outbox WHERE status = 'pending'`)
							.get() as { n: number }
					).n
				expect(pending()).toBe(1)
				expect(org.storage.alarm()).not.toBeNull()

				objects.setUnreachable(channelTarget(channelId), false)
				org.storage.db.exec(`UPDATE _outbox SET next_at = 0`)
				yield* org.alarm
				expect(pending()).toBe(0)
				const channel = yield* objects.get(channelTarget(channelId))
				const viewers = channel.storage.db
					.prepare(`SELECT count(*) AS n FROM channel_viewers`)
					.get() as {
					n: number
				}
				expect(viewers.n).toBe(2)
			}),
		))

	it("a private channel's rows reach its members' sockets only", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const org = yield* objects.get(orgTarget("o"))
				const seed = seedOrg(org)
				const { data } = yield* createChannel(org, seed, "private")
				const channel = yield* objects.get(channelTarget(data.id))

				// OrgObject: the owner (a channel member) sees the channel; the plain member does not.
				const ownerOrg = makeFakeSocket()
				const memberOrg = makeFakeSocket()
				expect(yield* org.adopt(ownerOrg, { userId: seed.owner, expiresAt: null })).toBe("accepted")
				expect(yield* org.adopt(memberOrg, { userId: seed.member, expiresAt: null })).toBe("accepted")
				yield* hello(org, ownerOrg)
				yield* hello(org, memberOrg)
				const ownerChannels = upserts(ownerOrg, "channels")
				expect(ownerChannels.map((row) => row.id)).toEqual([data.id])
				expect(upserts(memberOrg, "channels")).toEqual([])
				expect(upserts(memberOrg, "organizations").map((row) => row.id)).toEqual([seed.orgId])
				expect(upserts(ownerOrg, "channel_members").length).toBe(1)

				// The rows decode with the client models, as Electric's did.
				for (const row of ownerChannels) Schema.decodeUnknownSync(Channel.Schema)(row)
				for (const row of upserts(ownerOrg, "channel_members"))
					Schema.decodeUnknownSync(ChannelMember.Schema)(row)
				for (const row of upserts(ownerOrg, "organizations"))
					Schema.decodeUnknownSync(Organization.Schema)(row)
				for (const row of upserts(ownerOrg, "users")) Schema.decodeUnknownSync(User.Schema)(row)

				// ChannelObject: the member and an outsider are refused, the owner streams messages.
				const memberChannel = makeFakeSocket()
				expect(yield* channel.adopt(memberChannel, { userId: seed.member, expiresAt: null })).toBe(
					"forbidden",
				)
				const ownerChannel = makeFakeSocket()
				expect(yield* channel.adopt(ownerChannel, { userId: seed.owner, expiresAt: null })).toBe(
					"accepted",
				)
				yield* hello(channel, ownerChannel)
				ownerChannel.clear()
				const sent = yield* call(
					channel,
					data.id,
					"message.create",
					messagePayload(data.id, seed.owner, "secret"),
					seed.owner,
				)
				expect(Exit.isSuccess(sent)).toBe(true)
				const messages = upserts(ownerChannel, "messages")
				expect(messages.map((row) => row.content)).toEqual(["secret"])
				for (const row of messages) Schema.decodeUnknownSync(Message.Schema)(row)
				const commit = ownerChannel.frames().find((frame) => frame._tag === "Commit")
				const txid = Exit.isSuccess(sent)
					? (sent.value as { transactionId: string }).transactionId
					: ""
				expect(commit?.seq).toBe(Number(txid.split(":")[2]))
			}),
		))

	it("routes each method to its object", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const channelId = uuid() as ChannelId
				const hostId = uuid() as ChannelId
				const mountId = uuid() as ChannelId
				const user = userOf(uuid())
				const route = (tag: HazelRpcTag, payload: unknown) =>
					resolveTarget(tag, payload, user).pipe(
						Effect.provideContext(objects.directory),
						Effect.exit,
					)

				yield* Effect.flatMap(Directory, (directory) =>
					Effect.all([
						directory.upsertChannel({
							channelId,
							organizationId: orgId,
							hostChannelId: null,
							deletedAt: null,
						}),
						directory.upsertChannel({
							channelId: mountId,
							organizationId: uuid() as OrganizationId,
							hostChannelId: hostId,
							deletedAt: null,
						}),
					]),
				).pipe(Effect.provideContext(objects.directory))

				expect(yield* route("message.create", { channelId })).toEqual(
					Exit.succeed({ kind: "channel", id: channelId }),
				)
				// A Connect guest mount goes to its host channel.
				expect(yield* route("message.create", { channelId: mountId })).toEqual(
					Exit.succeed({ kind: "channel", id: hostId }),
				)
				expect(yield* route("message.update", { id: uuid(), channelId })).toEqual(
					Exit.succeed({ kind: "channel", id: channelId }),
				)
				expect(yield* route("channel.create", { organizationId: orgId })).toEqual(
					Exit.succeed({ kind: "org", id: orgId }),
				)
				expect(yield* route("channel.update", { id: channelId })).toEqual(
					Exit.succeed({ kind: "org", id: orgId }),
				)
				expect(yield* route("notification.update", { id: uuid() })).toEqual(
					Exit.succeed({ kind: "user", id: user.id }),
				)
				expect(yield* route("bot.list", {})).toEqual(Exit.succeed({ kind: "directory" }))

				const missing = yield* route("message.delete", { id: uuid() })
				expect(Exit.isFailure(missing)).toBe(true)
				const unindexed = yield* route("channel.update", { id: uuid() })
				expect(Exit.isFailure(unindexed)).toBe(true)
			}),
		))

	it("a bot's principal (a plain CurrentUser and its scopes) crosses encoded", () =>
		run(
			Effect.gen(function* () {
				const plain = { ...userOf(uuid()) } as CurrentUser.Schema
				const principal = yield* currentInvokePrincipal.pipe(
					Effect.provideService(CurrentUser.Context, plain),
					Effect.provideService(
						CurrentBotScopes,
						Option.some(new Set(["messages:write"] as const)),
					),
				)
				const encoded = structuredClone(yield* encodeInvokePrincipal(principal))
				expect(encoded).toMatchObject({ user: { id: plain.id }, botScopes: ["messages:write"] })
			}),
		))
})
