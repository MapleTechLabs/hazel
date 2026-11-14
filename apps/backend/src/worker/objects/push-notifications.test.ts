/**
 * Push notifications end to end on node SQLite: a message in a `ChannelObject` notifies through
 * the `OrgObject` into the recipient's `UserObject`, which pushes to its devices (a fake
 * `ApnsClient`, `./testing.ts`) at once while the user is idle, or once deferred and still unread.
 */
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { SQLite, schema } from "@hazel/db"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { channelTarget, orgTarget, userTarget } from "./kinds"
import { encodeInvokePrincipal } from "./principal"
import { makeTestObjects, makeTestObjectsWith, type TestObject, type TestObjects } from "./testing"

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

const TOKEN = "a1".repeat(32)
const BUNDLE = "app.hazel.ios"

/** An org `acme` with Ada (the author) and Alice in `#general`, viewers delivered. */
const makeWorld = (objects: TestObjects) =>
	Effect.gen(function* () {
		const orgId = uuid() as OrganizationId
		const org = yield* objects.get(orgTarget(orgId))
		const [ada, alice] = [uuid(), uuid()] as Array<UserId>
		const db = org.storage.db
		db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
		for (const [userId, first, last] of [
			[ada!, "Ada", "Lovelace"],
			[alice!, "Alice", "Liddell"],
		] as const) {
			db.prepare(
				`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
			).run(uuid(), orgId, userId)
			db.prepare(
				`INSERT INTO users (id, externalId, email, firstName, lastName) VALUES (?, ?, ?, ?, ?)`,
			).run(userId, `ext-${userId}`, `${userId}@example.com`, first, last)
		}
		const channelId = uuid() as ChannelId
		db.prepare(
			`INSERT INTO channels (id, name, type, organizationId) VALUES (?, 'general', 'public', ?)`,
		).run(channelId, orgId)
		for (const userId of [ada!, alice!]) {
			db.prepare(`INSERT INTO channel_members (channelId, userId) VALUES (?, ?)`).run(channelId, userId)
		}
		const channel = yield* objects.get(channelTarget(channelId))
		const applied = yield* channel.applyEffect({
			objectId: channelId,
			kind: "channel.setViewers",
			payload: {
				organizationId: orgId,
				conversationId: null,
				viewers: [ada!, alice!].map((userId) => ({ userId, organizationId: orgId, role: "member" })),
				bots: [],
			},
			key: `viewers:${channelId}`,
			sender: { kind: "org", id: orgId },
		})
		expect(applied._tag).toBe("Applied")
		const aliceObject = yield* objects.get(userTarget(alice!))
		return { objects, orgId, org, ada: ada!, alice: alice!, channelId, channel, aliceObject }
	})

type World = Effect.Success<ReturnType<typeof makeWorld>>

const register = (world: World, token = TOKEN, environment: "development" | "production" = "production") =>
	Effect.map(
		call(
			world.aliceObject,
			world.alice,
			"pushDevice.register",
			{ token, environment, bundleId: BUNDLE },
			world.alice,
		),
		ok,
	)

/** Ada mentions Alice in #general. */
const mentionAlice = (world: World, text = "lunch?") =>
	Effect.map(
		call(
			world.channel,
			world.channelId,
			"message.create",
			{
				channelId: world.channelId,
				content: `@[userId:${world.alice}] ${text}`,
				embeds: null,
				replyToMessageId: null,
				threadChannelId: null,
				authorId: world.ada,
				deletedAt: null,
			},
			world.ada,
		),
		(exit) => ok(exit).data as { id: MessageId },
	)

const devicesOf = (object: TestObject) =>
	object.storage.db.prepare(`SELECT token, environment, bundleId FROM push_devices`).all() as Array<{
		token: string
		environment: string
		bundleId: string
	}>

const notificationsOf = (object: TestObject) =>
	object.storage.db.prepare(`SELECT id FROM notifications`).all() as Array<{ id: string }>

const pendingPushes = (object: TestObject) =>
	(
		object.storage.db
			.prepare(`SELECT count(*) AS n FROM _outbox WHERE kind = 'push.send' AND status = 'pending'`)
			.get() as { n: number }
	).n

/** Make deferred outbox rows due and run the object's alarm. */
const runAlarm = (object: TestObject) =>
	Effect.gen(function* () {
		object.storage.db.exec(`UPDATE _outbox SET next_at = 0 WHERE status = 'pending'`)
		yield* object.alarm
	})

describe("push devices", () => {
	it("register is an upsert and unregister forgets the token, both idempotent", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world, TOKEN, "development")
				yield* register(world, TOKEN, "production")
				expect(devicesOf(world.aliceObject)).toEqual([
					{ token: TOKEN, environment: "production", bundleId: BUNDLE },
				])
				const unregister = () =>
					Effect.map(
						call(
							world.aliceObject,
							world.alice,
							"pushDevice.unregister",
							{ token: TOKEN },
							world.alice,
						),
						ok,
					)
				yield* unregister()
				yield* unregister()
				expect(devicesOf(world.aliceObject)).toEqual([])
			}),
		))

	it("refuses a call in someone else's UserObject", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				const exit = yield* call(
					world.aliceObject,
					world.alice,
					"pushDevice.register",
					{ token: TOKEN, environment: "production", bundleId: BUNDLE },
					world.ada,
				)
				expect(
					Exit.isFailure(exit) &&
						Option.match(Cause.findErrorOption(exit.cause), {
							onNone: () => false,
							onSome: (error) => error instanceof UnauthorizedError,
						}),
				).toBe(true)
				expect(devicesOf(world.aliceObject)).toEqual([])
			}),
		))
})

describe("push notifications", () => {
	it("pushes a mention to an idle user's device: title, body, badge, path, topic", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				yield* mentionAlice(world)

				const [notification] = notificationsOf(world.aliceObject)
				expect(world.objects.pushes).toEqual([
					{
						environment: "production",
						token: TOKEN,
						topic: BUNDLE,
						expiration: expect.any(Number),
						collapseId: expect.any(String),
						payload: {
							aps: {
								alert: { title: "Ada Lovelace · #general", body: "@Alice Liddell lunch?" },
								sound: "default",
								badge: 1,
								"thread-id": world.channelId,
							},
							hazel: {
								path: `/acme/chat/${world.channelId}`,
								channelId: world.channelId,
								notificationId: notification!.id,
							},
						},
					},
				])
				expect(pendingPushes(world.aliceObject)).toBe(0)
			}),
		))

	it("does not push without devices, or when APNs is not configured", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* mentionAlice(world)
				expect(notificationsOf(world.aliceObject).length).toBe(1)
				expect(world.objects.pushes).toEqual([])

				const off = yield* makeWorld(yield* makeTestObjectsWith({ apns: false }))
				yield* register(off)
				yield* mentionAlice(off)
				expect(notificationsOf(off.aliceObject).length).toBe(1)
				expect(off.objects.pushes).toEqual([])
				expect(pendingPushes(off.aliceObject)).toBe(0)
			}),
		))

	it("does not push a silent notification, or one from before push (no content)", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				const deliver = (key: string, payload: Record<string, unknown>) =>
					world.aliceObject.applyEffect({
						objectId: world.alice,
						kind: "user.createNotification",
						payload: {
							memberId: uuid(),
							channelId: world.channelId,
							messageId: uuid(),
							...payload,
						},
						key,
						sender: { kind: "org", id: world.orgId },
					})
				const push = { title: "Ada Lovelace · #general", body: "hi" }
				expect((yield* deliver("silent", { reason: "mention", silent: true, push }))._tag).toBe(
					"Applied",
				)
				// The payload an older OrgObject enqueued: no push fields at all.
				expect((yield* deliver("old", { reason: "mention", silent: false }))._tag).toBe("Applied")
				expect((yield* deliver("oldest", {}))._tag).toBe("Applied")
				expect(notificationsOf(world.aliceObject).length).toBe(3)
				expect(world.objects.pushes).toEqual([])
				expect(pendingPushes(world.aliceObject)).toBe(0)
			}),
		))

	it("defers while the user is online elsewhere, then pushes if still unread", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				ok(
					yield* call(
						world.aliceObject,
						world.alice,
						"userPresenceStatus.heartbeat",
						{},
						world.alice,
					),
				)
				yield* mentionAlice(world)
				expect(notificationsOf(world.aliceObject).length).toBe(1)
				expect(world.objects.pushes).toEqual([])
				expect(pendingPushes(world.aliceObject)).toBe(1)

				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes.length).toBe(1)
				expect(world.objects.pushes[0]!.payload.aps.alert.body).toBe("@Alice Liddell lunch?")
				expect(pendingPushes(world.aliceObject)).toBe(0)
			}),
		))

	it("drops a deferred push once the user read the channel", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				ok(
					yield* call(
						world.aliceObject,
						world.alice,
						"userPresenceStatus.heartbeat",
						{},
						world.alice,
					),
				)
				yield* mentionAlice(world)
				expect(pendingPushes(world.aliceObject)).toBe(1)

				// Alice reads #general on her laptop (`channelMember.clearNotifications` in the org).
				const cleared = yield* world.aliceObject.applyEffect({
					objectId: world.alice,
					kind: "user.clearChannelNotifications",
					payload: { channelId: world.channelId },
					key: `clear:${world.channelId}`,
					sender: { kind: "org", id: world.orgId },
				})
				expect(cleared._tag).toBe("Applied")
				expect(notificationsOf(world.aliceObject)).toEqual([])

				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes).toEqual([])
				expect(pendingPushes(world.aliceObject)).toBe(0)
			}),
		))

	it("forgets a device APNs calls unregistered; retries a 503", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				world.objects.setApnsResult({ status: 503, reason: "ServiceUnavailable" })
				yield* mentionAlice(world)
				expect(world.objects.pushes.length).toBe(1)
				// Retryable: the row stays for the alarm, the device stays.
				expect(pendingPushes(world.aliceObject)).toBe(1)
				expect(devicesOf(world.aliceObject).length).toBe(1)

				world.objects.setApnsResult({ status: 410, reason: "Unregistered" })
				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes.length).toBe(2)
				expect(pendingPushes(world.aliceObject)).toBe(0)
				expect(devicesOf(world.aliceObject)).toEqual([])
			}),
		))

	it("stops retrying once the notification is older than APNs's expiry", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				world.objects.setApnsResult({ status: 503, reason: "ServiceUnavailable" })
				yield* mentionAlice(world)
				expect(world.objects.pushes.length).toBe(1)

				world.aliceObject.storage.db
					.prepare(`UPDATE notifications SET createdAt = ?`)
					.run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes.length).toBe(1)
				expect(pendingPushes(world.aliceObject)).toBe(0)
			}),
		))

	it("retries an expired provider token; drops a push APNs refuses the key for", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				world.objects.setApnsResult({ status: 403, reason: "ExpiredProviderToken" })
				yield* mentionAlice(world)
				expect(pendingPushes(world.aliceObject)).toBe(1)

				world.objects.setApnsResult({ status: 200, reason: null })
				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes.length).toBe(2)
				expect(pendingPushes(world.aliceObject)).toBe(0)

				world.objects.setApnsResult({ status: 403, reason: "InvalidProviderToken" })
				yield* mentionAlice(world, "again")
				expect(world.objects.pushes.length).toBe(3)
				expect(pendingPushes(world.aliceObject)).toBe(0)
				expect(devicesOf(world.aliceObject).length).toBe(1)
			}),
		))

	it("collapses by notification, expires a day after it, and badges only unread sounds", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				// A silent notification already waiting: not in the badge.
				yield* world.aliceObject.applyEffect({
					objectId: world.alice,
					kind: "user.createNotification",
					payload: {
						memberId: uuid(),
						channelId: world.channelId,
						messageId: uuid(),
						silent: true,
					},
					key: "silent",
					sender: { kind: "org", id: world.orgId },
				})
				yield* mentionAlice(world)
				const created = world.aliceObject.storage.db
					.prepare(`SELECT id, createdAt FROM notifications WHERE silent = 0`)
					.get() as { id: string; createdAt: string }
				const [push] = world.objects.pushes
				expect(push!.payload.aps.badge).toBe(1)
				expect(push!.collapseId).toBe(created.id)
				const createdMs = Date.parse(`${created.createdAt.replace(" ", "T").replace(/Z?$/, "Z")}`)
				expect(push!.expiration).toBe(Math.floor((createdMs + 24 * 60 * 60 * 1000) / 1000))
			}),
		))

	it("keeps at most 10 devices, dropping the least recently registered", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				const tokens = Array.from({ length: 11 }, (_, i) =>
					i.toString(16).padStart(2, "0").repeat(32),
				)
				for (const [i, token] of tokens.entries()) {
					yield* register(world, token)
					// Distinct registration times, oldest first.
					world.aliceObject.storage.db
						.prepare(`UPDATE push_devices SET updatedAt = ? WHERE token = ?`)
						.run(new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), token)
				}
				const left = devicesOf(world.aliceObject).map((device) => device.token)
				expect(left.length).toBe(10)
				expect(left).not.toContain(tokens[0])
			}),
		))

	it("drops a deferred push once its message is deleted", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				ok(
					yield* call(
						world.aliceObject,
						world.alice,
						"userPresenceStatus.heartbeat",
						{},
						world.alice,
					),
				)
				const sent = yield* mentionAlice(world)
				expect(pendingPushes(world.aliceObject)).toBe(1)
				const unreadCount = () =>
					(
						world.org.storage.db
							.prepare(
								`SELECT notificationCount FROM channel_members WHERE userId = ? AND channelId = ?`,
							)
							.get(world.alice, world.channelId) as { notificationCount: number }
					).notificationCount
				expect(unreadCount()).toBe(1)

				ok(
					yield* call(
						world.channel,
						world.channelId,
						"message.delete",
						{ id: sent.id, channelId: world.channelId },
						world.ada,
					),
				)
				expect(notificationsOf(world.aliceObject)).toEqual([])

				yield* runAlarm(world.aliceObject)
				expect(world.objects.pushes).toEqual([])
				expect(pendingPushes(world.aliceObject)).toBe(0)
				// The channel's unread count comes down with the notification.
				expect(unreadCount()).toBe(0)
			}),
		))
})

describe("push device ownership", () => {
	const ownerOf = (world: World, token: string) =>
		Directory.use(({ db }) =>
			db.run(
				SQLite.from(schema.pushDeviceTokensTable)
					.select("userId")
					.where(($) => [$.token.eq(token)]),
			),
		).pipe(
			Effect.provideContext(world.objects.directory),
			Effect.map((rows) => rows.map((row) => row.userId)),
		)

	it("a token registered by another user leaves the previous owner's object", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				yield* register(world)
				expect(yield* ownerOf(world, TOKEN)).toEqual([world.alice])

				// Ada signs in on Alice's phone; Alice's unregister never landed.
				const adaObject = yield* world.objects.get(userTarget(world.ada))
				ok(
					yield* call(
						adaObject,
						world.ada,
						"pushDevice.register",
						{ token: TOKEN, environment: "production", bundleId: BUNDLE },
						world.ada,
					),
				)
				expect(yield* ownerOf(world, TOKEN)).toEqual([world.ada])
				// The forget goes out from Ada's outbox.
				yield* runAlarm(adaObject)
				expect(devicesOf(world.aliceObject)).toEqual([])
				expect(devicesOf(adaObject).map((device) => device.token)).toEqual([TOKEN])

				yield* mentionAlice(world)
				expect(notificationsOf(world.aliceObject).length).toBe(1)
				expect(world.objects.pushes).toEqual([])
			}),
		))

	it("an older claim never takes a token back; unregister releases only one's own", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld(yield* makeTestObjects)
				const adaObject = yield* world.objects.get(userTarget(world.ada))
				ok(
					yield* call(
						adaObject,
						world.ada,
						"pushDevice.register",
						{ token: TOKEN, environment: "production", bundleId: BUNDLE },
						world.ada,
					),
				)
				// Ada's registration is newer than Alice's claim (her claim arrives late): Alice's
				// object forgets the token itself, and the directory keeps Ada.
				yield* Directory.use(({ db }) =>
					db.run(
						SQLite.update(schema.pushDeviceTokensTable)
							.set({ updatedAt: new Date(Date.now() + 60 * 60 * 1000) })
							.where(($) => [$.token.eq(TOKEN)]),
					),
				).pipe(Effect.provideContext(world.objects.directory))
				yield* register(world)
				yield* runAlarm(world.aliceObject)
				expect(devicesOf(world.aliceObject)).toEqual([])
				expect(yield* ownerOf(world, TOKEN)).toEqual([world.ada])
				expect(devicesOf(adaObject).length).toBe(1)

				// A forget from anything but a UserObject is refused.
				const refused = yield* adaObject.applyEffect({
					objectId: world.ada,
					kind: "user.forgetPushDevice",
					payload: { token: TOKEN, claimedAt: new Date().toISOString() },
					key: "forged",
					sender: { kind: "org", id: world.orgId },
				})
				expect(refused._tag).toBe("Rejected")
				expect(devicesOf(adaObject).length).toBe(1)

				// Alice unregistering a token Ada holds leaves Ada's directory row.
				ok(
					yield* call(
						world.aliceObject,
						world.alice,
						"pushDevice.unregister",
						{ token: TOKEN },
						world.alice,
					),
				)
				expect(yield* ownerOf(world, TOKEN)).toEqual([world.ada])
				ok(yield* call(adaObject, world.ada, "pushDevice.unregister", { token: TOKEN }, world.ada))
				expect(yield* ownerOf(world, TOKEN)).toEqual([])
			}),
		))
})
