/**
 * The api Worker (alchemy two-step form): the backend's HTTP API and RPC, plus the Durable
 * Objects that replace the Bun process's background loops and Redis. The Bun entry is `index.ts`.
 * Plan: infra/cloudflare-migration-plan.md, Phase 4.
 */
import { bindBotGateways } from "@hazel/bot-gateway/object"
import { HazelStack, hazelWorkerProps, stageProps } from "@hazel/infra/cloudflare"
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import { hazelTelemetry } from "@hazel/infra/maple"
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
import { ChannelObject, ChannelObjectLive } from "./worker/objects/channel-object"
import { OrgObject, OrgObjectLive } from "./worker/objects/org-object"
import { UserObject, UserObjectLive } from "./worker/objects/user-object"
import { CACHE_BINDING, DIRECTORY_DB_BINDING, EMAIL_BINDING } from "./worker/platform"
import { RateLimiterObject, RateLimiterObjectLive } from "./worker/rate-limiter-object"

/** Session and user-lookup caches (Redis on Bun). */
export const ApiCache = Cloudflare.KV.Namespace(
	"api-cache",
	stageProps("api-cache", (title) => ({ title })),
)

/**
 * The directory (`infra/durable-object-sync-plan.md` §1): users, auth, bots, invitations and the
 * routing indexes. Migrations: `packages/db/migrations/directory` (rendered from `stores.ts`).
 */
export const DirectoryDb = Cloudflare.D1.Database(
	"directory",
	stageProps("directory", (name) => ({
		name,
		migrations: new URL("../../../packages/db/migrations/directory", import.meta.url).pathname,
	})),
)

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	const cache = yield* ApiCache
	const directory = yield* DirectoryDb
	const email = yield* Cloudflare.Email.SendEmail(EMAIL_BINDING)
	return {
		main: import.meta.url,
		...hazelWorkerProps("api", stack),
		workersDev: stack.stage.kind !== "prd",
		domain: stack.domains.api,
		observability: {
			enabled: true,
			logs: { enabled: true, invocationLogs: true, destinations: ["maple-logs"] },
			// Traces reach Maple through the SDK (`hazelTelemetry`), not the Cloudflare destination.
			traces: { enabled: true },
		},
		env: {
			[DIRECTORY_DB_BINDING]: directory,
			[CACHE_BINDING]: cache,
			[EMAIL_BINDING]: email,
			...(yield* apiEnv(stack)),
		},
	}
})

export class Api extends Cloudflare.Worker<
	Api,
	Cloudflare.WorkerShape,
	RateLimiterObject | OutboxDispatcherObject | DiscordGatewayObject | OrgObject | ChannelObject | UserObject
>()("api") {}

export default Api.make(
	props,
	Effect.gen(function* () {
		// Yielding a hosted class binds, registers and exports it.
		const rateLimiters = yield* RateLimiterObject
		const outbox = yield* OutboxDispatcherObject
		const discordGateway = yield* DiscordGatewayObject
		// The sync objects (`worker/objects/`): bound here, reached through the env (`stubs.ts`).
		yield* OrgObject
		yield* ChannelObject
		yield* UserObject
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
				OrgObjectLive,
				ChannelObjectLive,
				UserObjectLive,
				Cloudflare.Workers.CronEventSourceLive,
				hazelTelemetry("api"),
			),
		),
	),
)
