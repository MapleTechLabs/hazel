/**
 * One `run_sql` call against Maple's MCP endpoint, decoded, with Maple's failures mapped onto
 * `CustomerProviderError`. The HTTP half is `../provider-http.ts`:
 *
 * - 401/403 → `auth`: a revoked key, one of the other region, or one whose scopes do not cover the
 *   MCP toolset. The connection goes to `error` and scheduled pulls stop until the key changes.
 * - 429 → retried in place while Maple's `Retry-After` is short (it asks for 10 s at 120 requests
 *   per 10 s), then `rate_limited` carrying the delay; core resumes the run at its cursor.
 * - 5xx → `provider`; unreachable or too slow → `network`. Both retryable.
 * - Any other 4xx → `provider`, not retryable.
 * - A body Hazel cannot read → `provider`, not retryable, logged by decode path only.
 *
 * On top of that, two failures MCP reports inside a 200, which this module turns into the same
 * error type: a JSON-RPC `error` member (the protocol refused the call) and `result.isError` (the
 * tool could not run the query). Maple reports its warehouse's failures this way too — a ClickHouse
 * or gateway error, a query over its 120 s budget — so both are `provider` and **retryable**: the
 * run resumes at its cursor, and core gives a run up after a few failed attempts at the same page,
 * which bounds one Maple will never answer. A 200 with neither and no `structuredContent` is a
 * shape Hazel does not know, which no retry fixes. Messages name the step rather than repeating
 * Maple's own text: a run's message is synced to every member of the organization, and a warehouse
 * message is Maple's internals.
 */
import { Effect, type Redacted, Schema } from "effect"
import type { HttpClient } from "effect/http"
import type { MapleRegion } from "@hazel/domain/customers"
import { CustomerProviderError } from "../provider-errors"
import { makeProviderPost, type ProviderRequestOptions } from "../provider-http"
import { detailOf, MAPLE_API_URL, MapleErrorBody, MCP_HEADERS, MCP_PATH, RunSqlAnswer } from "./wire"

/** How much of Maple's own explanation a message or a log line repeats. */
const MAX_DETAIL_LENGTH = 200

const api = (region: MapleRegion) => ({
	name: "Maple",
	baseUrl: MAPLE_API_URL[region],
	routeOf: (path: typeof MCP_PATH) => path,
	headers: MCP_HEADERS,
	refusal: MapleErrorBody,
	detailOf,
	refusedMessage: (_route: string, status: number) =>
		status === 401
			? "Maple rejected the API key (401). A key of the other region is rejected too"
			: "Maple refused this key access to its MCP tools (403)",
	rateLimitedMessage: "Maple's rate limit for this organization is reached",
})

/** The window a `run_sql` call reads, as Maple takes it (`YYYY-MM-DD HH:MM:SS`, UTC). */
export interface SqlWindow {
	readonly start: string
	readonly end: string
}

const refused = (message: string, retryable: boolean) =>
	new CustomerProviderError({ code: "provider", message, httpStatus: null, retryAfterMs: null, retryable })

const clipped = (text: string) =>
	text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…` : text

/**
 * `run_sql` bound to one key and region. `rows` is read with `row`, so a result Hazel cannot read
 * is reported as Maple's API having changed instead of being retried page after page.
 *
 * `step` names the phase in messages and spans; it never carries an id or any of the SQL.
 */
export const makeMapleApi = (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	region: MapleRegion,
	options?: ProviderRequestOptions,
) => {
	const post = makeProviderPost(api(region), client, apiKey, options)
	const runSql = <S extends Schema.ConstraintDecoder<unknown>>(input: {
		readonly step: string
		readonly sql: string
		readonly window: SqlWindow
		readonly row: S
		readonly showSql?: boolean
	}) =>
		Effect.gen(function* () {
			const asked = {
				sql: input.sql,
				start_time: input.window.start,
				end_time: input.window.end,
			}
			const args = input.showSql === true ? { ...asked, show_sql: true } : asked
			const answer = yield* post(
				MCP_PATH,
				{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "run_sql", arguments: args } },
				RunSqlAnswer(input.row),
			)
			if (answer.error != null) {
				yield* Effect.logWarning("Maple refused the MCP call", {
					step: input.step,
					detail: clipped(answer.error.message ?? ""),
				})
				return yield* refused(
					`Maple refused Hazel's ${input.step} query; the next attempt retries it`,
					true,
				)
			}
			const result = answer.result
			if (result?.isError === true) {
				yield* Effect.logWarning("Maple could not run the usage query", {
					step: input.step,
					detail: clipped(result.content?.[0]?.text ?? ""),
				})
				return yield* refused(
					`Maple could not run Hazel's ${input.step} query; the next attempt retries it`,
					true,
				)
			}
			if (result?.structuredContent == null) {
				yield* Effect.logWarning("Maple answered the usage query without its result", {
					step: input.step,
				})
				return yield* refused(
					`Maple answered Hazel's ${input.step} query without a result (has Maple's API changed?)`,
					false,
				)
			}
			return result.structuredContent
		}).pipe(Effect.withSpan("Maple.runSql", { attributes: { "maple.step": input.step } }))
	return { runSql }
}

export type MapleApi = ReturnType<typeof makeMapleApi>
