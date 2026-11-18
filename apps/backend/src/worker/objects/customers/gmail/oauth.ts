/**
 * Google OAuth for Gmail: the server's OAuth client (`GOOGLE_GMAIL_CLIENT_ID` /
 * `GOOGLE_GMAIL_CLIENT_SECRET`), the consent URL, and the token endpoint, for both the callback's
 * code exchange (`routes/customers-gmail.http.ts`) and each pull's refresh (`./adapter.ts`).
 *
 * The connection stores the **refresh token** as its API key (encrypted like every key,
 * `../credentials.ts`); an access token lives an hour and is never stored.
 *
 * Token endpoint failures map onto `CustomerProviderError` like the REST reads do
 * (`../provider-http.ts`): `invalid_grant` (the person revoked Hazel's access, changed their
 * password, or an External app in Testing let the token expire after 7 days) is `auth`, which
 * stops pulls until they reconnect; a refused client is `auth` too; 429 and 5xx retry.
 */
import { Config, Effect, Option, Redacted, Schema } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { GMAIL_SCOPE, GOOGLE_AUTHORIZE_URL, GOOGLE_TOKEN_URL, TokenError, TokenResponse } from "./wire"

export interface GmailOAuthClient {
	readonly clientId: string
	readonly clientSecret: Redacted.Redacted<string>
}

/** The callback path on the api Worker: the redirect URI registered with Google is the api URL + it. */
export const GMAIL_CALLBACK_PATH = "/customers/gmail/callback"

/** The server's OAuth client; none when either half is unset or blank (Gmail is then unavailable). */
export const gmailOAuthClient = Effect.gen(function* () {
	const config = yield* Config.all({
		clientId: Config.option(Config.String("GOOGLE_GMAIL_CLIENT_ID")),
		clientSecret: Config.option(Config.Redacted("GOOGLE_GMAIL_CLIENT_SECRET")),
	})
	const clientId = Option.getOrElse(config.clientId, () => "").trim()
	const clientSecret = Option.getOrNull(config.clientSecret)
	return clientId === "" || clientSecret === null || Redacted.value(clientSecret).trim() === ""
		? Option.none<GmailOAuthClient>()
		: Option.some<GmailOAuthClient>({ clientId, clientSecret })
})

/** Google's consent screen for `gmail.readonly`, offline (a refresh token), always re-consented. */
export const authorizeUrl = (input: {
	readonly client: GmailOAuthClient
	readonly redirectUri: string
	readonly state: string
}): string => {
	const url = new URL(GOOGLE_AUTHORIZE_URL)
	url.searchParams.set("client_id", input.client.clientId)
	url.searchParams.set("redirect_uri", input.redirectUri)
	url.searchParams.set("response_type", "code")
	url.searchParams.set("scope", GMAIL_SCOPE)
	url.searchParams.set("access_type", "offline")
	// Without it a second consent answers no refresh token.
	url.searchParams.set("prompt", "consent")
	url.searchParams.set("include_granted_scopes", "true")
	url.searchParams.set("state", input.state)
	return url.toString()
}

const TIMEOUT_MS = 30_000

const failure = (code: CustomerProviderError["code"], message: string, httpStatus: number | null) =>
	new CustomerProviderError({
		code,
		message,
		httpStatus,
		retryAfterMs: code === "rate_limited" ? 60_000 : null,
	})

/** A refusal no retry fixes (a request or a body Hazel got wrong). */
const fatal = (message: string, httpStatus: number) =>
	new CustomerProviderError({ code: "provider", message, httpStatus, retryAfterMs: null, retryable: false })

// A complete body that is not JSON fails to decode like one of the wrong shape: not retried.
const decodeToken = Schema.decodeUnknownEffect(Schema.fromJsonString(TokenResponse))
const decodeTokenError = Schema.decodeUnknownOption(Schema.fromJsonString(TokenError))

/** One `POST /token`, form-encoded; the client secret travels in the body only. */
const requestToken = Effect.fn("Gmail.token")(function* (
	http: HttpClient.HttpClient,
	client: GmailOAuthClient,
	params: Readonly<Record<string, string>>,
) {
	yield* Effect.annotateCurrentSpan({ "peer.service": "google", "gmail.grant": params.grant_type })
	const request = HttpClientRequest.post(GOOGLE_TOKEN_URL).pipe(
		HttpClientRequest.bodyUrlParams({
			...params,
			client_id: client.clientId,
			client_secret: Redacted.value(client.clientSecret),
		}),
		HttpClientRequest.acceptJson,
	)
	// The timeout covers the answer's body as well as its headers.
	const { status, text } = yield* Effect.gen(function* () {
		const response = yield* http
			.execute(request)
			.pipe(
				Effect.mapError((error) =>
					failure("network", `Could not reach Google (${error.reason._tag})`, null),
				),
			)
		const ok = response.status >= 200 && response.status < 300
		// A body cut off in transit: a granted token's is retried; a refusal's explains nothing.
		const text = yield* response.text.pipe(
			Effect.catchTag("HttpClientError", () =>
				ok
					? Effect.fail(
							failure("network", "Google's answer to the token request was cut off", null),
						)
					: Effect.succeed(""),
			),
		)
		return { status: response.status, text }
	}).pipe(
		Effect.timeoutOrElse({
			duration: TIMEOUT_MS,
			orElse: () =>
				Effect.fail(failure("network", "Google did not answer the token request in time", null)),
		}),
	)
	if (status >= 200 && status < 300) {
		return yield* decodeToken(text).pipe(
			Effect.catchTag("SchemaError", () =>
				Effect.fail(fatal("Google answered the token request with a body Hazel cannot read", status)),
			),
		)
	}
	const refusal = Option.getOrNull(decodeTokenError(text))
	if (refusal?.error === "invalid_grant") {
		return yield* failure(
			"auth",
			"Google no longer lets Hazel read this mailbox (access revoked or expired): reconnect Gmail",
			status,
		)
	}
	if (refusal?.error === "invalid_client" || refusal?.error === "unauthorized_client") {
		return yield* failure(
			"auth",
			"Google refused Hazel's Gmail OAuth client: check its Google settings",
			status,
		)
	}
	if (status === 429)
		return yield* failure("rate_limited", "Google's token endpoint is rate limited", status)
	if (status >= 500) return yield* failure("provider", `Google's token endpoint failed (${status})`, status)
	return yield* fatal(`Google refused the token request (${status})`, status)
})

/** The callback's exchange: the code for a refresh token and a first access token. */
export const exchangeCode = (
	http: HttpClient.HttpClient,
	client: GmailOAuthClient,
	input: { readonly code: string; readonly redirectUri: string },
) =>
	requestToken(http, client, {
		grant_type: "authorization_code",
		code: input.code,
		redirect_uri: input.redirectUri,
	})

/** A pull's access token, from the stored refresh token. */
export const refreshAccessToken = (
	http: HttpClient.HttpClient,
	client: GmailOAuthClient,
	refreshToken: Redacted.Redacted<string>,
) =>
	requestToken(http, client, {
		grant_type: "refresh_token",
		refresh_token: Redacted.value(refreshToken),
	})

/** Whether Google's space-separated `scope` grants reading the mailbox. */
export const grantsGmailRead = (scope: string | undefined): boolean =>
	scope !== undefined && scope.split(" ").includes(GMAIL_SCOPE)
