import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect, Exit, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { makeT3CodeMcpSession, parseSseMessages } from "./mcp"

interface Seen {
	readonly method: string
	readonly session: string | undefined
	readonly authorization: string | undefined
}

/**
 * A T3 MCP endpoint: `initialize` opens session `s<n>`; `tools/call` answers `reply(tool)`.
 * `forget` drops sessions (as a restarted environment does).
 */
const fakeServer = (options: {
	readonly reply: (tool: string, args: any) => unknown
	readonly sse?: boolean
	readonly status?: number
}) => {
	const seen: Array<Seen> = []
	const sessions = new Set<string>()
	let opened = 0
	const layer = Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request) =>
			Effect.gen(function* () {
				const body = JSON.parse(new TextDecoder().decode((request.body as { body: Uint8Array }).body))
				const session = request.headers["mcp-session-id"]
				seen.push({ method: body.method, session, authorization: request.headers["authorization"] })
				const respond = (response: Response) => HttpClientResponse.fromWeb(request, response)
				if (options.status !== undefined)
					return respond(new Response("no", { status: options.status }))
				if (body.method === "initialize") {
					const id = `s${++opened}`
					sessions.add(id)
					return respond(
						Response.json(
							{ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } },
							{ headers: { "mcp-session-id": id } },
						),
					)
				}
				if (session === undefined || !sessions.has(session)) {
					return respond(new Response("unknown session", { status: 404 }))
				}
				if (body.method === "notifications/initialized")
					return respond(new Response(null, { status: 202 }))
				const message = {
					jsonrpc: "2.0",
					id: body.id,
					result: options.reply(body.params.name, body.params.arguments),
				}
				return respond(
					options.sse
						? new Response(`event: message\ndata: ${JSON.stringify(message)}\n\n`, {
								headers: { "content-type": "text/event-stream" },
							})
						: Response.json(message),
				)
			}),
		),
	)
	return { layer, seen, forget: () => sessions.clear() }
}

const ok = (structuredContent: unknown) => ({
	isError: false,
	structuredContent,
	content: [{ type: "text", text: JSON.stringify(structuredContent) }],
})

const failureOf = (exit: Exit.Exit<unknown, unknown>) =>
	Exit.isFailure(exit) ? Option.getOrUndefined(Cause.findErrorOption(exit.cause)) : undefined

const target = { mcpUrl: "https://mac.t3.example/mcp", accessToken: "secret" }

describe("parseSseMessages", () => {
	it("reads each event's data, skipping other fields and junk", () => {
		expect(
			parseSseMessages(
				'event: message\ndata: {"a":1}\n\n: ping\n\ndata: nope\n\ndata: {"b":\ndata: 2}\n\n',
			),
		).toEqual([{ a: 1 }, { b: 2 }])
	})
})

describe("makeT3CodeMcpSession", () => {
	it.effect("initializes once, then calls tools in that session with the credential", () => {
		const server = fakeServer({
			reply: () => ok({ projects: [{ id: "p1", title: "hazel" }], nextCursor: null }),
		})
		return Effect.gen(function* () {
			const mcp = yield* makeT3CodeMcpSession(target)
			expect(yield* mcp.listProjects()).toEqual([{ id: "p1", title: "hazel" }])
			yield* mcp.listProjects()
			expect(server.seen.map((call) => [call.method, call.session ?? null])).toEqual([
				["initialize", null],
				["notifications/initialized", "s1"],
				["tools/call", "s1"],
				["tools/call", "s1"],
			])
			expect(server.seen.every((call) => call.authorization === "Bearer secret")).toBe(true)
		}).pipe(Effect.provide(server.layer))
	})

	it.effect("reads results sent as an event stream", () => {
		const server = fakeServer({
			sse: true,
			reply: () => ok({ threadId: "t1", runId: "r1", status: "completed", timedOut: false }),
		})
		return Effect.gen(function* () {
			const mcp = yield* makeT3CodeMcpSession(target)
			expect(yield* mcp.wait({ threadId: "t1" })).toMatchObject({
				status: "completed",
				timedOut: false,
			})
		}).pipe(Effect.provide(server.layer))
	})

	it.effect("opens a new session when the environment forgot it", () => {
		const server = fakeServer({ reply: () => ok({ threadId: "t1", status: "interrupt_requested" }) })
		return Effect.gen(function* () {
			const mcp = yield* makeT3CodeMcpSession(target)
			yield* mcp.interrupt("t1", "stop")
			server.forget()
			yield* mcp.interrupt("t1", "stop")
			expect(server.seen.filter((call) => call.method === "initialize")).toHaveLength(2)
			expect(server.seen.at(-1)?.session).toBe("s2")
		}).pipe(Effect.provide(server.layer))
	})

	it.effect("caps waits under T3 Connect's idle limit", () => {
		let timeoutMs: unknown
		const server = fakeServer({
			reply: (_tool, args) => {
				timeoutMs = args.timeoutMs
				return ok({ threadId: "t1", runId: null, status: "idle", timedOut: false })
			},
		})
		return Effect.gen(function* () {
			const mcp = yield* makeT3CodeMcpSession(target)
			yield* mcp.wait({ threadId: "t1", timeoutMs: 600_000 })
			expect(timeoutMs).toBe(45_000)
		}).pipe(Effect.provide(server.layer))
	})

	it.effect("turns T3's failures into typed errors", () => {
		const server = fakeServer({
			reply: () => ({
				isError: true,
				content: [
					{
						type: "text",
						text: JSON.stringify({
							_tag: "OrchestratorMcpFailure",
							code: "thread_not_found",
							message: "No such thread",
						}),
					},
				],
			}),
		})
		return Effect.gen(function* () {
			const mcp = yield* makeT3CodeMcpSession(target)
			const exit = yield* Effect.exit(mcp.read({ threadId: "gone", view: "messages" }))
			expect(failureOf(exit)).toMatchObject({ _tag: "T3CodeToolError", code: "thread_not_found" })
		}).pipe(Effect.provide(server.layer))
	})

	it.effect("reports a refused credential and an offline machine", () =>
		Effect.gen(function* () {
			for (const [status, tag] of [
				[401, "T3CodeUnauthorizedError"],
				[530, "T3CodeUnreachableError"],
			] as const) {
				const server = fakeServer({ status, reply: () => null })
				const exit = yield* makeT3CodeMcpSession(target).pipe(
					Effect.flatMap((mcp) => mcp.listProjects()),
					Effect.provide(server.layer),
					Effect.exit,
				)
				expect(failureOf(exit)).toMatchObject({ _tag: tag })
			}
		}),
	)
})
