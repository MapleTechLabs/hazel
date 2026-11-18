/**
 * The Gmail API reads, over one access token, with Google's failures mapped onto
 * `CustomerProviderError` by `../provider-http.ts` (401 → `auth`, 429 and 5xx retried, other 4xx
 * not). One Gmail twist on top: Google answers its per-user quota with **403**
 * `rateLimitExceeded` / `userRateLimitExceeded` as well as 429, and a 403 would otherwise stop
 * pulls as `auth`; those become `rate_limited`, retried after a minute.
 */
import { Effect, type Redacted, type Schema } from "effect"
import type { HttpClient } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { makeProviderGet, type ProviderQuery } from "../provider-http"
import {
	detailOf,
	GMAIL_API_URL,
	GoogleErrorBody,
	Message,
	MessageList,
	MESSAGES_PATH,
	Profile,
	PROFILE_PATH,
} from "./wire"

type GmailPath = typeof PROFILE_PATH | typeof MESSAGES_PATH | `${typeof MESSAGES_PATH}/${string}`

const API = {
	name: "Gmail",
	baseUrl: GMAIL_API_URL,
	// A message id never reaches a message, a log or a span.
	routeOf: (path: GmailPath) =>
		path === PROFILE_PATH || path === MESSAGES_PATH ? path : `${MESSAGES_PATH}/{id}`,
	refusal: GoogleErrorBody,
	detailOf,
	refusedMessage: (_route: string, status: number) =>
		status === 401
			? "Google refused Hazel's access to this mailbox (401): reconnect Gmail"
			: "Google refused Hazel access to this mailbox (403): reconnect Gmail and allow reading mail",
	rateLimitedMessage: "Gmail's rate limit for this mailbox is reached",
}

const QUOTA_REASON = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/

/** A 403 that is Gmail's quota speaking, not a refused grant. */
const quotaAsRateLimit = (error: CustomerProviderError) =>
	error.code === "auth" && error.httpStatus === 403 && QUOTA_REASON.test(error.message)
		? new CustomerProviderError({
				code: "rate_limited",
				message: API.rateLimitedMessage,
				httpStatus: 403,
				retryAfterMs: 60_000,
			})
		: error

export const makeGmailApi = (client: HttpClient.HttpClient, accessToken: Redacted.Redacted<string>) => {
	const get = makeProviderGet(API, client, accessToken)
	const read = <A>(path: GmailPath, query: ProviderQuery, schema: Schema.Decoder<A>) =>
		get(path, query, schema).pipe(Effect.mapError(quotaAsRateLimit))
	return {
		profile: () => read(PROFILE_PATH, [], Profile),
		list: (input: {
			readonly q: string
			readonly pageToken: string | null
			readonly maxResults: number
		}) =>
			read(
				MESSAGES_PATH,
				[
					["q", input.q],
					["maxResults", String(input.maxResults)],
					...(input.pageToken === null ? [] : [["pageToken", input.pageToken] as const]),
				],
				MessageList,
			),
		message: (id: string) =>
			read(`${MESSAGES_PATH}/${encodeURIComponent(id)}`, [["format", "full"]], Message),
	}
}

export type GmailApi = ReturnType<typeof makeGmailApi>
