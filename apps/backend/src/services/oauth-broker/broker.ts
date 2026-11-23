/**
 * The OAuth broker, on Hazel's own install (`OAUTH_BROKER_ENABLED=true`,
 * `docs/self-hosting.md#brokered-integrations`): it lets a registered customer instance connect
 * Slack, Linear and the GitHub App through Hazel's own registered apps.
 *
 * - `start`: checks the instance's signed state, then sends the browser to the provider with
 *   Hazel's client id and a state of its own (HMAC, `OAUTH_BROKER_STATE_KEY`);
 * - the provider redirects to Hazel's usual `/integrations/:provider/callback`, which hands a
 *   broker state here: the code is exchanged with Hazel's credentials and the tokens are sealed to
 *   the instance and posted to it by the browser, never stored;
 * - `refresh`: a GitHub installation token, or an OAuth refresh, for a signed instance request;
 * - `relay`: Slack and GitHub deliver every installation's webhooks to Hazel's app URL; one whose
 *   installation was brokered is verified as usual, then forwarded, signed, to its instance.
 *
 * The broker keeps only `oauth_broker_routes` (installation → instance), never a token.
 */
import { createHash } from "node:crypto"
import { GitHub } from "@hazel/integrations"
import { Effect, Option, Redacted, Schedule, Schema } from "effect"
import { HttpBody, HttpClient, HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/http"
import { ByteSize, Duration } from "effect"
import { Directory } from "../directory"
import { OAuthHttpClient } from "../oauth/oauth-http-client"
import { OAuthProviderRegistry } from "../oauth/oauth-provider-registry"
import { loadProviderConfig, type OAuthTokens } from "../oauth/provider-config"
import { BROKER_HEADERS, type BrokeredTokens, type ConnectData } from "./protocol"
import { type BrokerConfig, type BrokeredProvider, type BrokerInstance, loadBrokerConfig } from "./config"
import {
	currentTimestamp,
	isFresh,
	refreshSigningInput,
	relaySigningInput,
	seal,
	sign,
	signBrokerState,
	verify,
	verifyBrokerState,
	verifyCustomerState,
} from "./crypto"

const toBrokeredTokens = (tokens: OAuthTokens): BrokeredTokens => ({
	accessToken: tokens.accessToken,
	refreshToken: tokens.refreshToken,
	expiresAt: tokens.expiresAt?.getTime(),
	scope: tokens.scope,
	tokenType: tokens.tokenType,
})

const text = (body: string, status: number) =>
	HttpServerResponse.text(body, { status, headers: { "cache-control": "no-store" } })

const GITHUB_INSTALLATION_ID = /^\d{1,20}$/

// ─── The hand-back page ──────────────────────────────────────────────────────

const HANDBACK_SCRIPT = "document.forms[0].submit()"
const HANDBACK_SCRIPT_HASH = `sha256-${createHash("sha256").update(HANDBACK_SCRIPT).digest("base64")}`

const escapeHtml = (value: string) =>
	value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;")

/**
 * A page that posts `fields` to the instance's broker callback: a form POST keeps the sealed
 * tokens out of URLs (and so out of history, `Referer` and access logs). It may run only its one
 * inline script and post only to that instance.
 */
export const handBackPage = (instance: BrokerInstance, provider: string, fields: Record<string, string>) => {
	const action = `${instance.apiUrl.replace(/\/$/, "")}/integrations/${provider}/broker-callback`
	const inputs = Object.entries(fields)
		.map(
			([name, value]) =>
				`<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
		)
		.join("")
	const html =
		`<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">` +
		`<title>Connecting…</title></head><body>` +
		`<form method="post" action="${escapeHtml(action)}">${inputs}` +
		`<noscript><button type="submit">Continue</button></noscript></form>` +
		`<script>${HANDBACK_SCRIPT}</script></body></html>`
	return HttpServerResponse.text(html, {
		status: 200,
		contentType: "text/html; charset=utf-8",
		headers: {
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
			"x-content-type-options": "nosniff",
			"content-security-policy": `default-src 'none'; script-src '${HANDBACK_SCRIPT_HASH}'; form-action ${new URL(action).origin}; frame-ancestors 'none'; base-uri 'none'`,
		},
	})
}

// ─── Start ───────────────────────────────────────────────────────────────────

/**
 * `GET /oauth-broker/:provider/start?instance=<id>&state=<instance-signed state>`: a registered
 * instance's user, sent to the provider's consent page with Hazel's app.
 */
export const handleBrokerStart = Effect.fn("OAuthBroker.start")(function* (
	provider: BrokeredProvider,
	query: { readonly instance: string | undefined; readonly state: string | undefined },
) {
	const config = yield* loadBrokerConfig
	if (Option.isNone(config)) return text("Not found", 404)
	const instance = query.instance ? config.value.instances.get(query.instance) : undefined
	if (!instance || !query.state) return text("Unknown instance", 400)
	yield* Effect.annotateCurrentSpan({ "broker.instance": instance.id, "integration.provider": provider })
	const customerState = yield* Effect.promise(() =>
		verifyCustomerState(instance.publicKey.sig as JsonWebKey, query.state ?? "", {
			instanceId: instance.id,
			provider,
		}),
	)
	if (!customerState.ok) {
		yield* Effect.logWarning("OAuth broker refused a start", {
			instance: instance.id,
			provider,
			reason: customerState.reason,
		})
		return text("Invalid or expired state", 400)
	}
	const registry = yield* OAuthProviderRegistry
	const oauthProvider = yield* registry.getProvider(provider).pipe(Effect.option)
	if (Option.isNone(oauthProvider)) return text(`${provider} is not available through the broker`, 503)
	const brokerState = yield* Effect.promise(() =>
		signBrokerState(config.value.stateKey, {
			i: instance.id,
			p: provider,
			s: query.state ?? "",
			l: customerState.value.level,
		}),
	)
	const url = yield* oauthProvider.value.buildAuthorizationUrl(brokerState, customerState.value.level)
	yield* Effect.logInfo("OAuth broker flow started", {
		event: "oauth_broker_start",
		instance: instance.id,
		provider,
		level: customerState.value.level,
	})
	return HttpServerResponse.redirect(url.toString(), {
		status: 302,
		headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" },
	})
})

// ─── Provider callback ───────────────────────────────────────────────────────

const retrySchedule = Schedule.max([Schedule.exponential("100 millis"), Schedule.recurs(2)])

/** How long before the broker's state was issued a GitHub installation may have changed. */
const INSTALLATION_FRESHNESS_SLACK_MS = 2 * 60 * 1000

/**
 * The provider's redirect for a broker flow (dispatched from `/integrations/:provider/callback`):
 * exchange with Hazel's credentials, record the installation's route, and hand the sealed tokens
 * to the instance. Every outcome after the state checks out goes back to the instance, which
 * shows it on the page its user started from.
 */
export const handleBrokerProviderCallback = Effect.fn("OAuthBroker.callback")(function* (
	provider: BrokeredProvider,
	query: {
		readonly state: string
		readonly code: string | undefined
		readonly installationId: string | undefined
	},
) {
	const config = yield* loadBrokerConfig
	if (Option.isNone(config)) return text("Not found", 404)
	const verified = yield* Effect.promise(() =>
		verifyBrokerState(config.value.stateKey, query.state, { provider }),
	)
	if (!verified.ok) {
		yield* Effect.logWarning("OAuth broker refused a callback", { provider, reason: verified.reason })
		return text("This connection link is invalid or has expired. Start again from your Hazel.", 400)
	}
	const state = verified.value
	const instance = config.value.instances.get(state.i)
	if (!instance) return text("This instance is no longer registered with the broker.", 400)
	yield* Effect.annotateCurrentSpan({ "broker.instance": instance.id, "integration.provider": provider })
	const fail = (code: string, detail?: Record<string, unknown>) =>
		Effect.logWarning("OAuth broker callback failed", {
			event: "oauth_broker_callback_failed",
			instance: instance.id,
			provider,
			code,
			...detail,
		}).pipe(Effect.as(handBackPage(instance, provider, { error: code, state: state.s })))

	const registry = yield* OAuthProviderRegistry
	const oauthProvider = yield* registry.getProvider(provider).pipe(Effect.option)
	if (Option.isNone(oauthProvider)) return yield* fail("token_exchange_failed")
	const directory = yield* Directory

	const authCode = provider === "github" ? query.installationId : query.code
	if (!authCode) return yield* fail("invalid_state")

	if (provider === "github") {
		if (!GITHUB_INSTALLATION_ID.test(authCode)) return yield* fail("invalid_state")
		const claim = yield* claimGitHubInstallation(config.value, instance, authCode, state.iat)
		if (claim !== "ok") return yield* fail("invalid_state", { reason: claim })
	}

	const tokens = yield* oauthProvider.value
		.exchangeCodeForTokens(authCode)
		.pipe(Effect.retry({ schedule: retrySchedule }), Effect.option)
	if (Option.isNone(tokens)) return yield* fail("token_exchange_failed")

	// Slack's events come to Hazel's app URL for every workspace: route the workspace's to the
	// instance (the bot token names its team). A user's own link carries no events.
	if (provider === "slack" && state.l === "organization") {
		const account = yield* oauthProvider.value
			.getAccountInfo(tokens.value.accessToken)
			.pipe(Effect.option)
		if (Option.isNone(account)) return yield* fail("account_info_failed")
		const recorded = yield* directory
			.upsertBrokerRoute({
				provider,
				externalId: account.value.externalAccountId,
				instanceId: instance.id,
			})
			.pipe(Effect.option)
		if (Option.isNone(recorded)) return yield* fail("db_error")
	}
	if (provider === "github") {
		const recorded = yield* directory
			.upsertBrokerRoute({ provider, externalId: authCode, instanceId: instance.id })
			.pipe(Effect.option)
		if (Option.isNone(recorded)) return yield* fail("db_error")
	}

	const data: ConnectData = {
		tokens: toBrokeredTokens(tokens.value),
		installationId: provider === "github" ? authCode : undefined,
	}
	const sealed = yield* Effect.promise(() =>
		seal({
			instanceId: instance.id,
			instanceEncKey: instance.publicKey.enc as JsonWebKey,
			brokerSigningKey: config.value.signingKey,
			provider,
			kind: "connect",
			state: state.s,
			data,
		}),
	)
	yield* Effect.logInfo("AUDIT: OAuth broker handed tokens to an instance", {
		event: "oauth_broker_handback",
		instance: instance.id,
		provider,
		level: state.l,
	})
	return handBackPage(instance, provider, { payload: sealed })
})

/**
 * A GitHub setup redirect's `installation_id` is only a query parameter: anyone could paste
 * another account's. The broker accepts it for an instance only when no one else holds it (not
 * another instance, not an org on Hazel's own install) and GitHub says it was installed or
 * changed during this flow, which is what the setup redirect follows.
 */
const claimGitHubInstallation = Effect.fn("OAuthBroker.claimGitHubInstallation")(function* (
	_config: BrokerConfig,
	instance: BrokerInstance,
	installationId: string,
	stateIssuedAtSeconds: number,
) {
	const directory = yield* Directory
	const route = yield* directory.brokerRoute("github", installationId).pipe(Effect.option)
	if (Option.isNone(route)) return "lookup_failed" as const
	if (Option.isSome(route.value)) {
		return route.value.value.instanceId === instance.id
			? ("ok" as const)
			: ("claimed_by_another_instance" as const)
	}
	const local = yield* directory.integration("github", installationId).pipe(Effect.option)
	if (Option.isNone(local)) return "lookup_failed" as const
	if (Option.isSome(local.value)) return "claimed_locally" as const
	const jwt = yield* GitHub.GitHubAppJWTService
	const installation = yield* jwt.getInstallation(installationId).pipe(Effect.option)
	if (Option.isNone(installation)) return "unknown_installation" as const
	const since = stateIssuedAtSeconds * 1000 - INSTALLATION_FRESHNESS_SLACK_MS
	const changed = Math.max(installation.value.createdAt.getTime(), installation.value.updatedAt.getTime())
	return changed >= since ? ("ok" as const) : ("not_changed_during_flow" as const)
})

// ─── Refresh ─────────────────────────────────────────────────────────────────

const RefreshRequest = Schema.Struct({
	installationId: Schema.optional(Schema.String),
	refreshToken: Schema.optional(Schema.String),
})
const decodeRefreshRequest = Schema.decodeUnknownOption(Schema.fromJsonString(RefreshRequest))

const MAX_REQUEST_BYTES = 16 * 1024

const readCapped = (request: HttpServerRequest.HttpServerRequest, bytes: number) =>
	request.text.pipe(
		Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(bytes)),
		Effect.option,
	)

/**
 * `POST /oauth-broker/:provider/refresh`, signed by the instance (`x-hazel-broker-*`): a fresh
 * GitHub installation token for an installation routed to it, or an OAuth refresh with Hazel's
 * client credentials. The answer is sealed to the instance like a connection's.
 */
export const handleBrokerRefresh = Effect.fn("OAuthBroker.refresh")(function* (provider: BrokeredProvider) {
	const config = yield* loadBrokerConfig
	if (Option.isNone(config)) return text("Not found", 404)
	const request = yield* HttpServerRequest.HttpServerRequest
	const instanceId = request.headers[BROKER_HEADERS.instance] ?? ""
	const timestamp = request.headers[BROKER_HEADERS.timestamp] ?? ""
	const signature = request.headers[BROKER_HEADERS.signature] ?? ""
	const instance = config.value.instances.get(instanceId)
	if (!instance) return text("Unknown instance", 401)
	if (!isFresh(timestamp)) return text("Stale request", 401)
	const body = yield* readCapped(request, MAX_REQUEST_BYTES)
	if (Option.isNone(body)) return text("Unreadable body", 400)
	const signed = yield* Effect.promise(() =>
		verify(
			instance.publicKey.sig as JsonWebKey,
			refreshSigningInput({ provider, instanceId, timestamp, body: body.value }),
			signature,
		),
	)
	if (!signed) {
		yield* Effect.logWarning("OAuth broker refused a refresh signature", {
			instance: instanceId,
			provider,
		})
		return text("Bad signature", 401)
	}
	const payload = decodeRefreshRequest(body.value)
	if (Option.isNone(payload)) return text("Malformed request", 400)
	yield* Effect.annotateCurrentSpan({ "broker.instance": instance.id, "integration.provider": provider })

	let tokens: BrokeredTokens
	if (provider === "github") {
		const installationId = payload.value.installationId ?? ""
		if (!GITHUB_INSTALLATION_ID.test(installationId)) return text("Missing installation", 400)
		const route = yield* (yield* Directory).brokerRoute("github", installationId).pipe(Effect.option)
		if (Option.isNone(route)) return text("Unavailable", 503)
		if (Option.isNone(route.value) || route.value.value.instanceId !== instance.id) {
			yield* Effect.logWarning(
				"OAuth broker refused a token for an installation the instance does not hold",
				{
					instance: instance.id,
					installationId,
				},
			)
			return text("Installation not brokered for this instance", 403)
		}
		const minted = yield* (yield* GitHub.GitHubAppJWTService)
			.getInstallationToken(installationId)
			.pipe(Effect.option)
		if (Option.isNone(minted)) return text("GitHub refused the token", 502)
		tokens = {
			accessToken: minted.value.token,
			expiresAt: minted.value.expiresAt.getTime(),
			tokenType: "Bearer",
		}
	} else {
		const refreshToken = payload.value.refreshToken
		if (!refreshToken) return text("Missing refresh token", 400)
		const providerConfig = yield* loadProviderConfig(provider).pipe(Effect.option)
		if (Option.isNone(providerConfig)) return text(`${provider} is not available through the broker`, 503)
		const refreshed = yield* Effect.flatMap(OAuthHttpClient, (client) =>
			client.refreshToken(provider, {
				refreshToken,
				clientId: providerConfig.value.clientId,
				clientSecret: Redacted.value(providerConfig.value.clientSecret),
			}),
		).pipe(Effect.provide(OAuthHttpClient.layer), Effect.option)
		if (Option.isNone(refreshed)) return text("The provider refused the refresh", 502)
		tokens = toBrokeredTokens(refreshed.value)
	}
	const sealed = yield* Effect.promise(() =>
		seal({
			instanceId: instance.id,
			instanceEncKey: instance.publicKey.enc as JsonWebKey,
			brokerSigningKey: config.value.signingKey,
			provider,
			kind: "refresh",
			data: { tokens },
		}),
	)
	yield* Effect.logInfo("AUDIT: OAuth broker refreshed a token for an instance", {
		event: "oauth_broker_refresh",
		instance: instance.id,
		provider,
	})
	return HttpServerResponse.jsonUnsafe({ payload: sealed }, { headers: { "cache-control": "no-store" } })
})

// ─── Webhook relay ───────────────────────────────────────────────────────────

const RELAY_TIMEOUT = Duration.seconds(10)

/**
 * Forwards a verified provider delivery to the instance its installation is routed to, signed
 * with the broker's key. `none` when the broker is off or the installation is not brokered (the
 * install handles it itself); otherwise whether the instance took it.
 */
export const relayToInstance = Effect.fn("OAuthBroker.relay")(function* (input: {
	readonly provider: "slack" | "github"
	readonly externalId: string
	readonly rawBody: string
	readonly event?: string
	readonly delivery?: string
}) {
	const config = yield* loadBrokerConfig
	if (Option.isNone(config)) return Option.none<boolean>()
	const route = yield* (yield* Directory).brokerRoute(input.provider, input.externalId)
	if (Option.isNone(route)) return Option.none<boolean>()
	const instance = config.value.instances.get(route.value.instanceId)
	if (!instance) {
		yield* Effect.logWarning("OAuth broker route names an unregistered instance; delivery dropped", {
			provider: input.provider,
			instance: route.value.instanceId,
		})
		return Option.some(false)
	}
	yield* Effect.annotateCurrentSpan({
		"broker.instance": instance.id,
		"integration.provider": input.provider,
	})
	const timestamp = currentTimestamp()
	const event = input.event ?? ""
	const delivery = input.delivery ?? ""
	const signature = yield* Effect.promise(() =>
		sign(
			config.value.signingKey,
			relaySigningInput({
				provider: input.provider,
				instanceId: instance.id,
				timestamp,
				event,
				delivery,
				body: input.rawBody,
			}),
		),
	)
	const client = yield* HttpClient.HttpClient
	const response = yield* client
		.post(`${instance.apiUrl.replace(/\/$/, "")}/webhooks/${input.provider}/brokered`, {
			headers: {
				[BROKER_HEADERS.instance]: instance.id,
				[BROKER_HEADERS.timestamp]: timestamp,
				[BROKER_HEADERS.signature]: signature,
				[BROKER_HEADERS.event]: event,
				[BROKER_HEADERS.delivery]: delivery,
			},
			body: HttpBody.text(input.rawBody, "application/json"),
		})
		.pipe(Effect.timeout(RELAY_TIMEOUT), Effect.option)
	const ok = Option.isSome(response) && response.value.status >= 200 && response.value.status < 300
	yield* (ok ? Effect.logInfo : Effect.logWarning)("OAuth broker relayed a delivery", {
		event: "oauth_broker_relay",
		provider: input.provider,
		instance: instance.id,
		status: Option.isSome(response) ? response.value.status : null,
	})
	return Option.some(ok)
})
