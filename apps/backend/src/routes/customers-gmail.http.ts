/**
 * Connecting a Gmail mailbox to Customers (`docs/customers/gmail.md`), over Google OAuth:
 *
 * - `GET /customers/gmail/authorize?organizationId=…` (signed in, a member of the org): redirects
 *   to Google's consent screen for `gmail.readonly`, offline. The `state` is signed with the OAuth
 *   client's secret (organization, user, a nonce, an expiry 15 minutes out), and the nonce is also
 *   set as an httpOnly cookie on the api host, so the callback only completes in the browser that
 *   started the flow.
 * - `GET /customers/gmail/callback`: checks the state and the cookie, exchanges the code (a refresh
 *   token is required, so `prompt=consent`), reads the mailbox's address, and hands both to the
 *   org's `CustomersObject` (`customers.gmailConnect`), which checks the user is one of its members
 *   and connects (or reconnects) the mailbox. The browser lands on the Gmail data source page with
 *   `?gmail=connected`, or `?gmail=error&reason=<GmailConnectErrorReason>`.
 *
 * The redirect URI registered with Google is `API_BASE_URL` + `/customers/gmail/callback`, local dev
 * included (`http://localhost:3003/customers/gmail/callback`): Google accepts a localhost redirect,
 * so there is no forwarding to a local stack as the chat integrations do. Without
 * `GOOGLE_GMAIL_CLIENT_ID` / `GOOGLE_GMAIL_CLIENT_SECRET` the authorize route redirects back with
 * `reason=not_configured`; nothing else depends on them.
 */
import { CurrentUser, InternalServerError } from "@hazel/domain"
import type { GmailConnectErrorReason } from "@hazel/domain/http"
import { OrganizationId, UserId } from "@hazel/schema"
import { Clock, Config, Duration, Effect, Option, Redacted, Schema } from "effect"
import * as Base64Url from "effect/encoding/Base64Url"
import { HttpClient, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"
import { callObject } from "../worker/objects/calls"
import { CustomersGmailConnectCall } from "../worker/objects/customers/gmail/connect"
import { makeGmailApi } from "../worker/objects/customers/gmail/http"
import {
	authorizeUrl,
	exchangeCode,
	GMAIL_CALLBACK_PATH,
	gmailOAuthClient,
	type GmailOAuthClient,
	grantsGmailRead,
} from "../worker/objects/customers/gmail/oauth"
import { constantTimeEqual, hmacSha256 } from "../worker/objects/customers/webhook-crypto"
import { customersTarget } from "../worker/objects/kinds"
import { requireMember } from "./integration-resources.http"

const STATE_TTL_MS = 15 * 60_000
const NONCE_COOKIE = "hazel_gmail_oauth"
/** The cookie only travels to these routes. */
const COOKIE_PATH = "/customers/gmail"

const State = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	nonce: Schema.String,
	expiresAt: Schema.Number,
})
type State = typeof State.Type

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(State))

const signatureOf = (client: GmailOAuthClient, payload: string) =>
	Effect.map(
		hmacSha256(new TextEncoder().encode(Redacted.value(client.clientSecret)), `gmail-state:${payload}`),
		(signature) => Base64Url.encode(new Uint8Array(signature)),
	)

/** `<base64url JSON>.<HMAC>`: the callback trusts what the authorize route wrote, and nothing else. */
export const signState = (client: GmailOAuthClient, state: State) =>
	Effect.gen(function* () {
		const payload = Base64Url.encode(JSON.stringify(state))
		return `${payload}.${yield* signatureOf(client, payload)}`
	})

export const verifyState = (client: GmailOAuthClient, raw: string, now: number) =>
	Effect.gen(function* () {
		const [payload, signature] = raw.split(".")
		if (payload === undefined || signature === undefined) return Option.none<State>()
		if (!constantTimeEqual(signature, yield* signatureOf(client, payload))) return Option.none<State>()
		const json = Base64Url.decodeString(payload)
		if (json._tag === "Failure") return Option.none<State>()
		return Option.filter(decodeState(json.success), (state) => state.expiresAt > now)
	})

const randomNonce = () => Base64Url.encode(crypto.getRandomValues(new Uint8Array(32)))

const urls = Config.all({ api: Config.String("API_BASE_URL"), web: Config.String("FRONTEND_URL") })

/** The Gmail data source page of the org, or the app's root when the org is unknown. */
const sourcePage = (web: string, slug: string | null) =>
	slug === null ? new URL(web) : new URL(`${web}/${slug}/customers/settings/sources/gmail`)

const resultUrl = (page: URL, result: { readonly reason: GmailConnectErrorReason } | "connected") => {
	const url = new URL(page)
	if (result === "connected") {
		url.searchParams.set("gmail", "connected")
	} else {
		url.searchParams.set("gmail", "error")
		url.searchParams.set("reason", result.reason)
	}
	return url.toString()
}

const slugOf = (organizationId: OrganizationId) =>
	Effect.flatMap(Directory, (directory) => directory.org(organizationId)).pipe(
		Effect.map((org) => (Option.isSome(org) && org.value.deletedAt === null ? org.value.slug : null)),
	)

const authorize = Effect.fn("CustomersGmail.authorize")(function* (organizationId: OrganizationId) {
	const user = yield* CurrentUser.Context
	yield* requireMember(organizationId)
	const { api, web } = yield* urls
	const page = sourcePage(web, yield* slugOf(organizationId))
	const client = yield* gmailOAuthClient
	if (Option.isNone(client)) {
		return HttpServerResponse.redirect(resultUrl(page, { reason: "not_configured" }), { status: 302 })
	}
	const nonce = randomNonce()
	const state = yield* signState(client.value, {
		organizationId,
		userId: user.id,
		nonce,
		expiresAt: (yield* Clock.currentTimeMillis) + STATE_TTL_MS,
	})
	yield* Effect.annotateCurrentSpan({ "organization.id": organizationId })
	return HttpServerResponse.redirect(
		authorizeUrl({ client: client.value, redirectUri: `${api}${GMAIL_CALLBACK_PATH}`, state }),
		{ status: 302 },
	).pipe(
		HttpServerResponse.setCookieUnsafe(NONCE_COOKIE, nonce, {
			path: COOKIE_PATH,
			httpOnly: true,
			secure: api.startsWith("https:"),
			sameSite: "lax",
			maxAge: Duration.millis(STATE_TTL_MS),
		}),
	)
})

const callback = Effect.fn("CustomersGmail.callback")(function* (
	query: {
		readonly code?: string | undefined
		readonly state?: string | undefined
		readonly error?: string | undefined
		readonly scope?: string | undefined
	},
	http: HttpClient.HttpClient,
) {
	const request = yield* HttpServerRequest.HttpServerRequest
	const { api, web } = yield* urls
	const back = (url: string) =>
		HttpServerResponse.redirect(url, { status: 302 }).pipe(
			HttpServerResponse.expireCookieUnsafe(NONCE_COOKIE, {
				path: COOKIE_PATH,
				httpOnly: true,
				secure: api.startsWith("https:"),
				sameSite: "lax",
			}),
		)
	const failed = (page: URL, reason: GmailConnectErrorReason, detail?: string) =>
		Effect.logWarning("Gmail connect failed", { reason, detail }).pipe(
			Effect.as(back(resultUrl(page, { reason }))),
		)
	const root = sourcePage(web, null)
	const client = yield* gmailOAuthClient
	if (Option.isNone(client)) return yield* failed(root, "not_configured")
	const state =
		query.state === undefined
			? Option.none<State>()
			: yield* verifyState(client.value, query.state, yield* Clock.currentTimeMillis)
	const nonce = request.cookies[NONCE_COOKIE]
	if (Option.isNone(state) || nonce === undefined || !constantTimeEqual(nonce, state.value.nonce)) {
		return yield* failed(root, "invalid_state")
	}
	const { organizationId, userId } = state.value
	yield* Effect.annotateCurrentSpan({ "organization.id": organizationId })
	const slug = yield* slugOf(organizationId)
	if (slug === null) return yield* failed(root, "forbidden", "unknown organization")
	const page = sourcePage(web, slug)
	if (query.error !== undefined) return yield* failed(page, "denied", query.error)
	if (query.code === undefined) return yield* failed(page, "invalid_state", "no code")
	const tokens = yield* exchangeCode(http, client.value, {
		code: query.code,
		redirectUri: `${api}${GMAIL_CALLBACK_PATH}`,
	}).pipe(Effect.result)
	if (tokens._tag === "Failure") return yield* failed(page, "token_exchange_failed", tokens.failure.message)
	if (!grantsGmailRead(tokens.success.scope)) return yield* failed(page, "scope_missing")
	const refreshToken = tokens.success.refresh_token
	if (refreshToken === undefined) return yield* failed(page, "token_exchange_failed", "no refresh token")
	const profile = yield* makeGmailApi(http, Redacted.make(tokens.success.access_token))
		.profile()
		.pipe(Effect.result)
	if (profile._tag === "Failure") return yield* failed(page, "profile_failed", profile.failure.message)
	const connected = yield* callObject(CustomersGmailConnectCall, customersTarget(organizationId), {
		organizationId,
		userId,
		mailbox: profile.success.emailAddress.toLowerCase(),
		refreshToken,
	}).pipe(Effect.result)
	if (connected._tag === "Failure") {
		const error = connected.failure
		return yield* failed(
			page,
			error._tag === "CustomersGmailConnectError" ? error.reason : "failed",
			error._tag === "ObjectCallError" ? error.message : undefined,
		)
	}
	yield* Effect.logInfo("Gmail mailbox connected", {
		organizationId,
		userId,
		connectionId: connected.success.connectionId,
	})
	return back(resultUrl(page, "connected"))
})

const internal = (message: string) => (cause: { readonly _tag: string }) =>
	Effect.fail(new InternalServerError({ message, detail: cause._tag, cause }))

export const HttpCustomersGmailLive = HttpApiBuilder.group(HazelApi, "customersGmail", (handlers) =>
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient
		return handlers
			.handle("authorize", ({ query }) =>
				authorize(query.organizationId).pipe(
					Effect.catchTags({
						ConfigError: internal("Gmail is not configured"),
						DatabaseError: internal("Could not read the organization"),
					}),
				),
			)
			.handle("callback", ({ query }) =>
				callback(query, http).pipe(
					Effect.catchTags({
						ConfigError: internal("Gmail is not configured"),
						DatabaseError: internal("Could not read the organization"),
					}),
				),
			)
	}),
)
