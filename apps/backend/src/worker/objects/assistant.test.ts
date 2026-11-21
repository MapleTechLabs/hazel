/**
 * The AI panel in the `OrgObject` (`./org/assistant.ts`): a member's message launches a T3 Code
 * thread on their linked environment, the alarm follows it into `assistant_items`, questions are
 * answered from the panel, and threads stay private until their owner shares them. T3 Code's MCP
 * server is a fake behind `fetch`.
 */
import { CurrentUser } from "@hazel/domain"
import type { AssistantThreadId, OrganizationId, UserId } from "@hazel/schema"
import { Cause, Effect, Exit, Option, type Scope } from "effect"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { decodeExit, encodePayload, type HazelRpcTag, rpcFor } from "../../rpc/dispatch"
import { callObject } from "./calls"
import { orgTarget } from "./kinds"
import { ConnectIntegrationCall } from "./org/integrations"
import { encodeInvokePrincipal } from "./principal"
import { ObjectStubs } from "./protocol"
import { makeOrgSource } from "./sources/org-source"
import { makeTestObjects, type TestObject } from "./testing"

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
// A fake T3 Code environment (its MCP server)
// ============================================================================

interface FakeItem {
	position: number
	itemId: string
	runId: string
	type: string
	status: string | null
	title: string | null
	text: string
}

const makeFakeT3 = () => {
	const state = {
		reachable: true,
		/** What `t3_thread_wait` answers next. */
		waitStatus: "running" as string,
		activeRunId: "run-1" as string | null,
		items: [] as Array<FakeItem>,
		pending: [] as Array<{ requestId: string; questions: Array<unknown> }>,
		calls: [] as Array<{ tool: string; args: Record<string, unknown> }>,
	}
	const reply = (id: unknown, result: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
			status: 200,
			headers: { "content-type": "application/json", ...headers },
		})
	const tool = (name: string, args: Record<string, unknown>): unknown => {
		state.calls.push({ tool: name, args })
		switch (name) {
			case "t3_thread_launch":
				return {
					threadId: "t3-thread-1",
					link: "https://t3.example/t/1",
					runId: "run-1",
					status: "running",
				}
			case "t3_thread_send":
				state.activeRunId = "run-2"
				state.waitStatus = "running"
				return { threadId: "t3-thread-1", runId: "run-2", status: "running" }
			case "t3_thread_wait":
				return {
					threadId: "t3-thread-1",
					runId: state.activeRunId,
					status: state.waitStatus,
					timedOut: false,
				}
			case "t3_thread_read": {
				const after = typeof args.afterPosition === "number" ? args.afterPosition : -1
				return {
					thread: {
						threadId: "t3-thread-1",
						title: "Chat",
						status: state.waitStatus,
						activeRunId: state.activeRunId,
						latestRunId: "run-1",
					},
					items: state.items.filter((item) => item.position > after),
					nextPosition: null,
					hasMore: false,
				}
			}
			case "t3_pending_request":
				if (args.action === "list") return { requestIds: state.pending.map((p) => p.requestId) }
				if (args.action === "read") {
					const found = state.pending.find((p) => p.requestId === args.requestId)!
					return { requestId: found.requestId, questions: found.questions }
				}
				state.pending = state.pending.filter((p) => p.requestId !== args.requestId)
				state.waitStatus = "running"
				return {}
			case "t3_thread_interrupt":
				state.waitStatus = "interrupted"
				state.activeRunId = null
				return { threadId: "t3-thread-1", status: "interrupted" }
			default:
				throw new Error(`unexpected tool ${name}`)
		}
	}
	const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (!url.startsWith("https://mac.t3.example/mcp")) throw new Error(`unexpected fetch ${url}`)
		if (!state.reachable) return new Response("offline", { status: 530 })
		const body = JSON.parse(String(init?.body)) as {
			id?: unknown
			method: string
			params?: { name: string; arguments: Record<string, unknown> }
		}
		if (body.method === "initialize") return reply(body.id, {}, { "mcp-session-id": "session-1" })
		if (body.method === "notifications/initialized") return new Response(null, { status: 202 })
		return reply(body.id, { structuredContent: tool(body.params!.name, body.params!.arguments) })
	}
	return { state, fetch }
}

// ============================================================================
// The world: an org with three members; Alice linked her T3 Code
// ============================================================================

const makeWorld = Effect.gen(function* () {
	const objects = yield* makeTestObjects
	const orgId = uuid() as OrganizationId
	const [alice, bob] = [uuid(), uuid()] as UserId[] as [UserId, UserId]
	const org = yield* objects.get(orgTarget(orgId))
	const db = org.storage.db
	db.prepare(`INSERT INTO organizations (id, name, slug) VALUES (?, 'Acme', 'acme')`).run(orgId)
	for (const userId of [alice, bob]) {
		db.prepare(
			`INSERT INTO users (id, externalId, email, firstName, lastName, userType) VALUES (?, ?, ?, 'X', 'Y', 'user')`,
		).run(userId, `ext-${userId}`, `${userId}@acme.test`)
		db.prepare(
			`INSERT INTO organization_members (id, organizationId, userId, role) VALUES (?, ?, ?, 'member')`,
		).run(uuid(), orgId, userId)
	}
	const link = callObject(ConnectIntegrationCall, orgTarget(orgId), {
		provider: "t3code",
		userId: alice,
		connectedBy: alice,
		externalAccountId: "env-1",
		externalAccountName: "Alice's MacBook",
		settings: { mode: "private", userIds: [] },
		metadata: {
			environmentUrl: "https://mac.t3.example",
			mcpUrl: "https://mac.t3.example/mcp",
			environmentId: "env-1",
			environmentLabel: "Alice's MacBook",
			expiresAt: null,
		},
		tokens: { accessToken: "t3_mcp_secret", refreshToken: null, expiresAt: null, scope: null },
	}).pipe(Effect.provideService(ObjectStubs, objects.stubs), Effect.provideContext(objects.directory))
	const call = (tag: HazelRpcTag, payload: unknown, user: UserId) =>
		Effect.gen(function* () {
			const rpc = yield* rpcFor(tag)
			const response = yield* org.invoke({
				objectId: orgId,
				tag,
				payload: yield* encodePayload(rpc, payload),
				principal: yield* encodeInvokePrincipal({ user: userOf(user), botScopes: null, agent: null }),
			})
			return yield* decodeExit(rpc, structuredClone(response).exit)
		})
	const rows = <A>(sql: string, ...params: Array<string>) => db.prepare(sql).all(...params) as Array<A>
	return { objects, org, orgId, alice, bob, link, call, rows }
}).pipe(Effect.orDie)

const ok = <A>(exit: Exit.Exit<A, unknown>): A => {
	if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause))
	return exit.value
}

const failure = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const customerContext = {
	label: "Globex · Billing",
	path: "/acme/customers/acct-1/billing",
	route: "CustomerDetail",
	entities: [{ kind: "customer", id: "acct-1", name: "Globex" }],
}

/** Rows a principal's sync socket would get. */
const visibleTo = (org: TestObject, table: string, userId: UserId) =>
	org.run(
		makeOrgSource(org.storage.sql)
			.tables.find((spec) => spec.name === table)!
			.load({ userId, expiresAt: null }, "all"),
	)

let t3: ReturnType<typeof makeFakeT3>
// `fetch` is read once by the HTTP client: one stub that forwards to this test's fake.
beforeAll(() => {
	vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => t3.fetch(input, init))
})
beforeEach(() => {
	t3 = makeFakeT3()
})
afterAll(() => {
	vi.unstubAllGlobals()
})

const start = (world: Effect.Success<typeof makeWorld>, message = "How is Globex doing?") =>
	Effect.gen(function* () {
		const threadId = uuid() as AssistantThreadId
		const exit = yield* world.call(
			"assistant.start",
			{ organizationId: world.orgId, threadId, message, context: customerContext },
			world.alice,
		)
		return { threadId, exit }
	})

describe("AI panel", () => {
	it("starts a scratch T3 Code thread with the instructions and the page, private to its owner", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId, exit } = yield* start(world)
				expect(ok(exit)).toMatchObject({ threadId })

				const launch = t3.state.calls.find((c) => c.tool === "t3_thread_launch")!
				expect(launch.args).toMatchObject({ scratch: true, clientRequestId: threadId })
				expect(launch.args.message).toContain("Only read.")
				expect(launch.args.message).toContain("Globex · Billing")
				expect(launch.args.message).toContain("customer `acct-1` (Globex)")
				expect(String(launch.args.message).endsWith("How is Globex doing?")).toBe(true)

				const [thread] = world.rows<{
					status: string
					externalThreadId: string
					engineLabel: string
				}>(`SELECT * FROM assistant_threads WHERE id = ?`, threadId)
				expect(thread).toMatchObject({
					status: "running",
					externalThreadId: "t3-thread-1",
					engineLabel: "Alice's MacBook",
				})
				expect(
					world.rows(`SELECT kind, text FROM assistant_items WHERE threadId = ?`, threadId),
				).toEqual([{ kind: "user", text: "How is Globex doing?" }])
				// Armed: the follower is due now.
				expect(yield* Effect.promise(() => world.org.storage.getAlarm())).not.toBeNull()

				// Bob sees neither the thread nor its items until Alice shares it.
				expect(yield* visibleTo(world.org, "assistant_threads", world.bob)).toHaveLength(0)
				expect(yield* visibleTo(world.org, "assistant_items", world.bob)).toHaveLength(0)
				expect(yield* visibleTo(world.org, "assistant_threads", world.alice)).toHaveLength(1)
			}),
		))

	it("a retried start launches once", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId } = yield* start(world)
				ok(
					yield* world.call(
						"assistant.start",
						{ organizationId: world.orgId, threadId, message: "again", context: null },
						world.alice,
					),
				)
				expect(t3.state.calls.filter((c) => c.tool === "t3_thread_launch")).toHaveLength(1)
				expect(
					world.rows(`SELECT id FROM assistant_items WHERE threadId = ?`, threadId),
				).toHaveLength(1)
			}),
		))

	it("the alarm mirrors T3 Code's activity, updates it as it streams, and settles when the run ends", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId } = yield* start(world)
				t3.state.items = [
					{
						position: 1,
						itemId: "i1",
						runId: "run-1",
						type: "user_message",
						status: "completed",
						title: null,
						text: "prompt",
					},
					{
						position: 2,
						itemId: "i2",
						runId: "run-1",
						type: "reasoning",
						status: "completed",
						title: null,
						text: "Looking up Globex",
					},
					{
						position: 3,
						itemId: "i3",
						runId: "run-1",
						type: "dynamic_tool",
						status: "completed",
						title: "get_customer",
						text: "{...}",
					},
					{
						position: 4,
						itemId: "i4",
						runId: "run-1",
						type: "assistant_message",
						status: "running",
						title: null,
						text: "Globex is",
					},
				]
				yield* world.org.alarm
				const kinds = () =>
					world.rows<{ kind: string; text: string; status: string | null }>(
						`SELECT kind, text, status FROM assistant_items WHERE threadId = ? ORDER BY createdAt, id`,
						threadId,
					)
				expect(kinds()).toEqual([
					{ kind: "user", text: "How is Globex doing?", status: null },
					{ kind: "reasoning", text: "Looking up Globex", status: "completed" },
					{ kind: "tool", text: "{...}", status: "completed" },
					{ kind: "assistant", text: "Globex is", status: "running" },
				])

				// The reply grows, then the run completes: the same row is updated, not duplicated.
				t3.state.items[3] = { ...t3.state.items[3]!, text: "Globex is healthy.", status: "completed" }
				t3.state.waitStatus = "completed"
				t3.state.activeRunId = null
				yield* world.org.alarm
				expect(kinds().at(-1)).toEqual({
					kind: "assistant",
					text: "Globex is healthy.",
					status: "completed",
				})
				expect(kinds()).toHaveLength(4)
				expect(world.rows(`SELECT status FROM assistant_threads WHERE id = ?`, threadId)).toEqual([
					{ status: "idle" },
				])
				expect(
					world.rows(`SELECT nextStepAt FROM assistant_followers WHERE threadId = ?`, threadId),
				).toEqual([{ nextStepAt: null }])
			}),
		))

	it("a follow-up resumes following; a question is answered from the panel", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId } = yield* start(world)
				t3.state.waitStatus = "completed"
				t3.state.activeRunId = null
				yield* world.org.alarm

				ok(
					yield* world.call(
						"assistant.send",
						{
							organizationId: world.orgId,
							threadId,
							message: "Should we call them?",
							context: customerContext,
						},
						world.alice,
					),
				)
				// Same page: the follow-up goes as typed, without the instructions again.
				expect(t3.state.calls.find((c) => c.tool === "t3_thread_send")!.args.message).toBe(
					"Should we call them?",
				)

				t3.state.waitStatus = "waiting"
				t3.state.pending = [
					{
						requestId: "req-1",
						questions: [
							{
								id: "q1",
								question: "Which contact?",
								options: [{ label: "Ana" }, { label: "Ben" }],
							},
						],
					},
				]
				yield* world.org.alarm
				const [question] = world.rows<{ id: string; kind: string; status: string }>(
					`SELECT id, kind, status FROM assistant_items WHERE threadId = ? AND kind = 'question'`,
					threadId,
				)
				expect(question).toMatchObject({ status: "running" })
				expect(world.rows(`SELECT status FROM assistant_threads WHERE id = ?`, threadId)).toEqual([
					{ status: "waiting" },
				])

				ok(
					yield* world.call(
						"assistant.answer",
						{
							organizationId: world.orgId,
							threadId,
							itemId: question!.id,
							answers: { q1: "Ana" },
						},
						world.alice,
					),
				)
				expect(t3.state.calls.find((c) => c.args.action === "respond")!.args).toMatchObject({
					requestId: "req-1",
					answers: { q1: "Ana" },
				})
				expect(world.rows(`SELECT status FROM assistant_items WHERE id = ?`, question!.id)).toEqual([
					{ status: "completed" },
				])
				// Answering twice is refused.
				const again = yield* world.call(
					"assistant.answer",
					{ organizationId: world.orgId, threadId, itemId: question!.id, answers: { q1: "Ben" } },
					world.alice,
				)
				expect(failure(again)).toMatchObject({ _tag: "AssistantQuestionClosedError" })
			}),
		))

	it("sharing shows the thread and its items to the org; only the owner writes", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId } = yield* start(world)

				const bobSends = yield* world.call(
					"assistant.send",
					{ organizationId: world.orgId, threadId, message: "hi", context: null },
					world.bob,
				)
				expect(failure(bobSends)).toMatchObject({ _tag: "UnauthorizedError" })

				ok(
					yield* world.call(
						"assistant.update",
						{ organizationId: world.orgId, threadId, visibility: "organization" },
						world.alice,
					),
				)
				expect(yield* visibleTo(world.org, "assistant_threads", world.bob)).toHaveLength(1)
				expect(yield* visibleTo(world.org, "assistant_items", world.bob)).toHaveLength(1)

				ok(
					yield* world.call(
						"assistant.delete",
						{ organizationId: world.orgId, threadId },
						world.alice,
					),
				)
				expect(yield* visibleTo(world.org, "assistant_threads", world.bob)).toHaveLength(0)
				expect(yield* visibleTo(world.org, "assistant_items", world.alice)).toHaveLength(0)
			}),
		))

	it("without a link, the panel says to connect T3 Code", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				const status = ok(
					yield* world.call("assistant.status", { organizationId: world.orgId }, world.alice),
				)
				expect(status).toEqual({ t3code: { state: "not_connected", environmentLabel: null } })
				const { exit } = yield* start(world)
				expect(failure(exit)).toMatchObject({ _tag: "AssistantEngineError", reason: "not_connected" })
				expect(world.rows(`SELECT id FROM assistant_threads`)).toHaveLength(0)
			}),
		))

	it("an offline environment is retried with backoff, then the thread shows the error", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeWorld
				yield* world.link
				const { threadId } = yield* start(world)
				t3.state.reachable = false
				yield* world.org.alarm
				const [follower] = world.rows<{ failures: number; nextStepAt: string; updatedAt: string }>(
					`SELECT failures, nextStepAt, updatedAt FROM assistant_followers WHERE threadId = ?`,
					threadId,
				)
				expect(follower!.failures).toBe(1)
				expect(Date.parse(follower!.nextStepAt) - Date.parse(follower!.updatedAt)).toBe(15_000)
				expect(world.rows(`SELECT status FROM assistant_threads WHERE id = ?`, threadId)).toEqual([
					{ status: "running" },
				])

				const offline = yield* start(world, "Another")
				expect(failure(offline.exit)).toMatchObject({
					_tag: "AssistantEngineError",
					reason: "unreachable",
				})
			}),
		))
})
