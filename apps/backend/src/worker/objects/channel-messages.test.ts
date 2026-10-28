/**
 * The `ChannelObject`'s message slice on node SQLite: messages, reactions, pins, typing and
 * attachments run through `invoke`, and the side effects that left the global outbox
 * (notifications in the `OrgObject` and `UserObject`s, bot events, thread naming, upload cleanup).
 */
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { CreateTypingIndicatorPayload } from "@hazel/domain/rpc"
import type { ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { channelTarget, orgTarget, userTarget } from "./kinds"
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

const unauthorized = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) &&
	Option.match(Cause.findErrorOption(exit.cause), {
		onNone: () => false,
		onSome: (error) => error instanceof UnauthorizedError,
	})

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

type ChannelType = "public" | "private" | "thread" | "direct" | "single"

interface World {
	readonly objects: TestObjects
	readonly org: TestObject
	readonly orgId: OrganizationId
	readonly author: UserId
	readonly alice: UserId
	readonly muted: UserId
	readonly outsider: UserId
	/** organization_members ids by user. */
	readonly memberIds: Map<UserId, string>
	readonly channel: (
		type: ChannelType,
		name?: string,
	) => Effect.Effect<{ id: ChannelId; object: TestObject }>
}

/**
 * An org with an author, alice and a muted member (channel members of every channel made with
 * `channel`), its rows written straight into the `OrgObject`, and viewers delivered to the channel.
 */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const org = yield* objects.get(orgTarget(orgId))
	const [author, alice, muted, outsider] = [uuid(), uuid(), uuid(), uuid()] as Array<UserId>
	const memberIds = new Map<UserId, string>()
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	for (const userId of [author!, alice!, muted!]) {
		const id = uuid()
		memberIds.set(userId, id)
		db.prepare(
			`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
		).run(id, orgId, userId)
	}

	const channel = (type: ChannelType, name = `${type}-channel`) =>
		Effect.gen(function* () {
			const id = uuid() as ChannelId
			db.prepare(`INSERT INTO channels (id, name, type, organizationId) VALUES (?, ?, ?, ?)`).run(
				id,
				name,
				type,
				orgId,
			)
			for (const userId of [author!, alice!, muted!]) {
				db.prepare(`INSERT INTO channel_members (channelId, userId, isMuted) VALUES (?, ?, ?)`).run(
					id,
					userId,
					userId === muted ? 1 : 0,
				)
			}
			const object = yield* objects.get(channelTarget(id))
			const applied = yield* object.applyEffect({
				objectId: id,
				kind: "channel.setViewers",
				payload: {
					organizationId: orgId,
					conversationId: null,
					viewers: [author!, alice!, muted!].map((userId) => ({
						userId,
						organizationId: orgId,
						role: "member",
					})),
					bots: [],
				},
				key: `viewers:${id}`,
			})
			expect(applied._tag).toBe("Applied")
			return { id, object }
		})

	return {
		objects,
		org,
		orgId,
		author: author!,
		alice: alice!,
		muted: muted!,
		outsider: outsider!,
		memberIds,
		channel,
	} satisfies World
})

const message = (
	channelId: ChannelId,
	authorId: UserId,
	content: string,
	replyTo: MessageId | null = null,
) => ({
	channelId,
	content,
	embeds: null,
	replyToMessageId: replyTo,
	threadChannelId: null,
	authorId,
	deletedAt: null,
})

const send = (
	world: World,
	target: { id: ChannelId; object: TestObject },
	as: UserId,
	content: string,
	replyTo?: MessageId,
) =>
	Effect.map(
		call(
			target.object,
			target.id,
			"message.create",
			message(target.id, as, content, replyTo ?? null),
			as,
		),
		(exit) => ok(exit).data as { id: MessageId },
	)

/** The notifications in `userId`'s `UserObject`, as (memberId, messageId). */
const notificationsOf = (world: World, userId: UserId) =>
	Effect.map(
		world.objects.get(userTarget(userId)),
		(object) =>
			object.storage.db.prepare(`SELECT memberId, resourceId FROM notifications`).all() as Array<{
				memberId: string
				resourceId: string
			}>,
	)

const countsIn = (world: World, channelId: ChannelId) =>
	Object.fromEntries(
		(
			world.org.storage.db
				.prepare(`SELECT userId, notificationCount FROM channel_members WHERE channelId = ?`)
				.all(channelId) as Array<{ userId: string; notificationCount: number }>
		).map((row) => [row.userId, row.notificationCount]),
	)

/** Make deferred outbox rows due and run the object's alarm. */
const runAlarm = (object: TestObject) =>
	Effect.gen(function* () {
		object.storage.db.exec(`UPDATE _outbox SET next_at = 0 WHERE status = 'pending'`)
		yield* object.alarm
	})

describe("ChannelObject messages", () => {
	it("notifies mentioned users and the replied-to author, never the author or a muted member", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")

				const first = yield* send(world, channel, world.alice, "first")
				expect(yield* notificationsOf(world, world.author)).toEqual([])

				// A reply to alice that mentions the muted member and the author themself.
				const reply = yield* send(
					world,
					channel,
					world.author,
					`@[userId:${world.muted}] @[userId:${world.author}] see above`,
					first.id,
				)
				expect(yield* notificationsOf(world, world.alice)).toEqual([
					{ memberId: world.memberIds.get(world.alice), resourceId: reply.id },
				])
				expect(yield* notificationsOf(world, world.muted)).toEqual([])
				expect(yield* notificationsOf(world, world.author)).toEqual([])
				expect(countsIn(world, channel.id)).toEqual({
					[world.author]: 0,
					[world.alice]: 1,
					[world.muted]: 0,
				})
			}),
		))

	it("notifies every unmuted member in a DM, and on @channel, except who is looking at it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const dm = yield* world.channel("direct")
				const sent = yield* send(world, dm, world.author, "hey")
				expect((yield* notificationsOf(world, world.alice)).map((n) => n.resourceId)).toEqual([
					sent.id,
				])
				expect(yield* notificationsOf(world, world.muted)).toEqual([])

				// Alice is online in the channel: no notification for her.
				const channel = yield* world.channel("public")
				world.org.storage.db
					.prepare(
						`INSERT INTO user_presence_status (userId, status, activeChannelId, suppressNotifications) VALUES (?, 'online', ?, 0)`,
					)
					.run(world.alice, channel.id)
				yield* send(world, channel, world.author, "@[directive:channel] standup")
				expect((yield* notificationsOf(world, world.alice)).length).toBe(1)
				expect(countsIn(world, channel.id)[world.alice]).toBe(0)
			}),
		))

	it("update and delete: the author's, bots hear about them, others are refused", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")
				channel.object.storage.db
					.prepare(`INSERT INTO channel_bots (botId, botUserId) VALUES (?, ?)`)
					.run(uuid(), uuid())
				const sent = yield* send(world, channel, world.author, "draft")

				const denied = yield* call(
					channel.object,
					channel.id,
					"message.update",
					{ id: sent.id, channelId: channel.id, content: "hijack" },
					world.alice,
				)
				expect(unauthorized(denied)).toBe(true)

				const updated = ok(
					yield* call(
						channel.object,
						channel.id,
						"message.update",
						{ id: sent.id, channelId: channel.id, content: "final" },
						world.author,
					),
				)
				expect(updated.data.content).toBe("final")

				ok(
					yield* call(
						channel.object,
						channel.id,
						"message.delete",
						{ id: sent.id, channelId: channel.id },
						world.author,
					),
				)
				expect(world.objects.published.map((p) => p.envelope.eventType)).toEqual([
					"message.create",
					"message.update",
					"message.delete",
				])
				const left = channel.object.storage.db
					.prepare(`SELECT count(*) AS n FROM messages`)
					.get() as {
					n: number
				}
				expect(left.n).toBe(0)
			}),
		))

	it("messageReaction.toggle adds then removes; outsiders are refused", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")
				const sent = yield* send(world, channel, world.author, "react to me")
				const toggle = (as: UserId) =>
					call(
						channel.object,
						channel.id,
						"messageReaction.toggle",
						{ messageId: sent.id, channelId: channel.id, emoji: "🎉" },
						as,
					)

				const added = ok(yield* toggle(world.alice))
				expect(added.wasCreated).toBe(true)
				expect(added.transactionId).toMatch(new RegExp(`^channel:${channel.id}:\\d+$`))
				const removed = ok(yield* toggle(world.alice))
				expect(removed.wasCreated).toBe(false)
				const reactions = channel.object.storage.db
					.prepare(`SELECT count(*) AS n FROM message_reactions`)
					.get() as { n: number }
				expect(reactions.n).toBe(0)

				expect(unauthorized(yield* toggle(world.outsider))).toBe(true)
			}),
		))

	it("pinnedMessage.create pins for a viewer, refuses an outsider", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")
				const sent = yield* send(world, channel, world.author, "pin me")
				const pin = (as: UserId) =>
					call(
						channel.object,
						channel.id,
						"pinnedMessage.create",
						{ channelId: channel.id, messageId: sent.id },
						as,
					)
				const pinned = ok(yield* pin(world.alice))
				expect(pinned.data.pinnedBy).toBe(world.alice)
				expect(unauthorized(yield* pin(world.outsider))).toBe(true)
			}),
		))

	it("typing indicators expire on the alarm", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")
				const typing = ok(
					yield* call(
						channel.object,
						channel.id,
						"typingIndicator.create",
						new CreateTypingIndicatorPayload({
							channelId: channel.id,
							memberId: uuid() as ChannelMemberId,
							lastTyped: Date.now() + 3_600_000,
						}),
						world.alice,
					),
				)
				// The object's clock, not the client's.
				expect(typing.data.lastTyped).toBeLessThanOrEqual(Date.now())
				expect(channel.object.storage.alarm()).not.toBeNull()
				expect(
					unauthorized(
						yield* call(
							channel.object,
							channel.id,
							"typingIndicator.create",
							new CreateTypingIndicatorPayload({
								channelId: channel.id,
								memberId: uuid() as ChannelMemberId,
							}),
							world.outsider,
						),
					),
				).toBe(true)

				channel.object.storage.db.exec(`UPDATE typing_indicators SET lastTyped = 0`)
				yield* channel.object.alarm
				const left = channel.object.storage.db
					.prepare(`SELECT count(*) AS n FROM typing_indicators`)
					.get() as { n: number }
				expect(left.n).toBe(0)
			}),
		))

	it("uploads: created for viewers only, failed by the alarm once stale", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const channel = yield* world.channel("public")
				const create = (uploadedBy: UserId, id: string) =>
					channel.object.applyEffect({
						objectId: channel.id,
						kind: "channel.createAttachment",
						payload: {
							id,
							organizationId: world.orgId,
							channelId: channel.id,
							uploadedBy,
							fileName: "a.png",
							fileSize: 10,
						},
						key: `attachment:${id}`,
					})
				const fresh = uuid()
				const stale = uuid()
				expect((yield* create(world.alice, fresh))._tag).toBe("Applied")
				expect((yield* create(world.alice, stale))._tag).toBe("Applied")
				expect((yield* create(world.outsider, uuid()))._tag).toBe("Rejected")
				expect(channel.object.storage.alarm()).not.toBeNull()

				channel.object.storage.db
					.prepare(`UPDATE attachments SET uploadedAt = '2000-01-01 00:00:00.000' WHERE id = ?`)
					.run(stale)
				yield* channel.object.alarm
				const statuses = Object.fromEntries(
					(
						channel.object.storage.db
							.prepare(`SELECT id, status FROM attachments`)
							.all() as Array<{
							id: string
							status: string
						}>
					).map((row) => [row.id, row.status]),
				)
				expect(statuses).toEqual({ [fresh]: "uploading", [stale]: "failed" })
			}),
		))

	it("threads: linked from the parent, named once past 3 replies, renamed in the OrgObject", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const parent = yield* world.channel("public")
				const thread = yield* world.channel("thread", "Thread")
				const original = yield* send(world, parent, world.author, "Shall we ship Friday?")

				// The OrgObject's channel.createThread sends this to the parent.
				const linked = yield* parent.object.applyEffect({
					objectId: parent.id,
					kind: "channel.setThreadChannel",
					payload: { messageId: original.id, threadChannelId: thread.id },
					key: uuid(),
				})
				expect(linked._tag).toBe("Applied")
				const parentRow = parent.object.storage.db
					.prepare(`SELECT threadChannelId FROM messages WHERE id = ?`)
					.get(original.id) as { threadChannelId: string }
				expect(parentRow.threadChannelId).toBe(thread.id)

				for (const text of ["yes", "no", "maybe"]) yield* send(world, thread, world.alice, text)
				const aiRows = () =>
					(
						thread.object.storage.db
							.prepare(`SELECT count(*) AS n FROM _outbox WHERE target = 'ai'`)
							.get() as { n: number }
					).n
				expect(aiRows()).toBe(0)
				yield* send(world, thread, world.author, "let's do it")
				yield* send(world, thread, world.author, "done")
				// Requested once, and left to the alarm.
				expect(aiRows()).toBe(1)
				expect(world.objects.namingRequests).toEqual([])

				world.objects.setThreadName("Friday ship plan")
				yield* runAlarm(thread.object)
				expect(aiRows()).toBe(0)
				expect(world.objects.namingRequests.length).toBe(1)
				expect(world.objects.namingRequests[0]!.original?.content).toBe("Shall we ship Friday?")
				expect(world.objects.namingRequests[0]!.replies.length).toBe(5)
				const renamed = world.org.storage.db
					.prepare(`SELECT name FROM channels WHERE id = ?`)
					.get(thread.id) as { name: string }
				expect(renamed.name).toBe("Friday ship plan")

				// channel.generateName (admins and owners) renames whatever the name is now.
				const asMember = yield* call(
					thread.object,
					thread.id,
					"channel.generateName",
					{ channelId: thread.id },
					world.alice,
				)
				expect(unauthorized(asMember)).toBe(true)
				thread.object.storage.db
					.prepare(`UPDATE channel_viewers SET role = 'admin' WHERE userId = ?`)
					.run(world.alice)
				world.objects.setThreadName("Second name")
				ok(
					yield* call(
						thread.object,
						thread.id,
						"channel.generateName",
						{ channelId: thread.id },
						world.alice,
					),
				)
				yield* runAlarm(thread.object)
				const again = world.org.storage.db
					.prepare(`SELECT name FROM channels WHERE id = ?`)
					.get(thread.id) as { name: string }
				expect(again.name).toBe("Second name")

				// Not a thread: refused.
				parent.object.storage.db
					.prepare(`UPDATE channel_viewers SET role = 'admin' WHERE userId = ?`)
					.run(world.alice)
				const plain = yield* call(
					parent.object,
					parent.id,
					"channel.generateName",
					{ channelId: parent.id },
					world.alice,
				)
				expect(Exit.isFailure(plain)).toBe(true)
			}),
		))
})
