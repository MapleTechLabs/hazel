/**
 * Bun entry point (Railway). Kept runnable during the Cloudflare cutover; the Worker entry is
 * `worker.ts`. See infra/cloudflare-migration-plan.md.
 */
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Redis, RedisResultPersistenceLive } from "@hazel/effect-bun"
import { createTracingLayer } from "@hazel/effect-bun/Telemetry"
import { Config, ConfigProvider, Effect, Layer } from "effect"
import { HttpMiddleware, HttpRouter } from "effect/http"
import { AllRoutes, AppAuthorizationLive, AppServicesLive, HazelApi } from "./app"
import { InviteMailer } from "./services/invite-mailer"
import { BotGatewayTransport } from "./services/bot-gateway-transport"
import { EnvVars } from "./lib/env-vars"
import { DatabaseLive } from "./services/database"
import { RateLimiterRedisLive } from "./services/rate-limiter-redis"

export { HazelApi }

// Export RPC groups for frontend consumption
export { AuthMiddleware, MessageRpcs, NotificationRpcs } from "@hazel/domain/rpc"

const TracerLive = createTracingLayer("api")

// ResultPersistence layer for session caching (uses Redis backing)
const PersistenceLive = RedisResultPersistenceLive.pipe(Layer.provide(Redis.Default))

/**
 * Bun's platform services: a SQLite file (whose `SqlClient` auth storage uses), Redis-backed caches and rate limits, and bot gateway
 * events appended to the Durable Streams server the Bun bot gateway reads.
 */
const PlatformLive = Layer.mergeAll(
	DatabaseLive,
	PersistenceLive,
	Redis.Default,
	RateLimiterRedisLive,
	BotGatewayTransport.layerDurableStreams,
	// No email service on Bun: invite links are logged.
	InviteMailer.layerLog,
)

// The Discord gateway runs only on Cloudflare (`worker/discord-gateway-object.ts`): it routes into
// the sync objects, which Bun does not host.
const MainLive = AppServicesLive.pipe(
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

// The `as never` cast keeps the launch untyped: the layer's requirements are wired at runtime.
ServerLayer.pipe(Layer.launch as never, BunRuntime.runMain)
