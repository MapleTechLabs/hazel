import { Context, Config, Effect, Layer, Option, Redacted } from "effect"

/**
 * Configuration of the Bun entry (`index.ts`). The Cloudflare Worker reads its env in `worker.ts`.
 */
export interface ProxyConfig {
	readonly electricUrl: string
	/** Self-hosted Electric's `ELECTRIC_SECRET`, sent as the `secret` query param. */
	readonly electricSecret: Redacted.Redacted<string> | undefined
	/** Electric Cloud (legacy Railway deployment only; the Worker talks to self-hosted Electric). */
	readonly electricSourceId: string | undefined
	readonly electricSourceSecret: string | undefined
	readonly allowedOrigin: string
	readonly databaseUrl: Redacted.Redacted<string>
	readonly isDev: boolean
	readonly port: number
	readonly otlpEndpoint: string | undefined
	readonly redisUrl: Redacted.Redacted<string>
}

/**
 * Bun entry configuration service.
 * Reads configuration from environment variables.
 */
export class ProxyConfigService extends Context.Service<ProxyConfigService>()("ProxyConfigService", {
	make: Effect.gen(function* () {
		const electricUrl = yield* Config.String("ELECTRIC_URL")
		const electricSecret = yield* Config.Redacted("ELECTRIC_SECRET").pipe(
			Config.option,
			Config.map(Option.getOrUndefined),
		)
		const electricSourceId = yield* Config.String("ELECTRIC_SOURCE_ID").pipe(
			Config.option,
			Config.map(Option.getOrUndefined),
		)
		const electricSourceSecret = yield* Config.String("ELECTRIC_SOURCE_SECRET").pipe(
			Config.option,
			Config.map(Option.getOrUndefined),
		)
		const allowedOrigin = yield* Config.String("ALLOWED_ORIGIN").pipe(
			Config.withDefault("http://localhost:3000"),
		)
		const databaseUrl = yield* Config.Redacted("DATABASE_URL")
		const isDev = yield* Config.Boolean("IS_DEV").pipe(Config.withDefault(false))
		const port = yield* Config.Number("PORT").pipe(Config.withDefault(8184))
		const otlpEndpoint = yield* Config.String("OTLP_ENDPOINT").pipe(
			Config.option,
			Config.map(Option.getOrUndefined),
		)
		const redisUrl = yield* Config.Redacted("REDIS_URL").pipe(
			Config.withDefault(Redacted.make("redis://localhost:6380")),
		)

		return {
			electricUrl,
			electricSecret,
			electricSourceId,
			electricSourceSecret,
			allowedOrigin,
			databaseUrl,
			isDev,
			port,
			otlpEndpoint,
			redisUrl,
		} satisfies ProxyConfig
	}),
}) {
	static readonly layer = Layer.effect(this, this.make)
}
