import { BunSocket } from "@effect/platform-bun"
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { DevTools } from "effect/devtools"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"

/**
 * Create an OpenTelemetry tracing layer with a specific service name.
 *
 * Environment variables:
 * - OTEL_ENVIRONMENT (default: "local"): Environment (local/staging/production)
 * - RAILWAY_GIT_COMMIT_SHA / COMMIT_SHA (default: "unknown"): Git commit SHA for service version
 * - OTEL_BASE_URL: OTLP endpoint (e.g. "https://ingest.maple.dev")
 * - MAPLE_INGEST_KEY (optional): sent as `Authorization: Bearer …`, for exporting straight to
 *   Maple without a collector in between
 *
 * Behavior:
 * - local environment: Uses Effect DevTools WebSocket (ws://localhost:34437)
 * - other environments: Uses OTLP HTTP to the configured collector
 *
 * @param otelServiceName - The service name to use for telemetry
 * @returns A Layer that provides tracing, metrics, and logging
 *
 * @example
 * ```typescript
 * import { createTracingLayer } from "@hazel/effect-bun/Telemetry"
 *
 * const TracerLive = createTracingLayer("hazel-backend")
 *
 * Layer.launch(ServerLayer.pipe(Layer.provide(TracerLive)))
 * ```
 */
export const createTracingLayer = (otelServiceName: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const environment = yield* Config.String("OTEL_ENVIRONMENT").pipe(Config.withDefault("local"))
			const commitSha = yield* Config.String("RAILWAY_GIT_COMMIT_SHA").pipe(
				Config.orElse(() => Config.String("COMMIT_SHA")),
				Config.withDefault("unknown"),
			)

			const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))

			if (environment === "local") {
				if (nodeEnv === "production") {
					return yield* Effect.die(
						"NODE_ENV is set to production, but OTEL_ENVIRONMENT is set to local",
					)
				}

				return DevTools.layerWebSocket().pipe(Layer.provide(BunSocket.layerWebSocketConstructor))
			}

			const otelBaseUrl = yield* Config.String("OTEL_BASE_URL")
			const ingestKey = yield* Config.option(Config.Redacted("MAPLE_INGEST_KEY"))

			return Otlp.layer({
				baseUrl: otelBaseUrl,
				headers: Option.match(ingestKey, {
					onNone: () => undefined,
					onSome: (key) => ({ authorization: `Bearer ${Redacted.value(key)}` }),
				}),
				resource: {
					serviceName: otelServiceName,
					serviceVersion: commitSha,
					attributes: {
						"deployment.environment": environment,
						"deployment.commit_sha": commitSha,
					},
				},
			}).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(OtlpSerialization.layerJson))
		}),
	)
