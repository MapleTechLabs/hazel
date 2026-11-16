/**
 * Agent marks on the objects (node SQLite): a message written through Hazel's MCP server (the
 * call carries `CurrentAgent`) gets a `message_agent_marks` row in the same write, streamed only
 * to viewers of the author's organization: in a Connect channel the other org's viewers get the
 * message without the mark. The user's own messages carry none; deleting drops the mark.
 */
import { SQLite, schema } from "@hazel/db"
import { CurrentUser } from "@hazel/domain"
import type {
	AgentGrantId,
	ChannelId,
	ConnectInviteId,
	MessageId,
	OrganizationId,
	UserId,
} from "@hazel/schema"
import { makeFakeSocket, type FakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { channelTarget, orgTarget } from "./kinds"
import { type AgentActor, encodeInvokePrincipal } from "./principal"
import { makeTestObjects, type TestObject, type TestObjects } from "./testing"

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

const AGENT: AgentActor = { grantId: uuid() as AgentGrantId, name: "Claude" }

const call = (
	object: TestObject,
	objectId: string,
	tag: HazelRpcTag,
	payload: unknown,
	user: string,
	agent: AgentActor | null = null,
) =>
	Effect.gen(function* () {
		const rpc = yield* rpcFor(tag)
		const response = yield* object.invoke({
			objectId,
			tag,
			payload: yield* encodePayload(rpc, payload),
			principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null, agent }),
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

const rows = <T>(object: TestObject, query: string, ...params: Array<string>) =>
	object.storage.db.prepare(query).all(...params) as Array<T>

const upserts = (socket: FakeSocket, table: string) =>
	socket
		.frames()
		.filter((frame) => frame._tag === "Rows" && frame.table === table)
		.flatMap((frame) => frame.upserts as Array<Record<string, unknown>>)

const deletes = (socket: FakeSocket, table: string) =>
	socket
		.frames()
		.filter((frame) => frame._tag === "Rows" && frame.table === table)
		.flatMap((frame) => (frame.deletes ?? []) as Array<unknown>)

const messagePayload = (channelId: ChannelId, authorId: UserId, content: string) => ({
	channelId,
	content,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	authorId,
	deletedAt: null,
})

const makeOrg = (objects: TestObjects, name: string, slug: string, owner: UserId) =>
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
		return { id, object }
	})

/** Org A (a1) shares a private channel with org B (b1). */
const makeSharedChannel = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const [a1, b1] = [uuid(), uuid()] as Array<UserId>
	yield* directoryUser(objects, a1, "Ada")
	yield* directoryUser(objects, b1, "Bea")
	const a = yield* makeOrg(objects, "Acme", "acme", a1)
	const b = yield* makeOrg(objects, "Beta", "beta", b1)
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
	const created = ok(
		yield* call(
			a.object,
			a.id,
			"connectShare.invite.create",
			{ channelId: hostChannelId, target: { kind: "slug", value: "beta" }, allowGuestMemberAdds: true },
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
	const host = yield* objects.get(channelTarget(hostChannelId))
	return { a, b, a1, b1, hostChannelId, host }
})

describe("agent marks", () => {
	it("marks an agent's message for the author's org only, not for Connect viewers", () =>
		run(
			Effect.gen(function* () {
				const { a, a1, b1, hostChannelId, host } = yield* makeSharedChannel
				const a1Socket = makeFakeSocket()
				const b1Socket = makeFakeSocket()
				expect(yield* host.adopt(a1Socket, { userId: a1, expiresAt: null })).toBe("accepted")
				expect(yield* host.adopt(b1Socket, { userId: b1, expiresAt: null })).toBe("accepted")
				yield* host.onMessage(a1Socket, JSON.stringify({ _tag: "Hello", since: null }))
				yield* host.onMessage(b1Socket, JSON.stringify({ _tag: "Hello", since: null }))
				a1Socket.clear()
				b1Socket.clear()

				// The user's own message: no mark.
				ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, "by hand"),
						a1,
					),
				)
				expect(rows(host, `SELECT id FROM message_agent_marks`)).toEqual([])

				// Through the agent: marked in the same write, with the author's org.
				const sent = ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, "drafted by Claude"),
						a1,
						AGENT,
					),
				)
				const messageId = sent.data.id as MessageId
				expect(
					rows(
						host,
						`SELECT id, organizationId, authorId, grantId, agentName FROM message_agent_marks`,
					),
				).toEqual([
					{
						id: messageId,
						organizationId: a.id,
						authorId: a1,
						grantId: AGENT.grantId,
						agentName: "Claude",
					},
				])

				// Both see the message; only a1 (Acme) sees the mark.
				expect(upserts(a1Socket, "messages").map((row) => row.content)).toEqual([
					"by hand",
					"drafted by Claude",
				])
				expect(upserts(b1Socket, "messages").map((row) => row.content)).toEqual([
					"by hand",
					"drafted by Claude",
				])
				expect(upserts(a1Socket, "message_agent_marks").map((row) => row.id)).toEqual([messageId])
				expect(upserts(b1Socket, "message_agent_marks")).toEqual([])

				// A fresh snapshot agrees.
				const b1Again = makeFakeSocket()
				expect(yield* host.adopt(b1Again, { userId: b1, expiresAt: null })).toBe("accepted")
				yield* host.onMessage(b1Again, JSON.stringify({ _tag: "Hello", since: null }))
				expect(upserts(b1Again, "messages").length).toBe(2)
				expect(upserts(b1Again, "message_agent_marks")).toEqual([])

				// Deleting the message drops its mark.
				a1Socket.clear()
				ok(
					yield* call(
						host,
						hostChannelId,
						"message.delete",
						{ id: messageId, channelId: hostChannelId },
						a1,
					),
				)
				expect(rows(host, `SELECT id FROM message_agent_marks`)).toEqual([])
				expect(deletes(a1Socket, "message_agent_marks").length).toBe(1)
			}),
		))

	it("an agent's edit marks a message the user wrote", () =>
		run(
			Effect.gen(function* () {
				const { a1, hostChannelId, host } = yield* makeSharedChannel
				const sent = ok(
					yield* call(
						host,
						hostChannelId,
						"message.create",
						messagePayload(hostChannelId, a1, "typo"),
						a1,
					),
				)
				ok(
					yield* call(
						host,
						hostChannelId,
						"message.update",
						{ id: sent.data.id, channelId: hostChannelId, content: "fixed" },
						a1,
						AGENT,
					),
				)
				expect(rows(host, `SELECT id, agentName FROM message_agent_marks`)).toEqual([
					{ id: sent.data.id, agentName: "Claude" },
				])
			}),
		))
})
