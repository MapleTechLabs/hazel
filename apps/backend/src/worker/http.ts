/**
 * The api Worker's request path: the route graph built once per isolate on the first request,
 * and the fetch handler that runs it under a per-request Postgres connection.
 */
import { OutboxWrites } from "@hazel/backend-core"
import { bridgeHandler, forIsolate, WorkerPlatformLive } from "@hazel/infra/worker-http"
import type * as Cloudflare from "alchemy/Cloudflare"
import type { HttpEffect } from "alchemy/Http"
import { type Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { AllRoutes, AppAuthorizationLive, AppServicesLive } from "../app"
import type { BotGatewayNamespace } from "../services/bot-gateway-transport"
import { OUTBOX_DISPATCHER_NAME, type OutboxDispatcherObject } from "./outbox-dispatcher-object"
import { provideRequestDatabase, requestPlatformLive } from "./platform"
import { type RateLimiterObject, rateLimiterLive } from "./rate-limiter-object"

/** The route graph as one request handler, built under the isolate's context (never a request's). */
export const buildApp = (
	isolate: Context.Context<never>,
	env: Record<string, unknown>,
	rateLimiters: Cloudflare.DurableObject<RateLimiterObject>,
	botGateways: BotGatewayNamespace,
) =>
	forIsolate(isolate)(
		HttpRouter.toHttpEffect(
			// The cast restores the layer's type: the circular `DiscordSyncWorker` typing collapses
			// `AppServicesLive`'s error and requirement channels to `unknown` (see index.ts).
			AllRoutes.pipe(
				Layer.provide(AppAuthorizationLive),
				Layer.provide(AppServicesLive),
				Layer.provideMerge(rateLimiterLive(rateLimiters)),
				Layer.provideMerge(FetchHttpClient.layer),
				Layer.provideMerge(WorkerPlatformLive),
				Layer.provideMerge(requestPlatformLive(env, botGateways)),
			) as unknown as Layer.Layer<never, never, HttpRouter.HttpRouter>,
		),
	).pipe(Effect.map(bridgeHandler))

const pathOf = (url: string): string => {
	const query = url.indexOf("?")
	return query === -1 ? url : url.slice(0, query)
}

/**
 * The fetch handler. `/health` answers before the route graph exists. Every other request runs
 * the router with its own lazily-connecting Postgres client (closed with the request scope, which
 * a streaming response carries until the stream ends), and wakes the outbox dispatcher when the
 * request wrote outbox events.
 */
export const makeFetch = (
	app: Effect.Effect<HttpEffect, unknown>,
	env: Record<string, unknown>,
	exec: Cloudflare.WorkerExecutionContext["Service"],
	outbox: Cloudflare.DurableObject<OutboxDispatcherObject>,
) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		if (request.method === "GET" && pathOf(request.url) === "/health") {
			return HttpServerResponse.text("OK")
		}

		const handler = yield* app.pipe(Effect.orDie)
		let wroteOutbox = false
		const response = yield* handler.pipe(
			provideRequestDatabase(env),
			Effect.provideService(OutboxWrites, {
				mark: () => {
					wroteOutbox = true
				},
			}),
		)
		if (wroteOutbox) {
			// After the handler returned, so the write that marked it has committed.
			yield* exec.waitUntil(outbox.getByName(OUTBOX_DISPATCHER_NAME).kick())
		}
		return response
	})
