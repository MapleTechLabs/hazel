/**
 * The OAuth broker's routes (`docs/self-hosting.md#brokered-integrations`). On Hazel's own install
 * (the broker, `OAUTH_BROKER_ENABLED=true`):
 *
 * - `GET /oauth-broker/:provider/start`: a customer instance's connection, sent to the provider;
 * - `POST /oauth-broker/:provider/refresh`: fresh tokens for a signed instance request.
 *
 * On a customer install (the client, `OAUTH_BROKER_URL` and friends):
 *
 * - `POST /integrations/:provider/broker-callback`: the sealed tokens the broker's page posts,
 *   saved like the install's own callback saves them;
 * - `POST /webhooks/:provider/brokered`: a Slack or GitHub delivery the broker relayed.
 *
 * Each answers 404 where its side is off. The provider's own redirect for a broker flow arrives at
 * the usual `/integrations/:provider/callback` (`./integrations.http.ts`).
 */
import { Config, Effect, Option } from "effect"
import { ByteSize } from "effect"
import { HttpIncomingMessage, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { OAuthProviderRegistry } from "../services/oauth"
import { handleBrokerRefresh, handleBrokerStart } from "../services/oauth-broker/broker"
import { openConnectPayload, verifyOwnState, verifyRelay } from "../services/oauth-broker/client"
import {
	type BrokeredProvider,
	isBrokeredProvider,
	loadBrokerClientConfig,
} from "../services/oauth-broker/config"
import { buildRedirectUrl, completeConnection, isFrontendUrl, type OAuthErrorCode } from "./integrations.http"
import { applySlackDelivery, dispatchGitHubEvent } from "./webhooks.http"
import type { OrganizationId, UserId } from "@hazel/schema"

const notFound = () => HttpServerResponse.text("Not found", { status: 404 })

const providerOf = (request: HttpServerRequest.HttpServerRequest, pattern: RegExp) => {
	const match = pattern.exec(new URL(request.url, "http://localhost").pathname)
	const provider = match?.[1]
	return provider !== undefined && isBrokeredProvider(provider) ? Option.some(provider) : Option.none()
}

const readCapped = (request: HttpServerRequest.HttpServerRequest, bytes: number) =>
	request.text.pipe(
		Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(bytes)),
		Effect.option,
	)

const ERROR_CODES: ReadonlyArray<OAuthErrorCode> = [
	"token_exchange_failed",
	"account_info_failed",
	"db_error",
	"encryption_error",
	"invalid_state",
]
const errorCodeOf = (value: string | null): OAuthErrorCode =>
	ERROR_CODES.find((code) => code === value) ?? "token_exchange_failed"

/** A redirect after a POST: the browser follows it with a GET. */
const seeOther = (url: string) =>
	HttpServerResponse.redirect(url, { status: 303, headers: { "cache-control": "no-store" } })

// ─── Broker side ─────────────────────────────────────────────────────────────

export const handleStartRoute = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const provider = providerOf(request, /^\/oauth-broker\/([^/]+)\/start$/)
	if (Option.isNone(provider)) return notFound()
	const url = new URL(request.url, "http://localhost")
	return yield* handleBrokerStart(provider.value, {
		instance: url.searchParams.get("instance") ?? undefined,
		state: url.searchParams.get("state") ?? undefined,
	})
})

export const handleRefreshRoute = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const provider = providerOf(request, /^\/oauth-broker\/([^/]+)\/refresh$/)
	if (Option.isNone(provider)) return notFound()
	return yield* handleBrokerRefresh(provider.value)
})

// ─── Client side ─────────────────────────────────────────────────────────────

/** The sealed payload and the instance's state are a few kilobytes; nothing near this. */
const MAX_CALLBACK_BYTES = 128 * 1024

/**
 * The broker's hand-back: open the sealed tokens (broker-signed, for this instance, unexpired),
 * check the instance's own signed state inside them, then save the connection as the install's
 * own callback does, marked `brokered` so its refreshes go through the broker too.
 */
export const handleBrokerCallbackRoute = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const provider = providerOf(request, /^\/integrations\/([^/]+)\/broker-callback$/)
	if (Option.isNone(provider)) return notFound()
	const client = yield* loadBrokerClientConfig
	if (Option.isNone(client)) return notFound()
	const frontendUrl = yield* Config.String("FRONTEND_URL").pipe(Effect.orDie)
	const failed = (returnTo: string, code: OAuthErrorCode) =>
		seeOther(buildRedirectUrl(returnTo, provider.value, "error", code))

	const body = yield* readCapped(request, MAX_CALLBACK_BYTES)
	if (Option.isNone(body)) return failed(frontendUrl, "invalid_state")
	const form = new URLSearchParams(body.value)
	const payload = form.get("payload")

	if (!payload) {
		// The broker reports a failure with the instance's state, so the user lands back where
		// they started; an unverifiable state lands on the app's root.
		const state = yield* Effect.promise(() =>
			verifyOwnState(client.value, provider.value, form.get("state") ?? ""),
		)
		const returnTo =
			state.ok && isFrontendUrl(state.value.returnTo, frontendUrl) ? state.value.returnTo : frontendUrl
		yield* Effect.logWarning("Brokered connection failed at the broker", {
			event: "integration_broker_callback_error",
			provider: provider.value,
			error: errorCodeOf(form.get("error")),
		})
		return failed(returnTo, errorCodeOf(form.get("error")))
	}

	const opened = yield* Effect.promise(() => openConnectPayload(client.value, provider.value, payload))
	if (!opened.ok) {
		yield* Effect.logWarning("Brokered connection payload refused", {
			event: "integration_broker_callback_refused",
			provider: provider.value,
			reason: opened.reason,
		})
		return failed(frontendUrl, "invalid_state")
	}
	const { state, data } = opened.value
	const returnTo = isFrontendUrl(state.returnTo, frontendUrl) ? state.returnTo : frontendUrl
	if (provider.value === "github" && data.installationId === undefined) {
		return failed(returnTo, "invalid_state")
	}

	const registry = yield* OAuthProviderRegistry
	const getAccountInfo = registry.getAccountInfoReader(provider.value)
	if (Option.isNone(getAccountInfo)) return failed(returnTo, "account_info_failed")

	const outcome = yield* completeConnection({
		provider: provider.value,
		organizationId: state.organizationId as OrganizationId,
		userId: state.userId as UserId,
		level: state.level,
		tokens: {
			accessToken: data.tokens.accessToken,
			refreshToken: data.tokens.refreshToken,
			expiresAt: data.tokens.expiresAt !== undefined ? new Date(data.tokens.expiresAt) : undefined,
			scope: data.tokens.scope,
			tokenType: data.tokens.tokenType,
		},
		getAccountInfo: getAccountInfo.value,
		metadata:
			provider.value === "github"
				? { installationId: data.installationId, brokered: true }
				: { brokered: true },
		audit: { brokered: true },
	})
	if (outcome._tag === "Failed") return failed(returnTo, outcome.code)
	return seeOther(buildRedirectUrl(returnTo, provider.value, "success"))
})

/** Relayed bodies are the providers' own webhook bodies. */
const MAX_WEBHOOK_BYTES = 1_000_000

const relayedProvider = (provider: BrokeredProvider): provider is "slack" | "github" =>
	provider === "slack" || provider === "github"

/** A delivery the broker relayed: its signature, this instance and its time, then applied here. */
export const handleBrokeredWebhookRoute = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const provider = providerOf(request, /^\/webhooks\/([^/]+)\/brokered$/)
	if (Option.isNone(provider) || !relayedProvider(provider.value)) return notFound()
	const client = yield* loadBrokerClientConfig
	if (Option.isNone(client)) return notFound()
	const body = yield* readCapped(request, MAX_WEBHOOK_BYTES)
	if (Option.isNone(body)) return HttpServerResponse.text("Unreadable body", { status: 400 })
	const relay = yield* Effect.promise(() =>
		verifyRelay(client.value, provider.value, request.headers, body.value),
	)
	if (!relay.ok) {
		yield* Effect.logWarning("Relayed webhook refused", {
			provider: provider.value,
			reason: relay.reason,
		})
		return HttpServerResponse.text("Unauthorized", { status: 401 })
	}
	if (provider.value === "slack") {
		const answer = yield* applySlackDelivery(body.value)
		return HttpServerResponse.jsonUnsafe(answer)
	}
	const payload = yield* Effect.try({
		try: () => JSON.parse(body.value) as unknown,
		catch: () => "not json" as const,
	}).pipe(Effect.option)
	if (Option.isNone(payload)) return HttpServerResponse.text("Body is not JSON", { status: 400 })
	const answer = yield* dispatchGitHubEvent({
		eventType: relay.value.event,
		deliveryId: relay.value.delivery,
		payload: payload.value,
	})
	return HttpServerResponse.jsonUnsafe(answer)
}).pipe(
	Effect.catchTags({
		InvalidSlackWebhookSignature: () =>
			Effect.succeed(HttpServerResponse.text("Bad body", { status: 400 })),
		InvalidGitHubWebhookPayload: () =>
			Effect.succeed(HttpServerResponse.text("Bad body", { status: 400 })),
		InternalServerError: () => Effect.succeed(HttpServerResponse.text("Failed", { status: 500 })),
	}),
	Effect.withSpan("OAuthBroker.relayedWebhook"),
)

/** Each handler under the services the router was built with (per-request ones aside). */
const routed = <A, E, R>(handler: Effect.Effect<A, E, R>) =>
	Effect.map(Effect.context<Exclude<R, HttpServerRequest.HttpServerRequest>>(), (context) =>
		handler.pipe(Effect.provideContext(context)),
	)

export const OAuthBrokerRoutes = HttpRouter.use((router) =>
	Effect.gen(function* () {
		yield* router.add("GET", "/oauth-broker/:provider/start", yield* routed(handleStartRoute))
		yield* router.add("POST", "/oauth-broker/:provider/refresh", yield* routed(handleRefreshRoute))
		yield* router.add(
			"POST",
			"/integrations/:provider/broker-callback",
			yield* routed(handleBrokerCallbackRoute),
		)
		yield* router.add("POST", "/webhooks/:provider/brokered", yield* routed(handleBrokeredWebhookRoute))
	}),
)
