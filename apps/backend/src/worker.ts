/**
 * The api Worker (alchemy two-step form): the backend's HTTP API and RPC, and the Durable Objects
 * that hold the data (`worker/objects/`, infra/durable-object-sync-plan.md). Removed classes
 * (`OutboxDispatcher`) need no code: alchemy emits their `deleted_classes` migration from the
 * class tags of the previous deploy.
 */
import { bindBotGateways } from "@hazel/bot-gateway/object"
import { HazelStack, hazelWorkerProps, stageProps } from "@hazel/infra/cloudflare"
import { cachedRecoverable } from "@hazel/infra/cached-recoverable"
import { hazelTelemetry } from "@hazel/infra/maple"
import { isolateContext } from "@hazel/infra/worker-http"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect, Layer } from "effect"
import {
	DISCORD_GATEWAY_NAME,
	DiscordGatewayObject,
	DiscordGatewayObjectLive,
} from "./worker/discord-gateway-object"
import { HTML_RENDER_PENDING_MAX_AGE_SECONDS, HTML_RENDER_PENDING_PREFIX } from "./services/html-renders"
import { apiEnv } from "./worker/env"
import { buildApp, makeFetch } from "./worker/http"
import { MessageLiveObject, MessageLiveObjectLive } from "./worker/live/message-live-object"
import { ChannelObject, ChannelObjectLive } from "./worker/objects/channel-object"
import { OrgObject, OrgObjectLive } from "./worker/objects/org-object"
import { UserObject, UserObjectLive } from "./worker/objects/user-object"
import { CACHE_BINDING, DIRECTORY_DB_BINDING, EMAIL_BINDING, HTML_RENDERS_BINDING } from "./worker/platform"
import { RateLimiterObject, RateLimiterObjectLive } from "./worker/rate-limiter-object"

/** Session and user-lookup caches. */
export const ApiCache = Cloudflare.KV.Namespace(
	"api-cache",
	stageProps("api-cache", (title) => ({ title })),
)

/**
 * HTML render pages (`services/html-renders.ts`). Private, with no public domain: a page is only
 * served by the api's signed `GET /html-renders/...`, with the sandbox CSP.
 */
export const HtmlRendersBucket = Cloudflare.R2.Bucket(
	"html-renders",
	stageProps("html-renders", (name) => ({
		name,
		// Pages no message claimed (`services/html-renders.ts`).
		lifecycleRules: [
			{
				id: "expire-unclaimed-pages",
				prefix: HTML_RENDER_PENDING_PREFIX,
				deleteObjectsTransition: {
					condition: { type: "Age" as const, maxAge: HTML_RENDER_PENDING_MAX_AGE_SECONDS },
				},
			},
		],
	})),
)

/** `__ALCHEMY_RUNTIME__` folds to `true` in the bundle, so the stack-side branch is tree-shaken. */
const props = Effect.gen(function* () {
	if (globalThis.__ALCHEMY_RUNTIME__) return { main: import.meta.url }
	const stack = yield* HazelStack
	const cache = yield* ApiCache
	const htmlRenders = yield* HtmlRendersBucket
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
			[DIRECTORY_DB_BINDING]: stack.directoryDb,
			[CACHE_BINDING]: cache,
			[HTML_RENDERS_BINDING]: htmlRenders,
			[EMAIL_BINDING]: email,
			...(yield* apiEnv(stack)),
		},
	}
})

export class Api extends Cloudflare.Worker<
	Api,
	Cloudflare.WorkerShape,
	RateLimiterObject | DiscordGatewayObject | OrgObject | ChannelObject | UserObject | MessageLiveObject
>()("api") {}

export default Api.make(
	props,
	Effect.gen(function* () {
		// Yielding a hosted class binds, registers and exports it.
		const rateLimiters = yield* RateLimiterObject
		const discordGateway = yield* DiscordGatewayObject
		// The sync objects (`worker/objects/`): bound here, reached through the env (`stubs.ts`).
		yield* OrgObject
		yield* ChannelObject
		yield* UserObject
		// Live state of streamed replies (`worker/live/`), one per message.
		yield* MessageLiveObject
		// Hosted by the bot-gateway Worker; BotGatewayService publishes bot events into it.
		const botGateways = yield* bindBotGateways
		const env = yield* Cloudflare.WorkerEnvironment

		// The graph builds on the first request, not here: init also runs at plan time, where
		// alchemy would auto-bind every `Config` read.
		const isolate = isolateContext(yield* Effect.context())
		const app = yield* cachedRecoverable(buildApp(isolate, env, rateLimiters, botGateways))

		// Backstop: keep the Discord gateway session up across deploys and evictions.
		yield* Cloudflare.Workers.cron("* * * * *", () =>
			discordGateway.getByName(DISCORD_GATEWAY_NAME).ensureRunning(),
		)

		return { fetch: makeFetch(app) }
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				RateLimiterObjectLive,
				DiscordGatewayObjectLive,
				OrgObjectLive,
				ChannelObjectLive,
				UserObjectLive,
				MessageLiveObjectLive,
				Cloudflare.Workers.CronEventSourceLive,
				hazelTelemetry("api"),
			),
		),
	),
)
