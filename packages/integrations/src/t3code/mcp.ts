/**
 * A small client for a T3 Code environment's MCP server (`POST /mcp`, streamable HTTP, protocol
 * `2025-06-18`), over the member's OAuth credential. A reply is JSON or an SSE stream; tools
 * return their result as `structuredContent`, or `isError` with T3's failure as JSON text. The
 * session lives in the environment's memory, so a 404 (the environment restarted) starts a new one.
 * Shapes follow T3 Code's `packages/contracts/src/orchestratorMcp.ts`; only the fields Hazel
 * reads are decoded.
 */
import { HttpBody, HttpClient, type HttpClientError } from "effect/http"
import { Duration, Effect, Ref, Schema } from "effect"

const PROTOCOL_VERSION = "2025-06-18"

/** T3 Connect's edge drops a request idle for ~100s; waits stay well under it. */
export const MAX_WAIT_MS = 45_000
const REQUEST_TIMEOUT = Duration.seconds(MAX_WAIT_MS / 1000 + 20)

/** The environment refused the credential: revoked in T3, or lapsed. The owner signs in again. */
export class T3CodeUnauthorizedError extends Schema.TaggedError<T3CodeUnauthorizedError>()(
	"T3CodeUnauthorizedError",
	{ message: Schema.String },
) {}

/** The environment is offline or unreachable (the machine sleeps, T3 Code is closed). */
export class T3CodeUnreachableError extends Schema.TaggedError<T3CodeUnreachableError>()(
	"T3CodeUnreachableError",
	{ message: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

/** A tool refused the call (`OrchestratorMcpFailure`), e.g. `thread_not_found`, `capability_denied`. */
export class T3CodeToolError extends Schema.TaggedError<T3CodeToolError>()("T3CodeToolError", {
	tool: Schema.String,
	code: Schema.String,
	message: Schema.String,
}) {}

/** The environment answered something this client cannot read. */
export class T3CodeProtocolError extends Schema.TaggedError<T3CodeProtocolError>()("T3CodeProtocolError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

export type T3CodeMcpError =
	| T3CodeUnauthorizedError
	| T3CodeUnreachableError
	| T3CodeToolError
	| T3CodeProtocolError

// ============================================================================
// Tool results
// ============================================================================

export const RunStatus = Schema.String
export const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
	"completed",
	"failed",
	"cancelled",
	"interrupted",
	"rolled_back",
])

export const T3Project = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	workspaceRoot: Schema.optional(Schema.String),
})
export type T3Project = typeof T3Project.Type

const ProjectList = Schema.Struct({
	projects: Schema.Array(T3Project),
	nextCursor: Schema.NullOr(Schema.Number),
})

export const T3Launched = Schema.Struct({
	threadId: Schema.String,
	link: Schema.optional(Schema.String),
	projectId: Schema.optional(Schema.String),
	runId: Schema.NullOr(Schema.String),
	status: Schema.NullOr(RunStatus),
})
export type T3Launched = typeof T3Launched.Type

export const T3Sent = Schema.Struct({
	threadId: Schema.String,
	runId: Schema.optional(Schema.NullOr(Schema.String)),
	status: Schema.optional(RunStatus),
	delivery: Schema.optional(Schema.String),
})
export type T3Sent = typeof T3Sent.Type

export const T3Waited = Schema.Struct({
	threadId: Schema.String,
	runId: Schema.NullOr(Schema.String),
	/** `idle` or a run status; `waiting` means blocked on an approval or a question. */
	status: Schema.String,
	timedOut: Schema.Boolean,
})
export type T3Waited = typeof T3Waited.Type

export const T3Item = Schema.Struct({
	position: Schema.Number,
	itemId: Schema.String,
	runId: Schema.NullishOr(Schema.String),
	type: Schema.String,
	status: Schema.NullishOr(Schema.String),
	title: Schema.NullishOr(Schema.String),
	text: Schema.NullishOr(Schema.String),
	textTruncated: Schema.optional(Schema.Boolean),
})
export type T3Item = typeof T3Item.Type

export const T3ThreadSummary = Schema.Struct({
	threadId: Schema.String,
	title: Schema.NullishOr(Schema.String),
	link: Schema.optional(Schema.String),
	status: Schema.String,
	activeRunId: Schema.NullishOr(Schema.String),
	latestRunId: Schema.NullishOr(Schema.String),
	pendingRequestCount: Schema.optional(Schema.Number),
})

export const T3Read = Schema.Struct({
	thread: T3ThreadSummary,
	items: Schema.Array(T3Item),
	nextPosition: Schema.NullOr(Schema.Number),
	hasMore: Schema.Boolean,
})
export type T3Read = typeof T3Read.Type

const PendingList = Schema.Struct({ requestIds: Schema.Array(Schema.String) })

export const T3Question = Schema.Struct({
	id: Schema.String,
	header: Schema.optional(Schema.String),
	question: Schema.String,
	options: Schema.optional(
		Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.optional(Schema.String) })),
	),
	multiSelect: Schema.optional(Schema.Boolean),
})
export type T3Question = typeof T3Question.Type

const PendingRead = Schema.Struct({ requestId: Schema.String, questions: Schema.Array(T3Question) })

const Interrupted = Schema.Struct({ threadId: Schema.String, status: Schema.String })

// ============================================================================
// Transport
// ============================================================================

const ToolFailure = Schema.fromJsonString(Schema.Struct({ code: Schema.String, message: Schema.String }))

const JsonRpcResponse = Schema.Struct({
	id: Schema.optional(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
	result: Schema.optional(Schema.Unknown),
	error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
})

const ToolResult = Schema.Struct({
	isError: Schema.optional(Schema.Boolean),
	structuredContent: Schema.optional(Schema.Unknown),
	content: Schema.optional(
		Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
	),
})

/** The JSON-RPC messages in an SSE body (`data: <json>` events). */
export const parseSseMessages = (body: string): ReadonlyArray<unknown> =>
	body
		.split(/\r?\n\r?\n/)
		.map((event) =>
			event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n"),
		)
		.filter((data) => data.length > 0)
		.flatMap((data) => {
			try {
				return [JSON.parse(data) as unknown]
			} catch {
				return []
			}
		})

export interface T3CodeMcpTarget {
	readonly mcpUrl: string
	readonly accessToken: string
}

/** A session with one environment. Not shared across owners: it carries the owner's credential. */
export const makeT3CodeMcpSession = Effect.fn("T3CodeMcp.session")(function* (target: T3CodeMcpTarget) {
	const http = yield* HttpClient.HttpClient
	const sessionId = yield* Ref.make<string | null>(null)
	const nextId = yield* Ref.make(1)

	const post = (message: Record<string, unknown>, session: string | null) =>
		http
			.post(target.mcpUrl, {
				body: HttpBody.text(JSON.stringify({ jsonrpc: "2.0", ...message }), "application/json"),
				headers: {
					accept: "application/json, text/event-stream",
					authorization: `Bearer ${target.accessToken}`,
					...(session === null
						? {}
						: { "mcp-session-id": session, "mcp-protocol-version": PROTOCOL_VERSION }),
				},
			})
			.pipe(
				Effect.timeout(REQUEST_TIMEOUT),
				Effect.catchTags({
					TimeoutError: (cause: unknown) =>
						Effect.fail(
							new T3CodeUnreachableError({
								message: "The environment did not answer in time",
								cause,
							}),
						),
					HttpClientError: (cause: HttpClientError.HttpClientError) =>
						Effect.fail(
							new T3CodeUnreachableError({ message: "The environment is unreachable", cause }),
						),
				}),
			)

	/** One request; its JSON-RPC result. `stale` when the environment forgot the session. */
	const request = (method: string, params: unknown, session: string | null) =>
		Effect.gen(function* () {
			const id = yield* Ref.getAndUpdate(nextId, (n) => n + 1)
			const response = yield* post({ id, method, params }, session)
			if (response.status === 401 || response.status === 403) {
				return yield* new T3CodeUnauthorizedError({ message: "T3 Code refused Hazel's sign-in" })
			}
			if (response.status === 404 && session !== null) return { stale: true as const }
			// Cloudflare's tunnel answers 502/530 while the machine is offline.
			if (response.status >= 500) {
				return yield* new T3CodeUnreachableError({
					message: `The environment answered ${response.status}`,
				})
			}
			const body = yield* response.text.pipe(
				Effect.mapError(
					(cause) => new T3CodeUnreachableError({ message: "The reply was cut off", cause }),
				),
			)
			if (response.status >= 400) {
				return yield* new T3CodeProtocolError({
					message: `${method} failed (${response.status}): ${body.slice(0, 300)}`,
				})
			}
			const messages = (response.headers["content-type"] ?? "").includes("text/event-stream")
				? parseSseMessages(body)
				: yield* Effect.try({
						try: () => [JSON.parse(body) as unknown],
						catch: (cause) =>
							new T3CodeProtocolError({ message: `${method}: the reply is not JSON`, cause }),
					})
			const decoded = messages.flatMap((message) => {
				const result = Schema.decodeUnknownOption(JsonRpcResponse)(message)
				return result._tag === "Some" && result.value.id === id ? [result.value] : []
			})
			const reply = decoded[0]
			if (reply === undefined) return yield* new T3CodeProtocolError({ message: `${method}: no reply` })
			if (reply.error !== undefined) {
				return yield* new T3CodeProtocolError({ message: `${method}: ${reply.error.message}` })
			}
			return {
				stale: false as const,
				result: reply.result,
				session: response.headers["mcp-session-id"] ?? null,
			}
		})

	const initialize = Effect.gen(function* () {
		const reply = yield* request(
			"initialize",
			{
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "Hazel", version: "1.0.0" },
			},
			null,
		)
		if (reply.stale || reply.session === null) {
			return yield* new T3CodeProtocolError({ message: "initialize: the environment gave no session" })
		}
		yield* Ref.set(sessionId, reply.session)
		// Acknowledged with 202; T3 does not require it, but the protocol asks for it.
		yield* post({ method: "notifications/initialized" }, reply.session).pipe(Effect.ignore)
		return reply.session
	}).pipe(Effect.withSpan("T3CodeMcp.initialize"))

	const callTool = <A>(tool: string, args: Record<string, unknown>, schema: Schema.Codec<A, unknown>) =>
		Effect.gen(function* () {
			const run = (session: string) => request("tools/call", { name: tool, arguments: args }, session)
			const current = yield* Ref.get(sessionId)
			let reply = yield* run(current ?? (yield* initialize))
			if (reply.stale) reply = yield* run(yield* initialize)
			if (reply.stale)
				return yield* new T3CodeProtocolError({ message: `${tool}: the session was lost` })
			const result = yield* Schema.decodeUnknownEffect(ToolResult)(reply.result).pipe(
				Effect.mapError(
					(cause) => new T3CodeProtocolError({ message: `${tool}: unreadable result`, cause }),
				),
			)
			if (result.isError === true) {
				const text = result.content?.[0]?.text ?? ""
				const failure = Schema.decodeUnknownOption(ToolFailure)(text)
				return yield* new T3CodeToolError({
					tool,
					code: failure._tag === "Some" ? failure.value.code : "tool_failed",
					message: failure._tag === "Some" ? failure.value.message : text || "The tool failed",
				})
			}
			return yield* Schema.decodeUnknownEffect(schema)(result.structuredContent).pipe(
				Effect.mapError(
					(cause) => new T3CodeProtocolError({ message: `${tool}: unexpected result`, cause }),
				),
			)
		}).pipe(Effect.withSpan(`T3CodeMcp.${tool}`))

	return {
		listProjects: () =>
			callTool("t3_project_list", { limit: 100 }, ProjectList).pipe(
				Effect.map((list) => list.projects),
			),
		launchThread: (input: {
			readonly projectId: string
			readonly title: string
			readonly message: string
		}) => callTool("t3_thread_launch", { ...input }, T3Launched),
		send: (input: {
			readonly threadId: string
			readonly message: string
			readonly clientRequestId?: string
		}) => callTool("t3_thread_send", { ...input, mode: "auto" }, T3Sent),
		wait: (input: { readonly threadId: string; readonly runId?: string; readonly timeoutMs?: number }) =>
			callTool(
				"t3_thread_wait",
				{ ...input, timeoutMs: Math.min(input.timeoutMs ?? MAX_WAIT_MS, MAX_WAIT_MS) },
				T3Waited,
			),
		read: (input: {
			readonly threadId: string
			readonly view: "messages" | "activity"
			readonly afterPosition?: number
			readonly limit?: number
			readonly maxCharsPerItem?: number
		}) => callTool("t3_thread_read", { ...input }, T3Read),
		pendingQuestions: (threadId: string) =>
			callTool("t3_pending_request", { action: "list", threadId }, PendingList).pipe(
				Effect.map((list) => list.requestIds),
			),
		readQuestion: (threadId: string, requestId: string) =>
			callTool("t3_pending_request", { action: "read", threadId, requestId }, PendingRead),
		answerQuestion: (threadId: string, requestId: string, answers: Record<string, unknown>) =>
			callTool(
				"t3_pending_request",
				{ action: "respond", threadId, requestId, answers },
				Schema.Unknown,
			),
		interrupt: (threadId: string, reason: string) =>
			callTool("t3_thread_interrupt", { threadId, reason }, Interrupted),
	}
})

export type T3CodeMcpSession = Effect.Success<ReturnType<typeof makeT3CodeMcpSession>>
