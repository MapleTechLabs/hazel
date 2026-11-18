/**
 * The Gmail data source (`docs/customers/gmail.md`): the emails between the org's people and its
 * customers, on each customer's timeline. One connection per **mailbox**: every Customers member
 * may connect their own (`routes/customers-gmail.http.ts`, Google OAuth, scope `gmail.readonly`),
 * and the connection's `externalAccountId` is the mailbox address, lowercased.
 *
 * Credentials: the OAuth **refresh token** is the connection's API key (stored encrypted,
 * `../credentials.ts`); a pull exchanges it for an access token (`./oauth.ts`), kept in memory for
 * the rest of the alarm turn. A revoked or expired grant is `auth`: pulls stop until the person
 * reconnects.
 *
 * It creates no account and no contact and parks nothing: `pull` produces `email` ops and ingest
 * attributes each to the accounts of its external participants, dropping the rest. Polling only
 * (no Pub/Sub push), every 10 minutes; no webhooks.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Clock, Effect, Option, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError, CustomerWebhookRejectedError } from "../provider-errors"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { makeGmailApi } from "./http"
import { gmailOAuthClient, refreshAccessToken } from "./oauth"
import { GMAIL_PULL_INTERVAL_MS, pullPage } from "./pull"

const refused = (message: string) =>
	new CustomerProviderError({ code: "auth", message, httpStatus: null, retryAfterMs: null })

/** The server lost its Google client (env): retried with backoff, not the connection's fault. */
const unconfigured = new CustomerProviderError({
	code: "provider",
	message: "Gmail is not configured on this Hazel server (Google OAuth client missing)",
	httpStatus: null,
	retryAfterMs: null,
})

/** An access token this close to expiry is refreshed instead of used. */
const EXPIRY_MARGIN_MS = 60_000

const gmailConfig = (config: ConnectionConfig) =>
	config._tag === "gmail" ? Option.some(config) : Option.none()

export const makeGmailAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	/** Access tokens by refresh token, for the layer's life (one alarm turn, or one request). */
	const tokens = new Map<
		string,
		{ readonly token: Redacted.Redacted<string>; readonly expiresAt: number }
	>()

	const accessToken = Effect.fn("Gmail.accessToken")(function* (credentials: ProviderCredentials) {
		const oauth = yield* gmailOAuthClient.pipe(
			Effect.catchTag("ConfigError", () => Effect.fail(unconfigured)),
		)
		if (Option.isNone(oauth)) return yield* unconfigured
		const key = Redacted.value(credentials.apiKey)
		const now = yield* Clock.currentTimeMillis
		const cached = tokens.get(key)
		if (cached !== undefined && cached.expiresAt - EXPIRY_MARGIN_MS > now) return cached.token
		const granted = yield* refreshAccessToken(client, oauth.value, credentials.apiKey)
		const token = Redacted.make(granted.access_token)
		tokens.set(key, { token, expiresAt: now + granted.expires_in * 1000 })
		return token
	})

	const adapter: CustomerProviderAdapter = {
		provider: "gmail",

		validate: (credentials) =>
			Effect.gen(function* () {
				const api = makeGmailApi(client, yield* accessToken(credentials))
				const profile = yield* api.profile()
				return {
					externalAccountId: profile.emailAddress.toLowerCase(),
					externalAccountName: profile.emailAddress,
				}
			}),

		// Gmail's push goes through Pub/Sub, which this integration does not use.
		webhook: () =>
			Effect.fail(new CustomerWebhookRejectedError({ message: "Gmail sends Hazel no webhooks" })),

		pull: (input) =>
			Effect.gen(function* () {
				const config = gmailConfig(input.credentials.config)
				if (Option.isNone(config))
					return yield* refused("The Gmail connection has no Gmail settings; reconnect it")
				const mailbox = input.credentials.externalAccountId
				if (mailbox === null)
					return yield* refused("The Gmail connection has no mailbox; reconnect it")
				return yield* pullPage({
					api: makeGmailApi(client, yield* accessToken(input.credentials)),
					mailbox,
					config: config.value,
					cursor: input.cursor,
					since: input.since,
				})
			}),

		pullIntervalMs: GMAIL_PULL_INTERVAL_MS,
	}
	return adapter
})
