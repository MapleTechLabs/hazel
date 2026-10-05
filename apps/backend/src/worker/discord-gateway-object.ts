/**
 * The Discord gateway session on Cloudflare: a singleton Durable Object holding the outbound
 * gateway WebSocket that the Bun process held in a forked fiber.
 *
 * `ensureRunning()` starts the session if this instance isn't running one. The api Worker calls it
 * from a per-minute cron, which also restarts the session after a deploy or an eviction; while a
 * session runs, an alarm every 30s keeps the object warm and restarts a session that ended.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Context, Effect, Layer, Option, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import * as Socket from "effect/socket/Socket"
import { AppServicesLive } from "../app"
import { DiscordGatewayService } from "../services/chat-sync/discord-gateway-service"
import { objectPlatformLive } from "./platform"

export interface DiscordGatewayShape {
	/** Start the gateway session unless one is running; reports whether one runs afterwards. */
	readonly ensureRunning: () => Effect.Effect<{ readonly running: boolean }>
}

export class DiscordGatewayObject extends Cloudflare.DurableObject<
	DiscordGatewayObject,
	DiscordGatewayShape
>()("DiscordGateway") {}

/** The one gateway instance: Discord allows a single session per bot token and shard. */
export const DISCORD_GATEWAY_NAME = "discord"

const WATCHDOG_INTERVAL_MS = 30_000

export const DiscordGatewayObjectLive = DiscordGatewayObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState
		const env = yield* Cloudflare.WorkerEnvironment
		return Effect.gen(function* () {
			const instanceScope = yield* Effect.scope
			const services = yield* Layer.build(
				// The cast restores the layer's type: the circular `DiscordSyncWorker` typing collapses
				// `AppServicesLive`'s error and requirement channels to `unknown` (see index.ts).
				DiscordGatewayService.layer.pipe(
					Layer.provide(AppServicesLive),
					Layer.provideMerge(FetchHttpClient.layer),
					Layer.provide(objectPlatformLive(env)),
				) as unknown as Layer.Layer<DiscordGatewayService>,
			)
			const gateway = Context.get(services, DiscordGatewayService)
			const running = yield* Ref.make(false)

			const ensureRunning = Effect.gen(function* () {
				if (Option.isNone(gateway.run)) return { running: false }
				if (!(yield* Ref.getAndSet(running, true))) {
					yield* gateway.run.value.pipe(
						Effect.provide(Socket.layerWebSocketConstructorGlobal),
						Effect.ensuring(Ref.set(running, false)),
						Effect.forkIn(instanceScope),
					)
				}
				yield* state.storage.setAlarm(Date.now() + WATCHDOG_INTERVAL_MS)
				return { running: true }
			}).pipe(Effect.provide(RuntimeContext.phantom))

			return {
				ensureRunning: () => ensureRunning,
				alarm: () => Effect.asVoid(ensureRunning),
			}
		})
	}),
)
