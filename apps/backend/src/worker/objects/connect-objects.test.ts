/**
 * Hazel Connect on the objects (node SQLite): org A shares a channel with org B. Invites live in
 * the directory, the conversation in A's `OrgObject`, B's mounted channel in B's, and every
 * message in the host channel's `ChannelObject`, whichever org's channel id the writer names.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import { SyncCloseCode } from "@hazel/domain/sync"
import type { ChannelId, ConnectInviteId, OrganizationId, UserId } from "@hazel/schema"
import { makeFakeSocket, type FakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { resolveTarget } from "../../rpc/routing"
import { Directory } from "../../services/directory"
import { syncObjectId } from "../sync-route"
import { channelTarget, formatTarget, orgTarget } from "./kinds"
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

const failsWith = (exit: Exit.Exit<unknown, unknown>, tag: string) =>
	Exit.isFailure(exit) &&
	Option.match(Cause.findErrorOption(exit.cause), {
		onNone: () => false,
		onSome: (error) => (error as { _tag?: string })._tag === tag,
	})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const inDirectory = <A, E>(objects: TestObjects, effect: Effect.Effect<A, E, Directory>) =>
	effect.pipe(Effect.provideContext(objects.directory))

const directoryUser = (objects: TestObjects, id: UserId, firstName: string) =>
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

const viewerIds = (object: TestObject) =>
	rows<{ userId: string }>(object, `SELECT userId FROM channel_viewers ORDER BY userId`).map(
		(row) => row.userId,
	)

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

/** An org created by `owner`, public, joined by `member`. */
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

const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const [a1, a2, b1, b2] = [uuid(), uuid(), uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, a1, "Ada")
	yield* directoryUser(objects, a2, "Abe")
	yield* directoryUser(objects, b1, "Bea")
	yield* directoryUser(objects, b2, "Bob")
	const a = yield* makeOrg(objects, "Acme", "acme", a1, a2)
	const b = yield* makeOrg(objects, "Beta", "beta", b1, b2)

	// A's private channel: a1 only (a2 is an A member without access).
	const hostChannelId = uuid() as ChannelId
	ok(
		yield* call(
			a.object,
			a.id,
			"channel.create",
			{
				id: hostChannelId,
				name: "partners",
				icon: null,
				type: "private",
				organizationId: a.id,
				parentChannelId: null,
				sectionId: null,
			},
			a1,
		),
	)
	const host = yield* objects.get(channelTarget(hostChannelId))
	return { objects, a, b, a1, a2, b1, b2, hostChannelId, host }
})

type World = Effect.Success<typeof makeWorld>

/** A shares its channel with B, B's owner accepts; returns B's mounted channel id. */
const share = (world: World) =>
	Effect.gen(function* () {
		const { objects, a, b, a1, b1, hostChannelId } = world
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
		const inviteId = created.data.id as ConnectInviteId

		// Accept is routed to the guest org.
		const target = yield* resolveTarget(
			"connectShare.invite.accept",
			{ inviteId, guestOrganizationId: b.id },
			userOf(b1),
		).pipe(Effect.provideContext(objects.directory))
		expect(formatTarget(target)).toBe(`org:${b.id}`)

		ok(
			yield* call(
				b.object,
				b.id,
				"connectShare.invite.accept",
				{ inviteId, guestOrganizationId: b.id },
				b1,
			),
		)
		const [guest] = rows<{ id: ChannelId }>(
			b.object,
			`SELECT channelId AS id FROM connect_conversation_channels WHERE role = 'guest'`,
		)
		return { inviteId, guestChannelId: guest!.id }
	})

describe("Hazel Connect", () => {
	it("shares a channel: invite, accept, guest writes land in the host channel", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, a, b, a1, a2, b1, b2, hostChannelId, host } = world

				// A message from before the share joins the conversation.
				ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, "before"),
						a1,
					),
				)

				// Workspace search over the directory's org index.
				const found = ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.workspace.search",
						{ query: "bet", organizationId: a.id },
						a1,
					),
				)
				expect(found.data.map((row: { id: string }) => row.id)).toEqual([b.id])

				const { inviteId, guestChannelId } = yield* share(world)

				// Directory: the invite was accepted; the mount's index row points at the host channel.
				const invite = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) =>
						directory.db.first(
							SQLite.from(schema.connectInvitesTable)
								.select("status", "acceptedBy")
								.where(($) => [$.id.eq(inviteId)]),
						),
					),
				)
				expect(Option.getOrNull(invite)).toEqual({ status: "accepted", acceptedBy: b1 })
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.channel(guestChannelId)),
				)
				expect(Option.map(index, (row) => [row.organizationId, row.hostChannelId])).toEqual(
					Option.some([b.id, hostChannelId]),
				)
				const incoming = ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.invite.listIncoming",
						{ organizationId: b.id },
						b1,
					),
				)
				expect(incoming.data.map((row: { status: string }) => row.status)).toEqual(["accepted"])

				// B's mounted channel mirrors the host channel; B holds the conversation and both mounts.
				expect(
					rows(b.object, `SELECT name, type FROM channels WHERE id = ?`, guestChannelId),
				).toEqual([{ name: "partners", type: "private" }])
				expect(
					rows(b.object, `SELECT role FROM connect_conversation_channels ORDER BY role`),
				).toEqual([{ role: "guest" }, { role: "host" }])

				// A: the guest mount's copy, a1 (host member) and b1 (B's reader) as participants.
				expect(
					rows<{ userId: string; isExternal: number }>(
						a.object,
						`SELECT userId, isExternal FROM connect_participants WHERE deletedAt IS NULL ORDER BY isExternal`,
					).map((row) => row.userId),
				).toEqual([a1, b1])
				// The host channel's viewers: its own access and the participants.
				expect(viewerIds(host)).toEqual([a1, b1].sort())
				expect(rows(host, `SELECT role FROM channel_viewers WHERE userId = ?`, b1)).toEqual([
					{ role: "guest" },
				])
				expect(rows(host, `SELECT conversationId FROM messages`)).toEqual([
					{
						conversationId: rows<{ id: string }>(
							a.object,
							`SELECT id FROM connect_conversations`,
						)[0]!.id,
					},
				])

				// Routing: B's channel id reaches the host channel's object, for RPCs and sockets.
				const routed = yield* resolveTarget(
					"message.create",
					messagePayload(guestChannelId, b1, "x"),
					userOf(b1),
				).pipe(Effect.provideContext(objects.directory))
				expect(formatTarget(routed)).toBe(`channel:${hostChannelId}`)
				const socketObject = yield* syncObjectId("channel", guestChannelId).pipe(
					Effect.provideContext(objects.directory),
				)
				expect(socketObject).toBe(hostChannelId)

				// Sockets on the host channel: a1 and b1 stream it, the rest are refused.
				const a1Socket = makeFakeSocket()
				const b1Socket = makeFakeSocket()
				expect(yield* host.adopt(a1Socket, { userId: a1, expiresAt: null })).toBe("accepted")
				expect(yield* host.adopt(b1Socket, { userId: b1, expiresAt: null })).toBe("accepted")
				expect(yield* host.adopt(makeFakeSocket(), { userId: a2, expiresAt: null })).toBe("forbidden")
				expect(yield* host.adopt(makeFakeSocket(), { userId: b2, expiresAt: null })).toBe("forbidden")
				yield* hello(host, a1Socket)
				yield* hello(host, b1Socket)
				a1Socket.clear()
				b1Socket.clear()

				// b1 writes to B's channel id: the row lands in the host object, in the conversation.
				const sent = ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(guestChannelId, b1, "hello from beta"),
						b1,
					),
				)
				expect(sent.data.conversationId).not.toBeNull()
				expect(upserts(a1Socket, "messages").map((row) => row.content)).toEqual(["hello from beta"])
				expect(upserts(b1Socket, "messages").map((row) => row.content)).toEqual(["hello from beta"])
				// A non-viewer can't write through B's id either.
				const denied = yield* call(
					host,
					hostChannelId,
					"message.create",
					messagePayload(guestChannelId, b2, "nope"),
					b2,
				)
				expect(failsWith(denied, "UnauthorizedError")).toBe(true)

				// The host org streams a guest only the conversation rows (and the users it shares them with).
				const guestOrgSocket = makeFakeSocket()
				expect(yield* a.object.adopt(guestOrgSocket, { userId: b1, expiresAt: null })).toBe(
					"accepted",
				)
				yield* hello(a.object, guestOrgSocket)
				expect(upserts(guestOrgSocket, "connect_conversations").length).toBe(1)
				expect(upserts(guestOrgSocket, "connect_conversation_channels").length).toBe(2)
				expect(upserts(guestOrgSocket, "connect_participants").length).toBe(2)
				expect(upserts(guestOrgSocket, "channels")).toEqual([])
				expect(upserts(guestOrgSocket, "organizations")).toEqual([])
				expect(upserts(guestOrgSocket, "organization_members")).toEqual([])
				expect(upserts(guestOrgSocket, "channel_members")).toEqual([])
				expect(
					upserts(guestOrgSocket, "users")
						.map((row) => row.id)
						.sort(),
				).toEqual([a1, b1].sort())
				// A member without the channel sees no conversation; a non-participant is refused.
				const a2OrgSocket = makeFakeSocket()
				expect(yield* a.object.adopt(a2OrgSocket, { userId: a2, expiresAt: null })).toBe("accepted")
				yield* hello(a.object, a2OrgSocket)
				expect(upserts(a2OrgSocket, "connect_conversations")).toEqual([])
				expect(yield* a.object.adopt(makeFakeSocket(), { userId: b2, expiresAt: null })).toBe(
					"forbidden",
				)

				// B's own org streams its members the mounted channel and the conversation.
				const b1Home = makeFakeSocket()
				expect(yield* b.object.adopt(b1Home, { userId: b1, expiresAt: null })).toBe("accepted")
				yield* hello(b.object, b1Home)
				expect(upserts(b1Home, "channels").map((row) => row.id)).toContain(guestChannelId)
				expect(upserts(b1Home, "connect_conversation_channels").length).toBe(2)
				expect(upserts(b1Home, "connect_conversations").length).toBe(1)

				// The host's notifications reach B's members through B's mounted channel.
				ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.member.add",
						{ channelId: guestChannelId, userId: b2 },
						b1,
					),
				)
				ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, `hi @[userId:${b2}]`),
						a1,
					),
				)
				expect(
					rows(
						b.object,
						`SELECT notificationCount FROM channel_members WHERE userId = ? AND channelId = ?`,
						b2,
						guestChannelId,
					),
				).toEqual([{ notificationCount: 1 }])
			}),
		))

	it("member.add and member.remove update the host's viewers and close revoked sockets", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, b, a1, a2, b1, b2, hostChannelId, host } = world
				const { guestChannelId } = yield* share(world)

				// B adds b2 to its mounted channel: b2 becomes a participant and a host viewer.
				const added = ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.member.add",
						{ channelId: guestChannelId, userId: b2 },
						b1,
					),
				)
				expect(viewerIds(host)).toEqual([a1, b1, b2].sort())
				// The participant id B answered with is the host's row.
				expect(
					rows(a.object, `SELECT userId FROM connect_participants WHERE id = ?`, added.data.id),
				).toEqual([{ userId: b2 }])

				const b2Socket = makeFakeSocket()
				expect(yield* host.adopt(b2Socket, { userId: b2, expiresAt: null })).toBe("accepted")
				yield* hello(host, b2Socket)

				// Host side: a2 joins through A's mount.
				ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.member.add",
						{ channelId: hostChannelId, userId: a2 },
						a1,
					),
				)
				expect(viewerIds(host)).toEqual([a1, a2, b1, b2].sort())

				// Only B's members can be added through B's mount.
				const foreign = yield* call(
					b.object,
					b.id,
					"connectShare.member.add",
					{ channelId: guestChannelId, userId: a2 },
					b1,
				)
				expect(failsWith(foreign, "ConnectWorkspaceNotFoundError")).toBe(true)

				// B removes b2: gone from the host's viewers, its socket closed.
				ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.member.remove",
						{ channelId: guestChannelId, userId: b2 },
						b1,
					),
				)
				expect(viewerIds(host)).toEqual([a1, a2, b1].sort())
				expect(b2Socket.closed?.code).toBe(SyncCloseCode.Forbidden)
				expect(
					rows(
						a.object,
						`SELECT deletedAt IS NOT NULL AS gone FROM connect_participants WHERE userId = ?`,
						b2,
					),
				).toEqual([{ gone: 1 }])

				// A removes a2 again.
				ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.member.remove",
						{ channelId: hostChannelId, userId: a2 },
						a1,
					),
				)
				expect(viewerIds(host)).toEqual([a1, b1].sort())
			}),
		))

	it("a guest org leaves: its mount is its own again and its readers lose the host channel", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, a, b, a1, b1, host } = world
				const { guestChannelId } = yield* share(world)
				const conversationId = rows<{ id: string }>(
					a.object,
					`SELECT id FROM connect_conversations`,
				)[0]!.id

				const b1Socket = makeFakeSocket()
				expect(yield* host.adopt(b1Socket, { userId: b1, expiresAt: null })).toBe("accepted")
				yield* hello(host, b1Socket)

				// Routed to B: b1 is a B member.
				const target = yield* resolveTarget(
					"connectShare.organization.disconnect",
					{ conversationId, organizationId: b.id },
					userOf(b1),
				).pipe(Effect.provideContext(objects.directory))
				expect(formatTarget(target)).toBe(`org:${b.id}`)
				ok(
					yield* call(
						b.object,
						b.id,
						"connectShare.organization.disconnect",
						{ conversationId, organizationId: b.id },
						b1,
					),
				)

				expect(viewerIds(host)).toEqual([a1])
				expect(b1Socket.closed?.code).toBe(SyncCloseCode.Forbidden)
				expect(
					rows(a.object, `SELECT isActive FROM connect_conversation_channels WHERE role = 'guest'`),
				).toEqual([{ isActive: 0 }])
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.channel(guestChannelId)),
				)
				expect(Option.map(index, (row) => row.hostChannelId)).toEqual(Option.some(null))
				// B's channel has its own object again, readable by B's members.
				const own = yield* objects.get(channelTarget(guestChannelId))
				expect(viewerIds(own)).toEqual([b1])
			}),
		))

	it("the host ends the conversation for everyone", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { objects, a, b, a1, b1, hostChannelId, host } = world
				const { guestChannelId } = yield* share(world)
				const conversationId = rows<{ id: string }>(
					a.object,
					`SELECT id FROM connect_conversations`,
				)[0]!.id

				// A guest can't end it.
				const denied = yield* call(
					b.object,
					b.id,
					"connectShare.organization.disconnect",
					{ conversationId, organizationId: a.id },
					b1,
				)
				expect(failsWith(denied, "ConnectConversationNotFoundError")).toBe(true)

				ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.organization.disconnect",
						{ conversationId, organizationId: a.id },
						a1,
					),
				)
				expect(viewerIds(host)).toEqual([a1])
				expect(rows(a.object, `SELECT status FROM connect_conversations`)).toEqual([
					{ status: "disconnected" },
				])
				// New host messages are outside the conversation.
				const after = ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, "solo"),
						a1,
					),
				)
				expect(after.data.conversationId).toBeNull()
				// B's mount is inactive and routes to its own object.
				expect(
					rows(
						b.object,
						`SELECT isActive FROM connect_conversation_channels WHERE channelId = ?`,
						guestChannelId,
					),
				).toEqual([{ isActive: 0 }])
				const index = yield* inDirectory(
					objects,
					Effect.flatMap(Directory, (directory) => directory.channel(guestChannelId)),
				)
				expect(Option.map(index, (row) => row.hostChannelId)).toEqual(Option.some(null))
			}),
		))

	it("decline and revoke run in the guest and host org", () =>
		run(
			Effect.gen(function* () {
				const { objects, a, b, a1, b1, b2, hostChannelId } = yield* makeWorld
				const invite = ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.invite.create",
						{
							channelId: hostChannelId,
							target: { kind: "slug", value: "beta" },
							allowGuestMemberAdds: false,
						},
						a1,
					),
				)
				const inviteId = invite.data.id as ConnectInviteId
				const route = (tag: HazelRpcTag) =>
					resolveTarget(tag, { inviteId }, userOf(b1)).pipe(
						Effect.map(formatTarget),
						Effect.provideContext(objects.directory),
					)
				expect(yield* route("connectShare.invite.decline")).toBe(`org:${b.id}`)
				expect(yield* route("connectShare.invite.revoke")).toBe(`org:${a.id}`)

				// b2 is a plain member of B: no declining for it.
				const denied = yield* call(b.object, b.id, "connectShare.invite.decline", { inviteId }, b2)
				expect(failsWith(denied, "UnauthorizedError")).toBe(true)
				ok(yield* call(b.object, b.id, "connectShare.invite.decline", { inviteId }, b1))
				const revoked = yield* call(a.object, a.id, "connectShare.invite.revoke", { inviteId }, a1)
				expect(failsWith(revoked, "ConnectInviteInvalidStateError")).toBe(true)
				const outgoing = ok(
					yield* call(
						a.object,
						a.id,
						"connectShare.invite.listOutgoing",
						{ organizationId: a.id },
						a1,
					),
				)
				expect(outgoing.data.map((row: { status: string }) => row.status)).toEqual(["declined"])
			}),
		))
})

describe("Hazel Connect: host channel changes and senders", () => {
	it("a host channel rename or icon change reaches the guests' mounts", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, b, a1, hostChannelId } = world
				const { guestChannelId } = yield* share(world)
				ok(
					yield* call(
						a.object,
						a.id,
						"channel.update",
						{ id: hostChannelId, name: "renamed", icon: "🤝" },
						a1,
					),
				)
				expect(
					rows<{ name: string; icon: string | null }>(
						b.object,
						`SELECT name, icon FROM channels WHERE id = ?`,
						guestChannelId,
					),
				).toEqual([{ name: "renamed", icon: "🤝" }])
			}),
		))

	it("setParticipants is accepted only from the guest org it names", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, b, b1, host } = world
				const { guestChannelId } = yield* share(world)
				const [conversation] = rows<{ id: string }>(a.object, `SELECT id FROM connect_conversations`)
				expect(viewerIds(host)).toContain(b1)
				const payload = {
					conversationId: conversation!.id,
					organizationId: b.id,
					channelId: guestChannelId,
					users: [],
					addedBy: null,
				}
				const send = (senderId: string) =>
					a.object.applyEffect({
						objectId: a.id,
						kind: "org.connectSetParticipants",
						payload,
						key: uuid(),
						sender: { kind: "org", id: senderId },
					})
				const forged = yield* send(uuid())
				expect(forged).toMatchObject({ _tag: "Rejected", retryable: false })
				expect(viewerIds(host)).toContain(b1)
				expect((yield* send(b.id))._tag).toBe("Applied")
				expect(viewerIds(host)).not.toContain(b1)
			}),
		))

	it("conversationSnapshot is accepted only from the conversation's host", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const { a, b, a1, hostChannelId } = world
				const { guestChannelId } = yield* share(world)
				const [conversation] = rows<{ id: string }>(b.object, `SELECT id FROM connect_conversations`)
				const [mount] = rows<{ id: string }>(
					b.object,
					`SELECT id FROM connect_conversation_channels WHERE channelId = ?`,
					guestChannelId,
				)
				const now = new Date().toISOString()
				const snapshot = (hostOrganizationId: string) => ({
					conversation: {
						id: conversation!.id,
						hostOrganizationId,
						hostChannelId,
						status: "active",
						settings: null,
						createdBy: a1,
						createdAt: now,
						updatedAt: now,
						deletedAt: null,
					},
					mounts: [
						{
							id: mount!.id,
							conversationId: conversation!.id,
							organizationId: b.id,
							channelId: guestChannelId,
							role: "guest",
							allowGuestMemberAdds: true,
							isActive: true,
							createdAt: now,
							updatedAt: now,
							deletedAt: null,
						},
					],
					hostChannel: { name: "hijacked", icon: null, type: "private" },
				})
				const send = (hostOrganizationId: string, senderId: string) =>
					b.object.applyEffect({
						objectId: b.id,
						kind: "org.connectConversationSnapshot",
						payload: snapshot(hostOrganizationId),
						key: uuid(),
						sender: { kind: "org", id: senderId },
					})
				const other = uuid()
				const name = () =>
					rows<{ name: string }>(b.object, `SELECT name FROM channels WHERE id = ?`, guestChannelId)
				// Not from the host it names, or claiming to host a conversation A hosts here.
				expect((yield* send(a.id, other))._tag).toBe("Rejected")
				expect((yield* send(other, other))._tag).toBe("Rejected")
				expect(name()).toEqual([{ name: "partners" }])
				expect((yield* send(a.id, a.id))._tag).toBe("Applied")
				expect(name()).toEqual([{ name: "hijacked" }])
			}),
		))
})
