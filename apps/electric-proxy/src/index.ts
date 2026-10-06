/**
 * The Bun entry: a long-running server with a Postgres pool and Redis-backed caches. Kept for
 * local `bun run dev`, the e2e suite and the legacy Railway deployment until the DNS cutover to
 * the Cloudflare Worker (`worker.ts`), which serves the same {@link handleRequest}.
 */
import { BunRuntime } from "@effect/platform-bun"
import { ProxyAuth } from "@hazel/auth/proxy"
import { Database } from "@hazel/db"
import { ConfigProvider, Effect, Layer, Logger, Redacted } from "effect"
import { type AccessContextCacheService, AccessContextCacheService as AccessContextCache } from "./cache"
import { RedisPersistenceLive } from "./cache/redis-persistence"
import { ProxyConfigService } from "./config"
import { handleRequest } from "./handler"
import { TracerLive } from "./observability/tracer"
import { ElectricUpstream } from "./proxy/electric-upstream"

// =============================================================================
// LAYERS
// =============================================================================

const DatabaseLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService
		yield* Effect.log("Connecting to database", { isDev: config.isDev })
		return Database.layer({
			url: config.databaseUrl,
			ssl: !config.isDev,
		})
	}),
)

const LoggerLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService
		return config.isDev
			? Logger.layer([Logger.consolePretty()])
			: Logger.layer([Logger.withConsoleLog(Logger.formatStructured)])
	}),
).pipe(Layer.provide(ProxyConfigService.layer))

/** `ELECTRIC_URL`, authenticated with `ELECTRIC_SECRET` (self-hosted) or a source id + secret (Electric Cloud). */
const ElectricUpstreamLive = Layer.unwrap(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService
		const authParams: Record<string, string> = {}
		// Self-hosted (`ELECTRIC_SECRET`) wins; the Cloud pair applies only without it.
		if (config.electricSecret !== undefined) {
			authParams.secret = Redacted.value(config.electricSecret)
		} else if (config.electricSourceId !== undefined && config.electricSourceSecret !== undefined) {
			authParams.source_id = config.electricSourceId
			authParams.secret = config.electricSourceSecret
		}
		return ElectricUpstream.layerUrl({ baseUrl: config.electricUrl, authParams })
	}),
).pipe(Layer.provide(ProxyConfigService.layer))

// Cache layer: AccessContextCache requires ResultPersistence and Database
const CacheLive = AccessContextCache.layer.pipe(
	Layer.provide(RedisPersistenceLive),
	Layer.provide(DatabaseLive),
	Layer.provide(ProxyConfigService.layer),
)

// ProxyAuth layer requires ResultPersistence for session caching and Database for user lookup
// ProxyAuth.layer includes SessionValidator.layer via dependencies
const ProxyAuthLive = ProxyAuth.layer.pipe(
	Layer.provide(RedisPersistenceLive),
	Layer.provide(DatabaseLive),
	Layer.provide(ProxyConfigService.layer),
)

const MainLive = DatabaseLive.pipe(
	Layer.provideMerge(ProxyConfigService.layer),
	Layer.provideMerge(LoggerLive),
	Layer.provideMerge(ElectricUpstreamLive),
	Layer.provideMerge(CacheLive),
	Layer.provideMerge(TracerLive),
	Layer.provideMerge(ProxyAuthLive),
)

// =============================================================================
// SERVER
// =============================================================================

const ServerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* ProxyConfigService

		yield* Effect.log("Starting Electric Proxy (Bun)", {
			port: config.port,
			electricUrl: config.electricUrl,
			allowedOrigin: config.allowedOrigin,
		})
		if (
			!config.isDev &&
			!config.electricSecret &&
			(!config.electricSourceId || !config.electricSourceSecret)
		) {
			yield* Effect.logWarning("Electric credentials missing; upstream requests may fail", {
				hasElectricSecret: !!config.electricSecret,
				hasSourceId: !!config.electricSourceId,
				hasSourceSecret: !!config.electricSourceSecret,
			})
		}

		const serviceMap = yield* Effect.context<
			ProxyConfigService | Database.Database | AccessContextCacheService | ProxyAuth | ElectricUpstream
		>()
		const run = Effect.runPromiseWith(serviceMap)

		yield* Effect.acquireRelease(
			Effect.sync(() =>
				Bun.serve({
					port: config.port,
					hostname: "::",
					idleTimeout: 120,
					routes: {
						"/health": new Response("OK"), // Static response - zero allocation
					},
					fetch(req) {
						return run(handleRequest(req))
					},
				}),
			),
			(server) =>
				Effect.gen(function* () {
					yield* Effect.log("Shutting down server...")
					server.stop(true)
				}),
		)

		yield* Effect.log(`Server listening on port ${config.port}`)
	}),
)

Layer.launch(
	ServerLive.pipe(
		Layer.provide(MainLive),
		Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ preserveEmptyStrings: true }))),
	),
).pipe(BunRuntime.runMain)
