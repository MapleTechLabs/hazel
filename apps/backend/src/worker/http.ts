/**
 * The api Worker's route graph, built once per isolate by the first request that needs it or in
 * the background of the preflight that announces it (`./fetch.ts`). `worker.ts` imports this
 * module dynamically: it reaches the whole HTTP app (routes, auth, integrations), which a cold
 * isolate then only evaluates when a request needs the graph, and a Durable Object never.
 */
import { bridgeHandler, forIsolate, WorkerPlatformLive } from "@hazel/infra/worker-http"
import type * as Cloudflare from "@alchemy.run/cloudflare"
import { type Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { AppAuthorizationLive, makeRoutes } from "../app"
import { AppServicesLive } from "../app-services"
import { LocalRpcDispatcher, RoutedRpcServerLive } from "../rpc/routed-server"
import { Directory } from "../services/directory"
import { workerObjectStubs } from "./objects/stubs"
import { makeSyncRoute } from "./sync-route"
import { makeLiveRoute } from "./live-route"
import { HtmlRenderRoute } from "./html-render-route"
import { AgentOAuthRoutes } from "../routes/agent-oauth"
import { McpRoute } from "../routes/mcp"
import { AgentAccess } from "../services/agent-access"
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
				Layer.mergeAll(
					makeSyncRoute(env),
					makeLiveRoute(env),
					HtmlRenderRoute,
					AgentOAuthRoutes,
					McpRoute,
				),
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
				// Agent access (OAuth for MCP clients, personal tokens) over the directory.
				Layer.provideMerge(AgentAccess.layer),
				Layer.provideMerge(Layer.suspend(() => Directory.layerD1(directoryBinding(env)))),
			) as unknown as Layer.Layer<never, never, HttpRouter.HttpRouter>,
		),
	).pipe(Effect.map(bridgeHandler))
