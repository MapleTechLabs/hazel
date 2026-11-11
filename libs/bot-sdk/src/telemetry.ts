/**
 * Process tracing for a bot runtime that owns its process (`runHazelBot`, `createHazelBot`).
 * A host that already exports telemetry (a Cloudflare Worker, see `./cloudflare.ts`) skips it.
 *
 * Environment variables:
 * - OTEL_ENVIRONMENT (default: "local"): local/staging/production
 * - COMMIT_SHA (default: "unknown"): the service version
 * - OTEL_BASE_URL: OTLP endpoint (e.g. "https://ingest.maple.dev"), required outside local
 * - MAPLE_INGEST_KEY (optional): sent as `Authorization: Bearer …`
 *
 * Locally it reports to Effect DevTools (ws://localhost:34437) instead.
 */
import { Config, Effect, Layer, Option, Redacted } from "effect"
import { DevTools } from "effect/devtools"
import { FetchHttpClient } from "effect/http"
import { Otlp, OtlpSerialization } from "effect/observability"
import * as Socket from "effect/socket/Socket"

export const createTracingLayer = (serviceName: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const environment = yield* Config.String("OTEL_ENVIRONMENT").pipe(Config.withDefault("local"))
			const commitSha = yield* Config.String("COMMIT_SHA").pipe(Config.withDefault("unknown"))
			const nodeEnv = yield* Config.String("NODE_ENV").pipe(Config.withDefault("development"))

			if (environment === "local") {
				if (nodeEnv === "production") {
					return yield* Effect.die(
						"NODE_ENV is set to production, but OTEL_ENVIRONMENT is set to local",
					)
				}
				// The global `WebSocket` (Bun, Node 22+), not a runtime-specific constructor.
				return DevTools.layerWebSocket().pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
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
					serviceName,
					serviceVersion: commitSha,
					attributes: {
						"deployment.environment": environment,
						"deployment.commit_sha": commitSha,
					},
				},
			}).pipe(Layer.provide(FetchHttpClient.layer), Layer.provide(OtlpSerialization.layerJson))
		}),
	)
