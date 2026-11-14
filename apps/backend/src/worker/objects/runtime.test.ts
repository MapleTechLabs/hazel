/**
 * The object runtime's edges: which sockets a membership change resnapshots, presence on a
 * refused upgrade, and what an undecodable invoke reports.
 */
import type { OrganizationId, UserId } from "@hazel/schema"
import { makeFakeSocket, type FakeSocket } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, type Scope, Tracer } from "effect"
import { afterEach, describe, expect, it, vi } from "vitest"
import { decodeExit, rpcFor } from "../../rpc/dispatch"
import { orgTarget, userTarget } from "./kinds"
import { encodeInvokePrincipal, encodeSyncPrincipal, OBJECT_ID_HEADER, PRINCIPAL_HEADER } from "./principal"
import { makeTestObjects, type TestObject } from "./testing"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const hello = (object: TestObject, socket: FakeSocket) =>
	object.onMessage(socket, JSON.stringify({ _tag: "Hello", since: null }))

const resets = (socket: FakeSocket) =>
	socket.frames().filter((frame) => frame._tag === "Begin" && frame.reset === true).length

const insertUser = (org: TestObject, id: string) =>
	org.storage.db
		.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, 'First', 'Last')`,
		)
		.run(id, `ext-${id}`, `${id}@example.com`)

describe("object runtime", () => {
	afterEach(() => void vi.unstubAllGlobals())

	it("a membership write resnapshots only the member it names", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				const [owner, member, joiner] = [uuid(), uuid(), uuid()] as Array<UserId>
				const db = org.storage.db
				db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
				for (const id of [owner, member]) {
					insertUser(org, id)
					db.prepare(
						`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'member')`,
					).run(orgId, id)
				}
				yield* org.afterCommit

				const ownerSocket = makeFakeSocket()
				const memberSocket = makeFakeSocket()
				expect(yield* org.adopt(ownerSocket, { userId: owner, expiresAt: null })).toBe("accepted")
				expect(yield* org.adopt(memberSocket, { userId: member, expiresAt: null })).toBe("accepted")
				yield* hello(org, ownerSocket)
				yield* hello(org, memberSocket)
				ownerSocket.clear()
				memberSocket.clear()

				// A new member: nobody connected is affected.
				insertUser(org, joiner)
				db.prepare(
					`INSERT INTO organization_members (organizationId, userId, role) VALUES (?, ?, 'member')`,
				).run(orgId, joiner)
				yield* org.afterCommit
				expect(resets(ownerSocket)).toBe(0)
				expect(resets(memberSocket)).toBe(0)

				// The member's own row changes: only the member resnapshots.
				db.prepare(`UPDATE organization_members SET role = 'admin' WHERE userId = ?`).run(member)
				yield* org.afterCommit
				expect(resets(ownerSocket)).toBe(0)
				expect(resets(memberSocket)).toBe(1)

				// A hard delete cannot be read back: everyone resnapshots.
				ownerSocket.clear()
				memberSocket.clear()
				db.prepare(`DELETE FROM organization_members WHERE userId = ?`).run(joiner)
				yield* org.afterCommit
				expect(resets(ownerSocket)).toBe(1)
				expect(resets(memberSocket)).toBe(1)
			}),
		))

	it("a refused upgrade does not mark the owner online", () =>
		run(
			Effect.gen(function* () {
				// workerd's upgrade: a socket pair and a `101` response (node's `Response` refuses 101).
				const pairs: Array<[FakeSocket, FakeSocket]> = []
				vi.stubGlobal(
					"WebSocketPair",
					class {
						0 = makeFakeSocket()
						1 = makeFakeSocket()
						constructor() {
							pairs.push([this[0], this[1]])
						}
					},
				)
				vi.stubGlobal(
					"Response",
					class {
						constructor(
							readonly body: unknown,
							readonly init?: { status?: number },
						) {}
						get status() {
							return this.init?.status ?? 200
						}
					},
				)

				const objects = yield* makeTestObjects
				const userId = uuid() as UserId
				const user = yield* objects.get(userTarget(userId))
				const connect = (expiresAt: number | null) =>
					user.connect(
						new Request("http://object/sync", {
							headers: {
								[OBJECT_ID_HEADER]: userId,
								[PRINCIPAL_HEADER]: encodeSyncPrincipal({ userId, expiresAt }),
							},
						}),
					)
				const presence = () =>
					user.storage.db.prepare(`SELECT status FROM user_presence_status`).all() as Array<{
						status: string
					}>

				const expired = yield* connect(Date.now() - 1_000)
				expect(expired.status).toBe(101)
				expect(pairs[0]![1].closed?.code).toBe(4001)
				expect(presence()).toEqual([])

				yield* connect(null)
				expect(pairs[1]![1].closed).toBeUndefined()
				expect(presence()).toEqual([{ status: "online" }])
			}),
		))

	it("a stale heartbeat marks the owner offline although a socket is still open", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const userId = uuid() as UserId
				const user = yield* objects.get(userTarget(userId))
				// What the upgrade does first: the object learns whose it is.
				yield* user.run(user.identity.remember(userId).pipe(Effect.orDie))
				const socket = makeFakeSocket()
				expect(yield* user.adopt(socket, { userId, expiresAt: null })).toBe("accepted")
				const status = () =>
					(
						user.storage.db.prepare(`SELECT status FROM user_presence_status`).get() as {
							status: string
						}
					).status
				expect(status()).toBe("online")
				// The staleness deadline is armed while the socket is open.
				expect(user.storage.alarm()).not.toBeNull()

				// Recently seen: the alarm leaves them online.
				yield* user.alarm
				expect(status()).toBe("online")

				// The client went away without the socket closing here (asleep, network lost).
				user.storage.db
					.prepare(`UPDATE user_presence_status SET lastSeenAt = ?`)
					.run(new Date(Date.now() - 10 * 60_000).toISOString())
				yield* user.alarm
				expect(status()).toBe("offline")
			}),
		))

	it("an org marks a presence copy offline once its lease runs out", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid() as OrganizationId
				const org = yield* objects.get(orgTarget(orgId))
				yield* org.run(org.identity.remember(orgId).pipe(Effect.orDie))
				const [fresh, ghost] = [uuid(), uuid()]
				const insert = org.storage.db.prepare(
					`INSERT INTO user_presence_status (id, userId, status, updatedAt, lastSeenAt) VALUES (?, ?, 'online', ?, ?)`,
				)
				// The stored timestamp text (`packages/db` `timestamptz`).
				const stored = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 23)
				const now = stored(Date.now())
				const longAgo = stored(Date.now() - 60 * 60_000)
				insert.run(uuid(), fresh, now, now)
				// A copy whose UserObject never told this org anything again.
				insert.run(uuid(), ghost, longAgo, longAgo)
				yield* org.alarm
				const statuses = Object.fromEntries(
					(
						org.storage.db
							.prepare(`SELECT userId, status FROM user_presence_status`)
							.all() as Array<{
							userId: string
							status: string
						}>
					).map((row) => [row.userId, row.status]),
				)
				expect(statuses).toEqual({ [fresh]: "online", [ghost]: "offline" })
				// The fresh copy's lease keeps the alarm armed.
				expect(org.storage.alarm()).not.toBeNull()
			}),
		))

	it("an undecodable invoke dies with the decode error", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const orgId = uuid()
				const org = yield* objects.get(orgTarget(orgId))
				const rpc = yield* rpcFor("message.create")
				const response = yield* org.invoke({
					objectId: orgId,
					tag: "message.create",
					payload: { channelId: 42 },
					principal: yield* encodeInvokePrincipal({ user: null, botScopes: null }),
				})
				const exit = yield* decodeExit(rpc, response.exit)
				expect(Exit.isFailure(exit)).toBe(true)
				const pretty = Exit.isFailure(exit) ? Cause.pretty(exit.cause) : ""
				expect(pretty).toContain("Undecodable message.create request")
				// The request's values never reach the message (it is logged).
				expect(pretty).not.toContain("42")
			}),
		))

	it("an instance's first call is marked cold on its entry span, and no later one", () =>
		run(
			Effect.gen(function* () {
				const objects = yield* makeTestObjects
				const spans: Array<Tracer.NativeSpan> = []
				const traced = Effect.provideService(
					Tracer.Tracer,
					Tracer.make({
						span: (span) => {
							const recorded = new Tracer.NativeSpan(span)
							spans.push(recorded)
							return recorded
						},
					}),
				)
				const userId = uuid()
				const user = yield* objects.get(userTarget(userId))
				yield* traced(user.warm)
				yield* traced(user.alarm)
				// Evicted and woken: a new instance, in the same isolate.
				const woken = yield* objects.reactivate(userTarget(userId))
				yield* traced(woken.alarm)
				yield* traced(woken.warm)

				const entries = spans.filter((span) => ["SyncDO.warm", "ObjectRpc.alarm"].includes(span.name))
				expect(entries.map((span) => [span.name, span.attributes.get("object.cold")])).toEqual([
					["SyncDO.warm", true],
					["ObjectRpc.alarm", false],
					["ObjectRpc.alarm", true],
					["SyncDO.warm", false],
				])
				// One isolate: whatever its first event was, it was not one of the later ones.
				expect(entries.slice(1).map((span) => span.attributes.get("isolate.cold"))).toEqual([
					false,
					false,
					false,
				])
			}),
		))
})
