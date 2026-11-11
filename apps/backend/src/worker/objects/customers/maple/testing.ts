/**
 * A fake Maple MCP endpoint for the adapter's tests. It answers `POST /mcp` the way Maple's
 * stateless Streamable HTTP transport does — one JSON-RPC answer per request, `structuredContent`
 * beside the text blocks, a tool failure inside a 200 — and it **runs the queries** rather than
 * replaying canned rows: it holds raw product events and aggregates them the way the SQL asks
 * (the window, the identity filter, the event allowlist, the event → metric key `transform`, the
 * grouping, the limit and offset, and the rendered-row cap with `rowCount` / `truncated`), so a test
 * exercises the mapping *and* the paging the real warehouse would produce.
 *
 * It can also refuse the wrong key with Maple's body, answer 403, 429 (with or without
 * `Retry-After`), 503 and 400, garble its body, report a tool error, or answer a JSON-RPC error. It
 * records every call, so a test can assert what a page cost, that the key only travels in the
 * `Authorization` header, and that `accept` offers the two media types Maple's route demands.
 */
import { Effect, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { MAPLE_API_URL, RUN_SQL_ROW_CAP } from "./wire"

/** One raw `product_events` row, as the fake's warehouse holds it. */
export interface MapleEvent {
	/** `YYYY-MM-DD`; the fake puts the event at noon of it. */
	readonly day: string
	readonly groupId: string
	readonly userId: string
	readonly sessionId: string
	readonly eventName: string
}

export interface FakeMapleState {
	readonly apiKey: string
	/** The organization `$__orgFilter` expands to. */
	readonly organizationId: string
	readonly events: ReadonlyArray<MapleEvent>
	/** `true`: every call is answered 403, the way a key without the MCP scopes is. */
	forbidden: boolean
	/** `true`: 503, Maple having a bad moment. */
	failing: boolean
	/** `true`: 400, a request Maple refuses however often it is sent. */
	invalid: boolean
	/** `true`: 200 with a body that is not an MCP answer (Maple changed its API). */
	garbled: boolean
	/** `true`: an MCP answer whose rows are not the shape the query selected. */
	badRows: boolean
	/** `true`: the tool itself refused the query (a 200 carrying `isError`). */
	toolError: boolean
	/** `true`: a JSON-RPC `error` member instead of a result. */
	protocolError: boolean
	/** Rows `run_sql` renders of what it fetched (Maple's `MAX_RENDERED_ROWS`). */
	renderedRows: number
	/** Calls served before every further call answers 429. */
	throttleAfter: number | null
	/** Seconds in the `Retry-After` header of those 429s. */
	retryAfterSeconds: number | null
	/** 429s answered so far; a test asserts the retry happened. */
	throttled: number
	readonly calls: Array<{ readonly sql: string; readonly start: string; readonly end: string }>
	readonly authHeaders: Array<string>
	readonly accepts: Array<string>
	readonly paths: Array<string>
}

export const makeFakeMaple = (options: Partial<FakeMapleState> = {}): FakeMapleState => ({
	apiKey: "maple_ak_fake0000000000000000",
	organizationId: "org_39lDNgEjuXrOi0obeLpFSfyVSDo",
	events: [],
	forbidden: false,
	failing: false,
	invalid: false,
	garbled: false,
	badRows: false,
	toolError: false,
	protocolError: false,
	renderedRows: RUN_SQL_ROW_CAP,
	throttleAfter: null,
	retryAfterSeconds: null,
	throttled: 0,
	calls: [],
	authHeaders: [],
	accepts: [],
	paths: [],
	...options,
})

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	Response.json(body, { status, headers })

/** Maple's MCP refusal body. */
const mapleError = (status: number, message: string) =>
	json(status, { error: status === 401 ? "unauthorized" : "forbidden", message })

/** The event names of a `WHERE EventName IN ('a', 'b')` list; `null` when the query has none. */
const allowlistOf = (sql: string): ReadonlyArray<string> | null => {
	const list = /EventName IN \(([^)]*)\)/.exec(sql)?.[1]
	if (list === undefined) return null
	return list.split(",").map((entry) => entry.trim().replace(/^'|'$/g, ""))
}

/** Event name → metric key, from a `transform(EventName, [events], [keys])`; `null` without one. */
const metricKeysOf = (sql: string): ReadonlyMap<string, string> | null => {
	const match = /transform\(EventName, \[([^\]]*)\], \[([^\]]*)\]\)/.exec(sql)
	if (match === null) return null
	const listed = (list: string) => list.split(",").map((entry) => entry.trim().replace(/^'|'$/g, ""))
	const keys = listed(match[2] ?? "")
	return new Map(listed(match[1] ?? "").map((event, index) => [event, keys[index] ?? event]))
}

const numberAfter = (sql: string, keyword: string): number =>
	Number(new RegExp(`${keyword} (\\d+)`).exec(sql)?.[1] ?? 0)

/** The rows the query asks for, aggregated as ClickHouse would (before Maple's own caps). */
const rowsOf = (fake: FakeMapleState, sql: string, start: string, end: string) => {
	const allowlist = allowlistOf(sql)
	const metricKeys = metricKeysOf(sql)
	const from = start.slice(0, 10)
	const to = end.slice(0, 10)
	const matched = fake.events.filter(
		(event) =>
			event.day >= from &&
			event.day < to &&
			event.groupId !== "" &&
			(allowlist === null || allowlist.includes(event.eventName)),
	)
	const byMetric = metricKeys !== null
	const grouped = new Map<string, Record<string, unknown>>()
	const sessions = new Map<string, Set<string>>()
	for (const event of matched) {
		if (!byMetric && event.userId === "") continue
		const metric = metricKeys?.get(event.eventName) ?? event.eventName
		const key = byMetric
			? `${event.day}\u0000${event.groupId}\u0000${metric}`
			: `${event.day}\u0000${event.groupId}\u0000${event.userId}`
		const held = grouped.get(key)
		if (held === undefined) {
			grouped.set(
				key,
				byMetric
					? { day: event.day, account: event.groupId, metric, events: 1 }
					: {
							day: event.day,
							account: event.groupId,
							contact: event.userId,
							events: 1,
							sessions: 0,
						},
			)
		} else {
			held["events"] = Number(held["events"]) + 1
		}
		if (!byMetric && event.sessionId !== "") {
			const seen = sessions.get(key) ?? new Set<string>()
			seen.add(event.sessionId)
			sessions.set(key, seen)
		}
	}
	for (const [key, row] of grouped) {
		if (!byMetric) row["sessions"] = sessions.get(key)?.size ?? 0
	}
	const ordered = [...grouped.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([, row]) => row)
	const offset = numberAfter(sql, "OFFSET")
	// Maple wraps the statement in `LIMIT 1000` whatever it asked for.
	const limit = Math.min(numberAfter(sql, "LIMIT") || 1000, 1000)
	return ordered.slice(offset, offset + limit)
}

const answer = (fake: FakeMapleState, body: Record<string, unknown>) => {
	const args = ((body["params"] as Record<string, unknown> | undefined)?.["arguments"] ?? {}) as Record<
		string,
		unknown
	>
	const sql = String(args["sql"] ?? "")
	const start = String(args["start_time"] ?? "")
	const end = String(args["end_time"] ?? "")
	fake.calls.push({ sql, start, end })
	if (fake.protocolError) {
		return json(200, {
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32601, message: "Unknown tool run_sql" },
		})
	}
	if (fake.toolError) {
		return json(200, {
			jsonrpc: "2.0",
			id: 1,
			result: {
				isError: true,
				content: [{ type: "text", text: "SQL rejected (MissingOrgFilter): …" }],
			},
		})
	}
	if (fake.badRows) {
		return json(200, {
			jsonrpc: "2.0",
			id: 1,
			result: {
				content: [{ type: "text", text: "SQL result" }],
				structuredContent: {
					rowCount: 1,
					columns: ["day"],
					rows: [{ day: 20260615, account: null }],
					truncated: false,
					timeRange: { start, end },
				},
			},
		})
	}
	const rows = rowsOf(fake, sql, start, end)
	// The connect probe counts; everything else lists.
	const counting = sql.includes("count() AS rows")
	const data = counting ? [{ rows: rows.length }] : rows
	const rendered = data.slice(0, fake.renderedRows)
	const result = {
		rowCount: data.length,
		columns: Object.keys(data[0] ?? {}),
		rows: rendered,
		truncated: data.length > rendered.length,
		timeRange: { start, end },
		maxCellChars: 120,
		windowApplied: true,
	}
	const structuredContent =
		args["show_sql"] === true
			? {
					...result,
					expandedSql: sql.replace("$__orgFilter", `(OrgId = '${fake.organizationId}')`),
				}
			: result
	return json(200, {
		jsonrpc: "2.0",
		id: 1,
		result: { content: [{ type: "text", text: `${data.length} rows` }], structuredContent },
	})
}

export const fakeMapleHttpClient = (fake: FakeMapleState) =>
	Layer.succeed(
		HttpClient.HttpClient,
		HttpClient.make((request, url) =>
			Effect.gen(function* () {
				fake.paths.push(`${url.origin}${url.pathname}`)
				const auth = request.headers["authorization"] ?? ""
				fake.authHeaders.push(auth)
				fake.accepts.push(request.headers["accept"] ?? "")
				const raw =
					request.body._tag === "Uint8Array"
						? new TextDecoder().decode(request.body.body)
						: request.body._tag === "Raw" && typeof request.body.body === "string"
							? request.body.body
							: ""
				// SAFETY: every body this fake is sent is the adapter's own request object, serialized
				// by `bodyJsonUnsafe` a moment ago, so it parses back to a record.
				const body = raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>)
				const throttled = fake.throttleAfter !== null && fake.calls.length >= fake.throttleAfter
				if (throttled) fake.throttled += 1
				const response =
					auth !== `Bearer ${fake.apiKey}`
						? mapleError(401, "The API key is not valid")
						: fake.forbidden
							? mapleError(403, "This key may not use Maple's MCP tools")
							: throttled
								? json(
										429,
										{ error: "rate_limited", message: "Too many requests" },
										fake.retryAfterSeconds === null
											? {}
											: { "retry-after": String(fake.retryAfterSeconds) },
									)
								: fake.failing
									? json(503, { message: "Maple is having a bad moment" })
									: fake.invalid
										? json(400, { message: "Unparsable request" })
										: fake.garbled
											? json(200, { hello: "world" })
											: answer(fake, body)
				return HttpClientResponse.fromWeb(request, response)
			}),
		),
	)

/** The origin the fake expects for a region, so a test can assert which one was called. */
export const originOf = (region: "us" | "eu") => `${MAPLE_API_URL[region]}/mcp`
