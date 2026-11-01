/**
 * Bot Health Server
 *
 * Lightweight HTTP health endpoint for bot process monitoring.
 * Reports process liveness and uptime for the websocket-based bot runtime.
 *
 * Enabled by default on port 9090. Set `healthPort: false` in config to disable. Needs Bun: on
 * another runtime it is skipped (a Cloudflare host answers health on its Worker instead).
 */

import { Effect, Layer, Context } from "effect"

export interface BotHealthServerConfig {
	readonly port: number
}

export class BotHealthServerConfigTag extends Context.Service<
	BotHealthServerConfigTag,
	BotHealthServerConfig
>()("@hazel/bot-sdk/BotHealthServerConfig") {}

/** The slice of Bun's API this uses, typed here so the SDK typechecks without Bun's types. */
interface BunServer {
	readonly port: number
	stop(closeActiveConnections?: boolean): void
}
interface BunLike {
	serve(options: { port: number; fetch(req: Request): Response | Promise<Response> }): BunServer
}

interface HealthResponse {
	readonly status: "healthy"
	readonly timestamp: string
	readonly uptime_ms: number
}

export class BotHealthServer extends Context.Service<BotHealthServer>()("BotHealthServer", {
	make: Effect.gen(function* () {
		const config = yield* BotHealthServerConfigTag
		const startTime = Date.now()
		const services = yield* Effect.context<never>()

		const collectHealth = Effect.sync((): HealthResponse => ({
			status: "healthy",
			timestamp: new Date().toISOString(),
			uptime_ms: Date.now() - startTime,
		}))

		const bun = (globalThis as { readonly Bun?: BunLike }).Bun
		if (bun === undefined) {
			yield* Effect.logDebug("Health server skipped: not running on Bun").pipe(
				Effect.annotateLogs("service", "BotHealthServer"),
			)
			return { port: undefined }
		}

		const server = yield* Effect.acquireRelease(
			Effect.sync(() =>
				bun.serve({
					port: config.port,
					fetch(req) {
						const url = new URL(req.url)
						if (req.method === "GET" && url.pathname === "/health") {
							return Effect.runPromiseWith(services)(collectHealth).then(
								(health: HealthResponse) =>
									new Response(JSON.stringify(health), {
										status: 200,
										headers: { "Content-Type": "application/json" },
									}),
							)
						}

						return new Response("Not Found", { status: 404 })
					},
				}),
			),
			(server: BunServer) =>
				Effect.gen(function* () {
					yield* Effect.logDebug("Stopping health server", { port: config.port }).pipe(
						Effect.annotateLogs("service", "BotHealthServer"),
					)
					yield* Effect.sync(() => server.stop(true))
				}),
		)

		yield* Effect.logDebug("Health server listening", { port: server.port, path: "/health" }).pipe(
			Effect.annotateLogs("service", "BotHealthServer"),
		)

		return { port: server.port as number | undefined }
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}

export const BotHealthServerLive = (port: number) =>
	Layer.provide(BotHealthServer.layer, Layer.succeed(BotHealthServerConfigTag, { port }))
