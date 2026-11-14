/**
 * The api Worker's request path: the route graph built once per isolate, by the first request
 * that needs it or in the background of the preflight that announces it, and the fetch handler
 * that runs it.
 */
import { bridgeHandler, forIsolate, WorkerPlatformLive } from "@hazel/infra/worker-http"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import * as Cloudflare from "@alchemy.run/cloudflare"
import type { HttpEffect } from "alchemy/Http"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { type Context, Effect, Layer } from "effect"
import {
	FetchHttpClient,
	HttpMiddleware,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "effect/http"
import { AppAuthorizationLive, AppServicesLive, makeRoutes } from "../app"
import { corsPolicy } from "../lib/cors"
import { LocalRpcDispatcher, RoutedRpcServerLive } from "../rpc/routed-server"
import { Directory } from "../services/directory"
import { takeIsolateCold } from "./cold-start"
import { workerObjectStubs } from "./objects/stubs"
import { makeSyncRoute } from "./sync-route"
import { makeLiveRoute } from "./live-route"
import { HtmlRenderRoute } from "./html-render-route"
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
	messageRateLimit: Cloudflare.RateLimitClient,
	botGateways: BotGatewayNamespace,
) =>
	forIsolate(isolate)(
		HttpRouter.toHttpEffect(
			// The cast restores the layer's type: the circular `DiscordSyncWorker` typing collapses
			// `AppServicesLive`'s error and requirement channels to `unknown`.
			makeRoutes(
				workerRpcServer(env),
				Layer.mergeAll(makeSyncRoute(env), makeLiveRoute(env), HtmlRenderRoute),
			).pipe(
				Layer.provide(AppAuthorizationLive),
				Layer.provide(AppServicesLive),
				Layer.provideMerge(rateLimiterLive(rateLimiters, messageRateLimit)),
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

/**
 * A CORS preflight's answer, from the policy the router applies (`lib/cors.ts`): the same
 * middleware, over the Worker's env instead of the graph's `ConfigProvider`.
 */
const makePreflight = (env: Record<string, unknown>) => {
	let cors: ReturnType<typeof HttpMiddleware.cors> | undefined
	return Effect.gen(function* () {
		cors ??= HttpMiddleware.cors(
			yield* corsPolicy.pipe(Effect.provide(workerEnvLayer(env)), Effect.orDie),
		)
		// The middleware answers every `OPTIONS` itself and never runs what it wraps.
		return yield* cors(Effect.succeed(HttpServerResponse.empty({ status: 204 })))
	})
}

/**
 * The fetch handler. `/health` and CORS preflights answer before the route graph exists; the
 * rest runs the router.
 *
 * A preflight on a cold isolate starts the graph in the background (`waitUntil`), so the request
 * it announces finds it built or being built. This takes the graph's build off the preflight,
 * not the isolate's own start (the script's evaluation), which every first request still pays.
 */
export const makeFetch = (app: Effect.Effect<HttpEffect, unknown>, env: Record<string, unknown>) => {
	const preflight = makePreflight(env)
	// One macrotask later: the build starts with a stretch of CPU, which would otherwise run
	// before the preflight's answer leaves.
	const afterAnswer = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
	let built = false
	const ready = app.pipe(
		Effect.orDie,
		Effect.tap(() =>
			Effect.sync(() => {
				built = true
			}),
		),
	)
	return Effect.gen(function* () {
		const request = yield* HttpServerRequest.HttpServerRequest
		yield* Effect.annotateCurrentSpan("isolate.cold", takeIsolateCold())
		if (request.method === "GET" && pathOf(request.url) === "/health") {
			return HttpServerResponse.text("OK")
		}
		if (request.method === "OPTIONS" && request.headers["access-control-request-method"] !== undefined) {
			// A failed build is retried by the request that needs it (`cachedRecoverable`).
			if (!built) {
				yield* Cloudflare.waitUntil(Effect.exit(Effect.andThen(afterAnswer, ready))).pipe(
					Effect.provide(RuntimeContext.phantom),
				)
			}
			return yield* preflight
		}
		// The wait for the graph, as a span of its own: its build runs under the isolate's
		// context, so nothing inside it is traced.
		const handler = built ? yield* ready : yield* ready.pipe(Effect.withSpan("Api.buildRoutes"))
		return yield* handler
	})
}
