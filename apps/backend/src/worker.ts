/**
 * The api Worker (alchemy two-step form): the backend's HTTP API and RPC, plus the Durable
 * Objects that replace the Bun process's background loops and Redis. The Bun entry is `index.ts`.
 * Plan: infra/cloudflare-migration-plan.md, Phase 4.
 */
import { bindBotGateways } from "@hazel/bot-gateway/object"
import { HazelStack, hazelWorkerProps, stageProps } from "@hazel/infra/cloudflare"
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import { isolateContext } from "@hazel/infra/worker-http"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect, Layer } from "effect"
import {
	DISCORD_GATEWAY_NAME,
	DiscordGatewayObject,
	DiscordGatewayObjectLive,
} from "./worker/discord-gateway-object"
import { apiEnv } from "./worker/env"
import { buildApp, makeFetch } from "./worker/http"
import {
	OUTBOX_DISPATCHER_NAME,
	OutboxDispatcherObject,
	OutboxDispatcherObjectLive,
} from "./worker/outbox-dispatcher-object"
import { CACHE_BINDING } from "./worker/platform"
import { RateLimiterObject, RateLimiterObjectLive } from "./worker/rate-limiter-object"

/** Session and user-lookup caches (Redis on Bun). */
export const ApiCache = Cloudflare.KV.Namespace(
	"api-cache",
	stageProps("api-cache", (title) => ({ title })),
)

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	const cache = yield* ApiCache
	return {
		main: import.meta.url,
		...hazelWorkerProps("api", stack),
		workersDev: stack.stage.kind !== "prd",
		domain: stack.domains.api,
		observability: {
			enabled: true,
			logs: { enabled: true, invocationLogs: true, destinations: ["maple-logs"] },
			traces: { enabled: true, destinations: ["maple-traces"] },
		},
		env: {
			HAZEL_DB: stack.db.hyperdrive,
			[CACHE_BINDING]: cache,
			...(yield* apiEnv(stack)),
		},
	}
})

export class Api extends Cloudflare.Worker<
	Api,
	Cloudflare.WorkerShape,
	RateLimiterObject | OutboxDispatcherObject | DiscordGatewayObject
>()("api") {}

export default Api.make(
	props,
	Effect.gen(function* () {
		// Yielding a hosted class binds, registers and exports it.
		const rateLimiters = yield* RateLimiterObject
		const outbox = yield* OutboxDispatcherObject
		const discordGateway = yield* DiscordGatewayObject
		// Hosted by the bot-gateway Worker; BotGatewayService publishes bot events into it.
		const botGateways = yield* bindBotGateways
		const env = yield* Cloudflare.WorkerEnvironment
		const exec = yield* Cloudflare.WorkerExecutionContext

		// The graph builds on the first request, not here: init also runs at plan time, where
		// alchemy would auto-bind every `Config` read.
		const isolate = isolateContext(yield* Effect.context())
		const app = yield* cachedRecoverable(buildApp(isolate, env, rateLimiters, botGateways))

		// Backstops for the Durable Objects: drain anything a missed kick left behind, and keep
		// the Discord gateway session up across deploys and evictions.
		yield* Cloudflare.Workers.cron("* * * * *", () =>
			Effect.all(
				[
					outbox.getByName(OUTBOX_DISPATCHER_NAME).kick(),
					discordGateway.getByName(DISCORD_GATEWAY_NAME).ensureRunning(),
				],
				{ concurrency: "unbounded", discard: true },
			),
		)

		return { fetch: makeFetch(app, env, exec, outbox) }
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				RateLimiterObjectLive,
				OutboxDispatcherObjectLive,
				DiscordGatewayObjectLive,
				Cloudflare.Workers.CronEventSourceLive,
			),
		),
	),
)
