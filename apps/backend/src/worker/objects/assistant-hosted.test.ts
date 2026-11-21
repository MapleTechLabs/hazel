/**
 * The AI panel's hosted engines in the `OrgObject` (`./org/assistant-hosted.ts`), against a fake
 * `LanguageModel`: a member saves their own key (checked first), picks the engine, and a turn runs
 * on the alarm, streaming its reply into items while it is generated, calling Hazel's read tools
 * as the member (a channel they cannot see is refused), stopping on `assistant.stop`, and marked
 * cut off when the instance is evicted mid-turn.
 */
import { CurrentUser } from "@hazel/domain"
import { AssistantKeyRejectedError } from "@hazel/domain/rpc"
import type { AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import {
	Cause,
	Context,
	Deferred,
	Effect,
	Exit,
	Fiber,
	Layer,
	Option,
	Redacted,
	type Scope,
	Stream,
} from "effect"
import { LanguageModel, type Prompt, type Response } from "effect/ai"
import { describe, expect, it } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { Directory } from "../../services/directory"
import { channelTarget, orgTarget } from "./kinds"
import type { HostedModelsShape } from "./org/assistant-hosted"
import { encodeInvokePrincipal } from "./principal"
import { makeOrgSource } from "./sources/org-source"
import { makeTestObjectsWith, type TestObject } from "./testing"

const uuid = () => crypto.randomUUID()

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const userOf = (id: string) =>
	new CurrentUser.Schema({
		id: id as UserId,
		role: "member",
		email: `${id}@example.com`,
		isOnboarded: true,
		timezone: null,
		settings: null,
	})

// ============================================================================
// A fake model: each call answers with the script's stream for that call
// ============================================================================

type Script = (call: number) => Stream.Stream<Response.StreamPartEncoded>

const finish = (input = 10, output = 5): Response.StreamPartEncoded => ({
	type: "finish",
	reason: "stop",
	usage: {
		inputTokens: { uncached: input, total: input, cacheRead: undefined, cacheWrite: undefined },
		outputTokens: { total: output, text: undefined, reasoning: undefined },
	},
})

const textParts = (...deltas: Array<string>): Array<Response.StreamPartEncoded> => [
	{ type: "text-start", id: "t" },
	...deltas.map((delta): Response.StreamPartEncoded => ({ type: "text-delta", id: "t", delta })),
	{ type: "text-end", id: "t" },
]

const reply = (...deltas: Array<string>) => Stream.fromIterable([...textParts(...deltas), finish()])

interface ModelCall {
	readonly provider: string
	readonly model: string
	readonly key: string
	readonly prompt: Prompt.Prompt
}

const makeFakeModels = () => {
	const state = {
		script: ((_call: number) => reply("Hello")) as Script,
		calls: [] as Array<ModelCall>,
		checked: [] as Array<string>,
	}
	const models: HostedModelsShape = {
		languageModel: (provider, apiKey, model) =>
			Layer.effect(
				LanguageModel.LanguageModel,
				LanguageModel.make({
					generateText: () => Effect.succeed([]),
					streamText: (options) =>
						Stream.suspend(() => {
							const call = state.calls.length
							state.calls.push({
								provider,
								model,
								key: Redacted.value(apiKey),
								prompt: options.prompt,
							})
							return state.script(call)
						}),
				}),
			),
		checkKey: (provider, apiKey) =>
			Effect.suspend(() => {
				state.checked.push(provider)
				return Redacted.value(apiKey).startsWith("bad")
					? Effect.fail(
							new AssistantKeyRejectedError({
								provider,
								message: "Anthropic did not accept this key.",
							}),
						)
					: Effect.void
			}),
	}
	return { state, models }
}

// ============================================================================
// The world: an org with Alice and Bob; #general is Alice's, #secret only Bob's
// ============================================================================

const makeWorld = Effect.gen(function* () {
	const fake = makeFakeModels()
	const objects = yield* makeTestObjectsWith({ hostedModels: fake.models })
	const orgId = uuid() as OrganizationId
	const alice = uuid() as UserId
	const bob = uuid() as UserId
	const general = uuid()
	const secret = uuid()
	const org = yield* objects.get(orgTarget(orgId))
	const db = org.storage.db
	const directory = Context.get(objects.directory, Directory)
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	yield* directory.upsertOrg({ id: orgId, slug: "acme", name: "Acme", deletedAt: null })
	for (const [userId, name] of [
		[alice, "Alice"],
		[bob, "Bob"],
	] as const) {
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, ?, 'Y', 'user')`,
		).run(userId, `ext-${userId}`, `${userId}@acme.test`, name)
		db.prepare(
			`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
		).run(uuid(), orgId, userId)
		yield* directory.upsertMembership({ userId, organizationId: orgId, deletedAt: null })
	}
	for (const [channelId, name, type, viewer] of [
		[general, "general", "public", alice],
		[secret, "secret", "private", bob],
	] as const) {
		db.prepare(`INSERT INTO channels (id, name, type, organizationId) VALUES (?, ?, ?, ?)`).run(
			channelId,
			name,
			type,
			orgId,
		)
		db.prepare(
			`INSERT INTO channel_members (channelId, userId, isMuted, notificationCount) VALUES (?, ?, 0, 0)`,
		).run(channelId, viewer)
		db.prepare(`INSERT INTO channel_access (userId, channelId, organizationId) VALUES (?, ?, ?)`).run(
			viewer,
			channelId,
			orgId,
		)
		const channel = yield* objects.get(channelTarget(channelId))
		yield* channel.applyEffect({
			objectId: channelId,
			kind: "channel.setViewers",
			payload: {
				organizationId: orgId,
				conversationId: null,
				viewers: [{ userId: viewer, organizationId: orgId, role: "member" }],
				bots: [],
			},
			key: `viewers:${channelId}`,
			sender: { kind: "org", id: orgId },
		})
		yield* directory.upsertChannel({
			channelId: channelId as never,
			organizationId: orgId,
			hostChannelId: null,
			deletedAt: null,
		})
	}

	const callOn = (object: TestObject) => (tag: HazelRpcTag, payload: unknown, user: UserId) =>
		Effect.gen(function* () {
			const rpc = yield* rpcFor(tag)
			const response = yield* object.invoke({
				objectId: orgId,
				tag,
				payload: yield* encodePayload(rpc, payload),
				principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null, agent: null }),
			})
			return yield* decodeExit(rpc, structuredClone(response).exit)
		})
	const rows = <A>(sql: string, ...params: Array<string>) => db.prepare(sql).all(...params) as Array<A>
	return { fake, objects, org, orgId, alice, bob, general, secret, call: callOn(org), callOn, rows }
}).pipe(Effect.orDie)

type World = Effect.Success<typeof makeWorld>

const ok = <A>(exit: Exit.Exit<A, unknown>): A => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value
}

const failure = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const saveKey = (world: World, provider: "anthropic" | "openai", apiKey = `sk-${provider}-good-key`) =>
	world.call("assistant.saveKey", { organizationId: world.orgId, provider, apiKey }, world.alice)

const start = (world: World, message = "How is #general?") =>
	Effect.gen(function* () {
		const threadId = uuid() as AssistantThreadId
		const exit = yield* world.call(
			"assistant.start",
			{
				organizationId: world.orgId,
				threadId,
				message,
				context: {
					label: "Acme · general",
					path: "/acme/chat/general",
					route: "Channel",
					entities: [],
				},
			},
			world.alice,
		)
		return { threadId, exit }
	})

interface ItemRow {
	kind: string
	status: string | null
	title: string | null
	text: string
	data: string | null
}

const itemsOf = (world: World, threadId: AssistantThreadId) =>
	world.rows<ItemRow>(
		`SELECT kind, status, title, text, data FROM assistant_items WHERE threadId = ? ORDER BY createdAt, id`,
		threadId,
	)

const threadOf = (world: World, threadId: AssistantThreadId) =>
	world.rows<{ engine: string; status: string; errorMessage: string | null; engineLabel: string | null }>(
		`SELECT engine, status, errorMessage, engineLabel FROM assistant_threads WHERE id = ?`,
		threadId,
	)[0]!

/** A stream that stops at `gate` (signalling `reached`) after `before`, then sends `after`. */
const gated = (
	before: Array<Response.StreamPartEncoded>,
	reached: Deferred.Deferred<void>,
	gate: Deferred.Deferred<void>,
	after: Array<Response.StreamPartEncoded>,
) =>
	Stream.fromIterable(before).pipe(
		// The model's parts are handled a step behind the read: give the last one time to land.
		Stream.concat(
			Stream.fromEffect(
				Effect.sleep("30 millis").pipe(
					Effect.andThen(Deferred.succeed(reached, undefined)),
					Effect.andThen(Deferred.await(gate)),
				),
			).pipe(Stream.drain),
		),
		Stream.concat(Stream.fromIterable(after)),
	)

describe("AI panel, hosted engines", () => {
	it("saves a member's key only once the provider accepts it, never returns it, and picks the engine", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const status = ok(
					yield* world.call("assistant.status", { organizationId: world.orgId }, world.alice),
				)
				expect(status).toMatchObject({
					t3code: { state: "not_connected" },
					anthropic: { state: "not_connected", model: "claude-sonnet-5-5" },
					openai: { state: "not_connected" },
					preferredEngine: null,
				})
				// Nothing connected: a new chat has nowhere to run.
				expect(failure((yield* start(world)).exit)).toMatchObject({
					_tag: "AssistantEngineError",
					reason: "not_connected",
				})

				// A key the provider refuses is not stored.
				expect(failure(yield* saveKey(world, "anthropic", "bad-key-123"))).toMatchObject({
					_tag: "AssistantKeyRejectedError",
					provider: "anthropic",
				})
				expect(world.rows(`SELECT id FROM integration_tokens`)).toHaveLength(0)

				const saved = ok(yield* saveKey(world, "anthropic", "sk-ant-secret-1234"))
				expect(saved).toMatchObject({
					anthropic: { state: "connected" },
					preferredEngine: "anthropic",
				})
				expect(JSON.stringify(saved)).not.toContain("sk-ant-secret-1234")
				// Stored encrypted.
				const [token] = world.rows<{ encryptedAccessToken: string }>(
					`SELECT encryptedAccessToken FROM integration_tokens`,
				)
				expect(token!.encryptedAccessToken).not.toContain("sk-ant-secret-1234")

				// T3 Code is not linked: it cannot be chosen.
				expect(
					failure(
						yield* world.call(
							"assistant.setEngine",
							{ organizationId: world.orgId, engine: "t3code" },
							world.alice,
						),
					),
				).toMatchObject({ _tag: "AssistantEngineError", reason: "not_connected" })

				expect(ok(yield* saveKey(world, "openai"))).toMatchObject({ preferredEngine: "openai" })
				expect(
					ok(
						yield* world.call(
							"assistant.setEngine",
							{ organizationId: world.orgId, engine: "anthropic" },
							world.alice,
						),
					),
				).toMatchObject({ preferredEngine: "anthropic" })
				// Bob has his own (none).
				expect(
					ok(yield* world.call("assistant.status", { organizationId: world.orgId }, world.bob)),
				).toMatchObject({
					anthropic: { state: "not_connected" },
					preferredEngine: null,
				})

				// Removed: the preference falls back to what is still connected.
				expect(
					ok(
						yield* world.call(
							"assistant.removeKey",
							{ organizationId: world.orgId, provider: "anthropic" },
							world.alice,
						),
					),
				).toMatchObject({ anthropic: { state: "not_connected" }, preferredEngine: "openai" })
			}),
		))

	it("runs the turn on the alarm, on the thread's own engine, with the conversation so far", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic", "sk-ant-key-1"))
				const { threadId, exit } = yield* start(world)
				ok(exit)
				expect(threadOf(world, threadId)).toMatchObject({
					engine: "anthropic",
					status: "running",
					engineLabel: "claude-sonnet-5-5",
				})
				// `start` only records: the alarm runs the turn.
				expect(world.fake.state.calls).toHaveLength(0)
				expect(yield* Effect.promise(() => world.org.storage.getAlarm())).not.toBeNull()

				world.fake.state.script = () => reply("Quiet ", "today.")
				yield* world.org.alarm
				expect(world.fake.state.calls).toHaveLength(1)
				expect(world.fake.state.calls[0]).toMatchObject({
					provider: "anthropic",
					model: "claude-sonnet-5-5",
					key: "sk-ant-key-1",
				})
				expect(threadOf(world, threadId).status).toBe("idle")
				expect(
					itemsOf(world, threadId).map(({ kind, status, text }) => ({ kind, status, text })),
				).toEqual([
					{ kind: "user", status: null, text: "How is #general?" },
					{ kind: "assistant", status: "completed", text: "Quiet today." },
				])
				const system = world.fake.state.calls[0]!.prompt.content[0]
				expect(system).toMatchObject({ role: "system" })
				expect(JSON.stringify(system)).toContain(world.orgId)
				expect(JSON.stringify(system)).toContain("Acme · general")

				// The preference moves to OpenAI; this thread stays on Anthropic.
				ok(yield* saveKey(world, "openai"))
				world.fake.state.script = () => reply("Still quiet.")
				ok(
					yield* world.call(
						"assistant.send",
						{
							organizationId: world.orgId,
							threadId,
							messageId: uuid(),
							message: "And tomorrow?",
							context: null,
						},
						world.alice,
					),
				)
				yield* world.org.alarm
				expect(world.fake.state.calls[1]!.provider).toBe("anthropic")
				const history = world.fake.state.calls[1]!.prompt.content.map((message) => message.role)
				expect(history).toEqual(["system", "user", "assistant", "user"])

				// Still private to Alice.
				const visible = (userId: UserId) =>
					world.org.run(
						makeOrgSource(world.org.storage.sql)
							.tables.find((spec) => spec.name === "assistant_items")!
							.load({ userId, expiresAt: null }, "all"),
					)
				expect(yield* visible(world.bob)).toHaveLength(0)
				expect((yield* visible(world.alice)).length).toBeGreaterThan(0)
			}),
		))

	it("streams the reply to clients while it is generated", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world)
				const reached = yield* Deferred.make<void>()
				const gate = yield* Deferred.make<void>()
				world.fake.state.script = () =>
					Stream.fromIterable(textParts("Hel").slice(0, 2)).pipe(
						// Past the flush interval: the next delta is written and broadcast at once.
						Stream.concat(Stream.fromEffect(Effect.sleep("350 millis")).pipe(Stream.drain)),
						Stream.concat(
							gated([{ type: "text-delta", id: "t", delta: "lo" }], reached, gate, [
								{ type: "text-delta", id: "t", delta: " world" },
								{ type: "text-end", id: "t" },
								finish(),
							]),
						),
					)
				const flushedBefore = world.org.synced.sync.flushedSeq()
				const alarm = yield* Effect.forkChild(world.org.alarm)
				yield* Deferred.await(reached)

				// Mid-turn: the reply so far is in its item, and was flushed to the sockets.
				const [, assistant] = itemsOf(world, threadId)
				expect(assistant).toMatchObject({ kind: "assistant", status: "running", text: "Hello" })
				expect(world.org.synced.sync.flushedSeq()).toBeGreaterThan(flushedBefore)
				expect(threadOf(world, threadId).status).toBe("running")

				yield* Deferred.succeed(gate, undefined)
				yield* Fiber.join(alarm)
				expect(itemsOf(world, threadId)[1]).toMatchObject({
					status: "completed",
					text: "Hello world",
				})
				expect(threadOf(world, threadId).status).toBe("idle")
			}),
		))

	it("calls Hazel's read tools as the member: a channel they cannot see is refused", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world, "What channels do I have?")
				world.fake.state.script = (call) =>
					call === 0
						? Stream.fromIterable<Response.StreamPartEncoded>([
								{
									type: "tool-call",
									id: "c1",
									name: "list_channels",
									params: { organization_id: world.orgId },
								},
								{
									type: "tool-call",
									id: "c2",
									name: "read_messages",
									params: { channel_id: world.secret },
								},
								finish(),
							])
						: reply("You have #general.")
				yield* world.org.alarm

				const items = itemsOf(world, threadId)
				expect(items.map(({ kind, status, title }) => ({ kind, status, title }))).toEqual([
					{ kind: "user", status: null, title: null },
					{ kind: "tool", status: "completed", title: "List channels" },
					{ kind: "tool", status: "failed", title: "Read messages" },
					{ kind: "assistant", status: "completed", title: null },
				])
				expect(items[1]!.text).toContain("general")
				expect(items[1]!.text).not.toContain("secret")
				expect(JSON.parse(items[1]!.data!)).toEqual({ input: `organization_id: ${world.orgId}` })
				// The model got both results back, the refusal as the tool's failure.
				expect(world.fake.state.calls).toHaveLength(2)
				const results = world.fake.state.calls[1]!.prompt.content.filter(
					(message) => message.role === "tool",
				)
				expect(results.length).toBeGreaterThan(0)
				expect(JSON.stringify(results)).toContain("general")
				expect(threadOf(world, threadId).status).toBe("idle")
			}),
		))

	it("stop ends a hosted turn where it is", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world)
				const reached = yield* Deferred.make<void>()
				const never = yield* Deferred.make<void>()
				world.fake.state.script = () => gated(textParts("Partial").slice(0, 2), reached, never, [])
				const alarm = yield* Effect.forkChild(world.org.alarm)
				yield* Deferred.await(reached)

				ok(
					yield* world.call(
						"assistant.stop",
						{ organizationId: world.orgId, threadId },
						world.alice,
					),
				)
				yield* Fiber.join(alarm)
				expect(threadOf(world, threadId)).toMatchObject({ status: "idle", errorMessage: null })
				expect(itemsOf(world, threadId)[1]).toMatchObject({
					kind: "assistant",
					status: "completed",
					text: "Partial",
				})
				expect(
					world.rows(`SELECT threadId FROM assistant_followers WHERE turnStartedAt IS NOT NULL`),
				).toHaveLength(0)
			}),
		))

	it("a turn cut off by an eviction is marked as an error by the next instance", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world)
				const reached = yield* Deferred.make<void>()
				const never = yield* Deferred.make<void>()
				world.fake.state.script = () => gated(textParts("Half a").slice(0, 2), reached, never, [])
				const alarm = yield* Effect.forkChild(world.org.alarm)
				yield* Deferred.await(reached)
				// The instance goes away mid-turn: nothing more runs in it.
				yield* Fiber.interrupt(alarm)
				expect(threadOf(world, threadId).status).toBe("running")

				const fresh = yield* world.objects.reactivate(orgTarget(world.orgId))
				yield* fresh.alarm
				expect(threadOf(world, threadId)).toMatchObject({
					status: "error",
					errorMessage: "The reply was cut off before it finished. Send your message again.",
				})
				expect(itemsOf(world, threadId)[1]).toMatchObject({
					kind: "assistant",
					status: "failed",
					text: "Half a",
				})
				// Nothing runs it again on its own.
				yield* fresh.alarm
				expect(world.fake.state.calls).toHaveLength(1)
			}),
		))

	it("a model failure ends the turn with a message of Hazel's, not the provider's", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world)
				world.fake.state.script = () => Stream.fromIterable(textParts("Hal").slice(0, 2))
				yield* world.org.alarm
				expect(threadOf(world, threadId)).toMatchObject({
					status: "error",
					errorMessage: "Anthropic stopped answering. Send your message again.",
				})
				expect(itemsOf(world, threadId)[1]).toMatchObject({ status: "failed", text: "Hal" })
			}),
		))

	it("without the key, a follow-up is refused and nothing runs", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				ok(yield* saveKey(world, "anthropic"))
				const { threadId } = yield* start(world)
				yield* world.org.alarm
				ok(
					yield* world.call(
						"assistant.removeKey",
						{ organizationId: world.orgId, provider: "anthropic" },
						world.alice,
					),
				)
				expect(
					failure(
						yield* world.call(
							"assistant.send",
							{
								organizationId: world.orgId,
								threadId,
								messageId: uuid(),
								message: "again",
								context: null,
							},
							world.alice,
						),
					),
				).toMatchObject({ _tag: "AssistantEngineError", reason: "not_connected" })
				expect(world.fake.state.calls).toHaveLength(1)
			}),
		))
})
