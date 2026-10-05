/**
 * Bun entry point (Railway). Kept runnable during the Cloudflare cutover; the Worker entry is
 * `worker.ts`. See infra/cloudflare-migration-plan.md.
 */
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Redis, RedisResultPersistenceLive } from "@hazel/effect-bun"
import { createTracingLayer } from "@hazel/effect-bun/Telemetry"
import { Config, ConfigProvider, Layer } from "effect"
import { HttpMiddleware, HttpRouter } from "effect/http"
import { AllRoutes, AppAuthorizationLive, AppServicesLive, HazelApi } from "./app"
import { DiscordGatewayService } from "./services/chat-sync/discord-gateway-service"
import { DatabaseLive } from "./services/database"
import { MessageOutboxDispatcher } from "./services/message-outbox-dispatcher"
import { RateLimiter } from "./services/rate-limiter"

export { HazelApi }

// Export RPC groups for frontend consumption
export { AuthMiddleware, MessageRpcs, NotificationRpcs } from "@hazel/domain/rpc"

const TracerLive = createTracingLayer("api")

// ResultPersistence layer for session caching (uses Redis backing)
const PersistenceLive = RedisResultPersistenceLive.pipe(Layer.provide(Redis.Default))

/** Bun's platform services: a pooled database and Redis-backed caches and rate limits. */
const PlatformLive = Layer.mergeAll(DatabaseLive, PersistenceLive, Redis.Default, RateLimiter.layer)

/** Long-running loops; on Cloudflare these are Durable Objects driven by crons. */
const BackgroundLive = Layer.mergeAll(DiscordGatewayService.layer, MessageOutboxDispatcher.layer)

const MainLive = Layer.mergeAll(AppServicesLive, BackgroundLive).pipe(
	Layer.provideMerge(PlatformLive),
	Layer.provideMerge(ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))),
)

const ServerLayer = HttpRouter.serve(AllRoutes).pipe(
	Layer.provide(
		Layer.succeed(
			HttpMiddleware.TracerDisabledWhen,
			(request) => request.url === "/health" || request.method === "OPTIONS",
		),
	),
	Layer.provide(AppAuthorizationLive),
	Layer.provide(MainLive),
	Layer.provide(TracerLive),
	Layer.provide(
		BunHttpServer.layerConfig(
			Config.all({
				port: Config.Number("PORT").pipe(Config.withDefault(3003)),
				idleTimeout: Config.succeed(120),
			}),
		),
	),
)

// The `as never` cast is required because ChatSyncCoreWorkerMake (in chat-sync-core-worker.ts)
// is explicitly typed as Effect<..., unknown, unknown> to break a circular type dependency.
// Those `unknown` types propagate through DiscordSyncWorkerLayer -> ServiceLive -> MainLive -> ServerLayer,
// causing TypeScript to collapse the layer's type parameters to `unknown`.
// All actual dependencies are wired correctly at runtime.
ServerLayer.pipe(Layer.launch as never, BunRuntime.runMain)
