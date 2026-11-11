/**
 * `MessageLiveObject` on node: the state machine, who may write and read (asked of a real
 * `ChannelObject` from `makeTestObjects`), the socket stream, and the snapshot written into the
 * message on `Complete`/`Fail`, retried from the alarm while the channel is unreachable.
 */
import { CurrentUser, InternalServerError } from "@hazel/domain"
import { initialLiveState, type LiveAction, type LiveServerFrame } from "@hazel/domain/live"
import { SyncCloseCode } from "@hazel/domain/sync"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { type FakeSocket, makeFakeSocket, makeFakeState } from "@hazel/sync-do/testing"
import { Cause, Effect, Exit, Layer, Option, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { channelTarget } from "../objects/kinds"
import type { InvokePrincipal } from "../objects/principal"
import { ObjectStubs } from "../objects/protocol"
import { makeTestObjects, type TestObject } from "../objects/testing"
import { readLive, writeLive } from "./client"
import {
	LIVE_STATE_LIMIT_BYTES,
	LiveObjectStubs,
	type LiveStorage,
	liveRpcOf,
	makeMessageLiveRuntime,
} from "./runtime"
import { applyLiveAction } from "./state"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const principalOf = (id: UserId): InvokePrincipal => ({
	user: new CurrentUser.Schema({
		id,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	}),
	botScopes: null,
})

const makeStorage = () => {
	const values = new Map<string, unknown>()
	let alarm: number | null = null
	const storage: LiveStorage & { readonly alarm: () => number | null } = {
		get: async <T>(key: string) => structuredClone(values.get(key)) as T | undefined,
		put: async (key, value) => void values.set(key, structuredClone(value)),
		delete: async (key) => values.delete(key),
		setAlarm: async (time) => void (alarm = time),
		alarm: () => alarm,
	}
	return storage
}

/** A channel whose viewers are the bot user and alice, and a live message the bot wrote. */
const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const channelId = uuid() as ChannelId
	const messageId = uuid() as MessageId
	const [bot, alice, outsider] = [uuid(), uuid(), uuid()] as Array<UserId>
	const channel = yield* objects.get(channelTarget(channelId))
	const applied = yield* channel.applyEffect({
		objectId: channelId,
		kind: "channel.setViewers",
		payload: {
			organizationId: orgId,
			conversationId: null,
			viewers: [bot!, alice!].map((userId) => ({ userId, organizationId: orgId, role: "member" })),
			bots: [],
		},
		key: `viewers:${channelId}`,
		sender: { kind: "org", id: orgId },
	})
	expect(applied._tag).toBe("Applied")
	channel.storage.db
		.prepare(`INSERT INTO messages (id, channelId, authorId, content, embeds) VALUES (?, ?, ?, '', ?)`)
		.run(messageId, channelId, bot!, JSON.stringify([{ liveState: { enabled: true } }]))

	// The channel can be made unreachable for the live object's calls.
	let unreachable = false
	const stubs: typeof objects.stubs = {
		get: (target) => {
			const stub = objects.stubs.get(target)
			return {
				...stub,
				invoke: (request) =>
					unreachable ? Effect.fail(new Error("channel unreachable")) : stub.invoke(request),
			}
		},
	}
	const storage = makeStorage()
	const state = makeFakeState()
	const make = () =>
		makeMessageLiveRuntime({ storage, state, newId: uuid }).pipe(
			Effect.provideService(ObjectStubs, stubs),
		)
	const live = yield* make()
	return {
		objects,
		channel,
		channelId,
		messageId,
		bot: bot!,
		alice: alice!,
		outsider: outsider!,
		live,
		make,
		storage,
		state,
		orgId,
		setUnreachable: (value: boolean) => void (unreachable = value),
	}
})
type World = Effect.Success<typeof makeWorld>

const write = (world: World, as: UserId, action: LiveAction) =>
	world.live.write({
		messageId: world.messageId,
		channelId: world.channelId,
		principal: principalOf(as),
		action,
	})

const connect = (
	world: World,
	as: UserId,
	socket: FakeSocket = makeFakeSocket(),
	expiresAt: number | null = null,
) =>
	Effect.map(
		world.live.adopt(socket, { userId: as, expiresAt }, world.messageId, world.channelId),
		(decision) => ({ decision, socket }),
	)

const tags = (socket: FakeSocket) => socket.frames().map((frame) => frame._tag)

const failureTag = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit)
		? Option.match(Cause.findErrorOption(exit.cause), {
				onNone: () => "defect",
				onSome: (error) => (error as { _tag: string })._tag,
			})
		: "success"

const messageRow = (channel: TestObject, messageId: MessageId) =>
	channel.storage.db.prepare(`SELECT content, embeds FROM messages WHERE id = ?`).get(messageId) as {
		content: string
		embeds: string
	}

describe("live state machine", () => {
	const clock = { now: 1000, newId: () => "step-1" }

	it("clamps progress and fails the steps still running with the reply", () => {
		const progressed = applyLiveAction(initialLiveState, { _tag: "SetProgress", progress: 140 }, clock)
		expect(progressed.state.progress).toBe(100)
		const thinking = applyLiveAction(progressed.state, { _tag: "StartThinking" }, clock)
		expect(thinking.stepId).toBe("step-1")
		expect(thinking.state.currentStepIndex).toBe(0)
		const failed = applyLiveAction(thinking.state, { _tag: "Fail", error: "boom" }, clock)
		expect(failed.state).toMatchObject({ status: "failed", error: "boom", isStreaming: false })
		expect(failed.state.steps[0]).toMatchObject({ status: "failed", completedAt: 1000 })
	})

	it("appends step content, and ignores unknown steps", () => {
		const added = applyLiveAction(initialLiveState, { _tag: "StartThinking" }, clock)
		const appended = applyLiveAction(
			applyLiveAction(
				added.state,
				{ _tag: "UpdateStepContent", stepId: "step-1", content: "a", append: true },
				clock,
			).state,
			{ _tag: "UpdateStepContent", stepId: "step-1", content: "b", append: true },
			clock,
		)
		expect(appended.state.steps[0]?.content).toBe("ab")
		const missing = applyLiveAction(appended.state, { _tag: "StartStep", stepId: "nope" }, clock)
		expect(missing.frames).toEqual([])
		expect(missing.state).toBe(appended.state)
	})
})

describe("MessageLiveObject", () => {
	it("streams the author's writes to a viewer's socket: a snapshot, then one frame per change", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const viewer = yield* connect(world, world.alice)
				expect(viewer.decision).toBe("accepted")
				expect(tags(viewer.socket)).toEqual(["Snapshot"])

				yield* write(world, world.bot, { _tag: "Start", data: { model: "m" } })
				yield* write(world, world.bot, { _tag: "AppendText", text: "Hel" })
				yield* write(world, world.bot, { _tag: "AppendText", text: "lo" })
				const step = yield* write(world, world.bot, {
					_tag: "StartToolCall",
					toolName: "search",
					toolInput: {},
				})
				expect(step.stepId).not.toBeNull()
				yield* write(world, world.bot, {
					_tag: "CompleteStep",
					stepId: step.stepId!,
					output: { hits: 1 },
				})

				expect(tags(viewer.socket)).toEqual([
					"Snapshot",
					"Started",
					"TextAppended",
					"TextAppended",
					"StepAdded",
					"StepCompleted",
				])
				const frames = viewer.socket.frames() as unknown as Array<LiveServerFrame>
				expect(frames[2]).toEqual({ _tag: "TextAppended", chunk: "Hel" })
				expect(world.live.state()).toMatchObject({
					status: "active",
					text: "Hello",
					data: { model: "m" },
				})
				expect(world.live.state().steps[0]).toMatchObject({
					status: "completed",
					toolOutput: { hits: 1 },
				})

				// A late socket starts from the whole state.
				const late = yield* connect(world, world.alice)
				expect(late.socket.frames()[0]).toMatchObject({ _tag: "Snapshot", state: { text: "Hello" } })
			}),
		))

	it("refuses writes from anyone but the message's author", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const exit = yield* Effect.exit(
					write(world, world.alice, { _tag: "AppendText", text: "nope" }),
				)
				expect(failureTag(exit)).toBe("UnauthorizedError")
				expect(world.live.state().text).toBe("")
				// Once bound, the author still writes without asking the channel again.
				world.setUnreachable(true)
				yield* write(world, world.bot, { _tag: "AppendText", text: "ok" })
				expect(world.live.state().text).toBe("ok")
			}),
		))

	it("refuses a write that would grow the state past its limit, without broadcasting it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const viewer = yield* connect(world, world.alice)
				const chunk = "x".repeat(LIVE_STATE_LIMIT_BYTES / 2)
				yield* write(world, world.bot, { _tag: "AppendText", text: chunk })
				const exit = yield* Effect.exit(write(world, world.bot, { _tag: "AppendText", text: chunk }))
				expect(failureTag(exit)).toBe("LiveStateTooLargeError")
				expect(world.live.state().text).toBe(chunk)
				expect(tags(viewer.socket)).toEqual(["Snapshot", "TextAppended"])
				// Replacing the text still works.
				yield* write(world, world.bot, { _tag: "SetText", text: "short" })
				expect(world.live.state().text).toBe("short")
			}),
		))

	it("refuses readers who are not viewers of the channel, and unknown messages", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const outsider = yield* connect(world, world.outsider)
				expect(outsider.decision).toBe("forbidden")
				expect(outsider.socket.closed?.code).toBe(4003)
				expect(outsider.socket.sent).toEqual([])
				const read = yield* Effect.exit(
					world.live.read({
						messageId: world.messageId,
						channelId: world.channelId,
						userId: world.outsider,
					}),
				)
				expect(failureTag(read)).toBe("UnauthorizedError")

				// The object is bound to its message's channel: another channel finds nothing.
				const elsewhere = yield* Effect.exit(
					world.live.read({
						messageId: world.messageId,
						channelId: uuid() as ChannelId,
						userId: world.alice,
					}),
				)
				expect(failureTag(elsewhere)).toBe("MessageNotFoundError")

				const fresh = yield* world.make()
				const missing = yield* fresh.adopt(
					makeFakeSocket(),
					{ userId: world.alice, expiresAt: null },
					uuid() as MessageId,
					world.channelId,
				)
				expect(missing).toBe("not_found")
			}),
		))

	it("writes the final snapshot into the message's embed on complete", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* write(world, world.bot, { _tag: "Start" })
				yield* write(world, world.bot, { _tag: "AppendText", text: "Final answer" })
				yield* write(world, world.bot, { _tag: "Complete", data: { tokens: 3 } })

				const row = messageRow(world.channel, world.messageId)
				expect(row.content).toBe("Final answer")
				expect(JSON.parse(row.embeds)).toEqual([
					{
						liveState: {
							enabled: true,
							cached: {
								status: "completed",
								data: { tokens: 3 },
								text: "Final answer",
								progress: 100,
							},
						},
					},
				])
				expect(world.storage.alarm()).toBeNull()
			}),
		))

	it("retries the snapshot from the alarm while the channel is unreachable", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* write(world, world.bot, { _tag: "Start" })
				world.setUnreachable(true)
				yield* write(world, world.bot, { _tag: "Fail", error: "model timed out" })
				expect(world.storage.alarm()).not.toBeNull()
				expect(
					JSON.parse(messageRow(world.channel, world.messageId).embeds)[0].liveState.cached,
				).toBeUndefined()

				// Evicted and woken by the alarm: the pending snapshot survives in storage.
				world.setUnreachable(false)
				const woken = yield* world.make()
				expect(woken.state().status).toBe("failed")
				yield* woken.alarm
				const cached = JSON.parse(messageRow(world.channel, world.messageId).embeds)[0].liveState
					.cached
				expect(cached).toMatchObject({ status: "failed", error: "model timed out" })
			}),
		))

	it("closes a socket whose token expired with 4001 instead of streaming to it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const soon = Date.now() + 50
				const viewer = yield* connect(world, world.alice, makeFakeSocket(), soon)
				expect(viewer.decision).toBe("accepted")
				yield* Effect.sleep("60 millis")
				yield* write(world, world.bot, { _tag: "AppendText", text: "x" })
				expect(viewer.socket.closed?.code).toBe(4001)
				expect(tags(viewer.socket)).toEqual(["Snapshot"])
			}),
		))

	it("closes an open socket from the alarm once its user is no longer a viewer", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const viewer = yield* connect(world, world.alice)
				const author = yield* connect(world, world.bot)
				expect(viewer.decision).toBe("accepted")
				// Open sockets keep an access recheck armed.
				expect(world.storage.alarm()).not.toBeNull()

				yield* world.live.alarm
				expect(viewer.socket.closed).toBeUndefined()

				const applied = yield* world.channel.applyEffect({
					objectId: world.channelId,
					kind: "channel.setViewers",
					payload: {
						organizationId: world.orgId,
						conversationId: null,
						viewers: [{ userId: world.bot, organizationId: world.orgId, role: "member" }],
						bots: [],
						version: Date.now(),
					},
					key: `viewers:${world.channelId}:revoke`,
					sender: { kind: "org", id: world.orgId },
				})
				expect(applied._tag).toBe("Applied")
				yield* world.live.alarm
				expect(viewer.socket.closed?.code).toBe(SyncCloseCode.Forbidden)
				// The author (a viewer still) keeps streaming.
				expect(author.socket.closed).toBeUndefined()
			}),
		))

	it("answers a ping", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const viewer = yield* connect(world, world.alice)
				yield* world.live.onMessage(viewer.socket, JSON.stringify({ _tag: "Ping" }))
				expect(tags(viewer.socket)).toEqual(["Snapshot", "Pong"])
			}),
		))

	it("crosses the DO RPC encoded: typed errors arrive as the same classes", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const rpc = liveRpcOf(world.live)
				const stubs = Layer.succeed(LiveObjectStubs, {
					get: () => ({
						write: (request: unknown) => rpc.write(structuredClone(request)),
						read: (request: unknown) => rpc.read(structuredClone(request)),
					}),
				})
				const base = { messageId: world.messageId, channelId: world.channelId }
				const step = yield* writeLive({
					...base,
					principal: principalOf(world.bot),
					action: { _tag: "AddStep", step: { type: "text", content: "hi" } },
				}).pipe(Effect.provide(stubs))
				expect(step.stepId).toEqual(expect.any(String))
				const state = yield* readLive({ ...base, userId: world.alice }).pipe(Effect.provide(stubs))
				expect(state.steps).toHaveLength(1)
				const refused = yield* Effect.exit(
					writeLive({
						...base,
						principal: principalOf(world.alice),
						action: { _tag: "StopStreaming" },
					}).pipe(Effect.provide(stubs)),
				)
				expect(failureTag(refused)).toBe("UnauthorizedError")
				const unreachable = yield* Effect.exit(
					readLive({ ...base, userId: world.alice }).pipe(
						Effect.provide(
							Layer.succeed(LiveObjectStubs, {
								get: () => ({
									write: () => Effect.fail("down"),
									read: () => Effect.fail("down"),
								}),
							}),
						),
					),
				)
				expect(Exit.isFailure(unreachable) && Cause.findErrorOption(unreachable.cause)).toMatchObject(
					Option.some(expect.any(InternalServerError)),
				)
			}),
		))
})
