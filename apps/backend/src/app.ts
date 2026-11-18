/**
 * The backend's runtime-agnostic HTTP application: the routes and Hazel's sign-in, over the
 * services every runtime shares (`./app-services.ts`). The api Worker (`worker.ts`) and the
 * objects provide the platform layer: `Database`, `Persistence`, `RateLimiter`,
 * `BotGatewayTransport`, the tracer and the ConfigProvider.
 */
import { HttpApiScalar } from "effect/http-api"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization } from "effect/rpc"
import { Effect, Layer } from "effect"
import { HazelApi } from "./api"
import { HttpApiRoutes } from "./http"
import { corsPolicy } from "./lib/cors"
import { ServerFailureReporterLive } from "./lib/error-reporter"
import { layerRpcHttpPerRequest } from "./rpc/per-request"
import { AuthMiddlewareLive } from "./rpc/middleware/auth"
import { ScopeInjectionMiddlewareLive } from "./rpc/middleware/scope-injection"
import { RpcHandlersLive } from "./rpc/server"
import { AuthorizationLive } from "./services/auth"
import { HazelAuthInstance, HazelAuthRoutes, HazelAuthServicesLive } from "./services/hazel-auth"
import { CustomersWebhookRoutes } from "./routes/customers-webhooks.http"
import { DevSignInRoutes } from "./routes/dev-sign-in.http"
import { HazelSession } from "./services/hazel-session"

export { HazelApi }

export const HealthRouter = HttpRouter.use((router) =>
	router.add("GET", "/health", HttpServerResponse.text("OK")),
)

/** The handlers behind the api's own middleware: the type the RPC endpoint serves (`makeRoutes`). */
export const RpcServerLive = RpcHandlersLive.pipe(
	Layer.provideMerge(AuthMiddlewareLive),
	Layer.provideMerge(ScopeInjectionMiddlewareLive),
)

const DocsRoute = HttpApiScalar.layer(HazelApi, {
	path: "/docs",
})

/**
 * The routes, with the RPC endpoint served by `rpcServer` (the api Worker's router into the
 * objects, `RoutedRpcServerLive`; typed by the in-process `RpcServerLive`). `extra` routes join
 * the same CORS and failure reporting (the Worker's `/sync` upgrade).
 */
export const makeRoutes = <E, R, EX = never, RX = never>(
	rpcServer: Layer.Layer<Layer.Success<typeof RpcServerLive>, E, R>,
	extra: Layer.Layer<never, EX, RX> = Layer.empty as Layer.Layer<never, EX, RX>,
) =>
	Layer.mergeAll(
		HttpApiRoutes,
		HealthRouter,
		DocsRoute,
		// A server per request, never one shared across requests (`./rpc/per-request.ts`).
		layerRpcHttpPerRequest("/rpc").pipe(
			Layer.provide(RpcSerialization.layerNdjson),
			Layer.provide(rpcServer),
		),
		HazelAuthRoutes,
		DevSignInRoutes,
		CustomersWebhookRoutes,
		extra,
	).pipe(
		Layer.provide(Layer.unwrap(Effect.map(corsPolicy, HttpRouter.cors))),
		// RpcServer and HttpApiBuilder report failed requests here; server failures get logged.
		Layer.provide(ServerFailureReporterLive),
	)

/**
 * Hazel's own sign-in: the configured instance, its auth services, and the session lookup
 * the RPC and HttpApi middleware use. Inert until `AUTH_GITHUB_CLIENT_ID` is set. Needs the
 * directory's `SqlClient` from the entry point.
 */
export const HazelAuthLive = HazelSession.layer.pipe(
	Layer.provideMerge(HazelAuthServicesLive),
	Layer.provideMerge(HazelAuthInstance.layer),
)

/**
 * `CurrentUser` resolution for authenticated routes, and Hazel's sign-in services. Only the
 * HTTP entry points build this; the Durable Objects never authenticate. Requires `Database`
 * and the auth SQL connection from the platform.
 */
export const AppAuthorizationLive = AuthorizationLive.pipe(Layer.provideMerge(HazelAuthLive))
