/**
 * The api Worker's request path: the route graph built once per isolate on the first request,
 * and the fetch handler that runs it.
 */
import { bridgeHandler, forIsolate, WorkerPlatformLive } from "@hazel/infra/worker-http"
import type * as Cloudflare from "alchemy/Cloudflare"
import type { HttpEffect } from "alchemy/Http"
import { type Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { AppAuthorizationLive, AppServicesLive, makeRoutes } from "../app"
import { LocalRpcDispatcher, RoutedRpcServerLive } from "../rpc/routed-server"
import { Directory } from "../services/directory"
import { workerObjectStubs } from "./objects/stubs"
import { makeImportRoute } from "./import-route"
import { makeSyncRoute } from "./sync-route"
import { makeLiveRoute } from "./live-route"
import { workerLiveObjectStubs } from "./live/message-live-object"
import type { BotGatewayNamespace } from "../services/bot-gateway-transport"
import { directoryBinding, requestPlatformLive } from "./platform"
import { type RateLimiterObject, rateLimiterLive } from "./rate-limiter-object"

/**
 * HazelRpc on the Worker: routed to the objects, or run here over D1 for `directory` methods
 * (`rpc/routing.ts`).
 */
const workerRpcServer = (env: Record<string, unknown>) =>
	RoutedRpcServerLive.pipe(
		Layer.provide(LocalRpcDispatcher.layer),
		Layer.provide(workerObjectStubs(env)),
		Layer.provide(Layer.suspend(() => Directory.layerD1(directoryBinding(env)))),
	)

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
			// `AppServicesLive`'s error and requirement channels to `unknown`.
			makeRoutes(
				workerRpcServer(env),
				Layer.mergeAll(makeSyncRoute(env), makeLiveRoute(env), makeImportRoute(env)),
			).pipe(
				Layer.provide(AppAuthorizationLive),
				Layer.provide(AppServicesLive),
				Layer.provideMerge(rateLimiterLive(rateLimiters)),
				Layer.provideMerge(FetchHttpClient.layer),
				Layer.provideMerge(WorkerPlatformLive),
				Layer.provideMerge(requestPlatformLive(env, botGateways)),
				// HTTP routes that reach objects or the directory (presence, bot commands).
				Layer.provideMerge(workerObjectStubs(env)),
				Layer.provideMerge(workerLiveObjectStubs(env)),
				Layer.provideMerge(Layer.suspend(() => Directory.layerD1(directoryBinding(env)))),
			) as unknown as Layer.Layer<never, never, HttpRouter.HttpRouter>,
		),
	).pipe(Effect.map(bridgeHandler))

const pathOf = (url: string): string => {
	const query = url.indexOf("?")
	return query === -1 ? url : url.slice(0, query)
}

/** The fetch handler. `/health` answers before the route graph exists; the rest runs the router. */
export const makeFetch = (app: Effect.Effect<HttpEffect, unknown>) =>
	Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		if (request.method === "GET" && pathOf(request.url) === "/health") {
			return HttpServerResponse.text("OK")
		}
		const handler = yield* app.pipe(Effect.orDie)
		return yield* handler
	})
