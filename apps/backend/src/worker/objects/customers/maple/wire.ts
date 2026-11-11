/**
 * What Hazel sends to Maple and what it reads back.
 *
 * Maple has no public REST endpoint for product events: `/v2/...` carries resources (dashboards,
 * alerts, keys), and the warehouse query routes (`/internal/query-engine/*`) are session-only and
 * refuse API keys (`docs/api-v2.md`, "Dashboard-only operations"). The one documented, key-
 * authenticated way into `product_events` is Maple's **MCP server** — `POST /mcp`, Streamable HTTP,
 * `Authorization: Bearer maple_ak_…` (`maple.dev/docs/reference/mcp`) — and its `run_sql` tool,
 * which runs one read-only ClickHouse `SELECT` scoped to the key's organization.
 *
 * Three things about that transport shape the code here:
 *
 * - **It is stateless.** Maple replaces Effect's session-keeping MCP transport with one that
 *   synthesises the `initialize` handshake per request (`apps/ai/src/mcp/transport/stateless-http.ts`
 *   in Maple), so one POST is one call: no session id, nothing to resume.
 * - **`accept` must offer both** `application/json` and `text/event-stream`, or the route answers
 *   406 before it reads the body. The answer itself is JSON.
 * - **A tool failure is an HTTP 200** carrying `result.isError`, and a protocol failure a JSON-RPC
 *   `error` member. Neither is an HTTP status, so `./http.ts` maps both itself.
 *
 * `run_sql` fetches at most 1000 rows and hands back the first {@link RUN_SQL_ROW_CAP} of them
 * (`MAX_RENDERED_ROWS` in Maple), with the true count on `rowCount`. That cap is why a pull pages
 * by day *and* by offset inside a day (`./pull.ts`).
 */
import { Schema } from "effect"
import type { MapleRegion } from "@hazel/domain/customers"

/** Maple's MCP endpoint per region; a key of one region is refused by the other. */
export const MAPLE_API_URL = {
	us: "https://api.maple.dev",
	eu: "https://api.eu.maple.dev",
} satisfies Readonly<Record<MapleRegion, string>>

export const MCP_PATH = "/mcp"

/** The MCP revision Maple's server implements. */
export const MCP_PROTOCOL_VERSION = "2025-06-18"

/** Without both media types Maple's MCP route answers 406. */
export const MCP_HEADERS = {
	accept: "application/json, text/event-stream",
	"mcp-protocol-version": MCP_PROTOCOL_VERSION,
}

/** How many rows of a `run_sql` result Maple hands back, whatever the query matched. */
export const RUN_SQL_ROW_CAP = 100

/** The prefix every Maple metric key carries: two providers never share a key (ingest refuses it). */
export const METRIC_PREFIX = "maple."

export const metricKeyOf = (key: string): string => `${METRIC_PREFIX}${key}`

const optional = Schema.optionalKey
const Nullable = <S extends Schema.Top>(schema: S) => optional(Schema.NullOr(schema))

/**
 * A ClickHouse count: a number, or its digits as a string when it passed 2^53 (`run_sql` renders a
 * bigint as text rather than losing its last digits).
 */
export const WireCount = Schema.Union([Schema.Number, Schema.String])
export type WireCount = typeof WireCount.Type

/** `YYYY-MM-DD`, as `toDate(Timestamp)` comes back. */
const WireDay = Schema.String

/** The connect probe's one row: a count Hazel never reads, so the key's access is what it proves. */
export const MapleProbeRow = Schema.Struct({ rows: WireCount })

/** One row of the activity query: a contact's events on one day in one account. */
export const MapleActivityRow = Schema.Struct({
	day: WireDay,
	account: Schema.String,
	contact: Schema.String,
	events: WireCount,
	sessions: WireCount,
})
export type MapleActivityRow = typeof MapleActivityRow.Type

/** One row of the metric query: how often one event fired for one account on one day. */
export const MapleMetricRow = Schema.Struct({
	day: WireDay,
	account: Schema.String,
	event: Schema.String,
	events: WireCount,
})
export type MapleMetricRow = typeof MapleMetricRow.Type

/** `run_sql`'s typed output (its declared `outputSchema`), with the rows read as `row`. */
const RunSqlOutput = <S extends Schema.ConstraintDecoder<unknown>>(row: S) =>
	Schema.Struct({
		rowCount: WireCount,
		rows: Schema.Array(row),
		truncated: Schema.Boolean,
		/** Only with `show_sql`: the macro-expanded statement, which names the key's organization. */
		expandedSql: optional(Schema.String),
	})

/**
 * One JSON-RPC answer to a `tools/call`. Every arm is optional: a tool failure carries
 * `result.isError` with the reason in `content`, a protocol failure an `error` member and no
 * result, and only a success carries `structuredContent`.
 */
export const RunSqlAnswer = <S extends Schema.ConstraintDecoder<unknown>>(row: S) =>
	Schema.Struct({
		// Required: it is what tells an answer apart from any other body on the route.
		jsonrpc: Schema.Literal("2.0"),
		error: Nullable(Schema.Struct({ message: optional(Schema.String) })),
		result: Nullable(
			Schema.Struct({
				isError: Nullable(Schema.Boolean),
				content: optional(Schema.Array(Schema.Struct({ text: optional(Schema.String) }))),
				structuredContent: Nullable(RunSqlOutput(row)),
			}),
		),
	})

/** Maple's refusal bodies: `/mcp`'s `{ error, message }` and the v2 envelope's `{ error: { … } }`. */
export const MapleErrorBody = Schema.Struct({
	message: optional(Schema.String),
	error: Nullable(Schema.Union([Schema.String, Schema.Struct({ message: optional(Schema.String) })])),
})

export const detailOf = ({ message, error }: typeof MapleErrorBody.Type): string => {
	if (typeof message === "string" && message.trim() !== "") return message.trim()
	if (typeof error === "string") return error.trim()
	return error?.message?.trim() ?? ""
}

/** `$__orgFilter` expands to `(OrgId = '<the key's organization>')`: the only id the key tells us. */
const ORG_FILTER = /\(OrgId = '([^']+)'\)/

export const orgIdOf = (expandedSql: string): string | null => ORG_FILTER.exec(expandedSql)?.[1] ?? null

/**
 * Event names Hazel will put in a `WHERE EventName IN (…)` list. They come from the connection's
 * config, so a name is only ever sent when it cannot change the statement around it; the rest is
 * skipped and counted. Maple's own names are `object_action` plus the `$pageview` family.
 */
const EVENT_NAME = /^[A-Za-z0-9_$.:/-]{1,120}$/

export const isEventName = (name: string): boolean => EVENT_NAME.test(name)

/** A metric key Hazel will namespace and write; same reasoning as {@link isEventName}. */
const METRIC_KEY = /^[A-Za-z0-9_.-]{1,80}$/

export const isMetricKey = (key: string): boolean => METRIC_KEY.test(key)
