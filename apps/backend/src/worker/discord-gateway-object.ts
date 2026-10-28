/**
 * The Discord gateway session on Cloudflare: a singleton Durable Object holding the outbound
 * gateway WebSocket that the Bun process held in a forked fiber.
 *
 * `ensureRunning()` starts the session if this instance isn't running one. The api Worker calls it
 * from a per-minute cron, which also restarts the session after a deploy or an eviction; while a
 * session runs, an alarm every 30s keeps the object warm and restarts a session that ended.
 *
 * Events are routed through the directory's `chat_sync_index` to the `OrgObject`s
 * (`services/chat-sync/discord-gateway-service.ts`).
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { RuntimeContext } from "alchemy/RuntimeContext"
import { Context, Effect, Layer, Option, Ref } from "effect"
import * as Socket from "effect/socket/Socket"
import { workerEnvLayer } from "@hazel/infra/worker-runtime"
import { DiscordGatewayService } from "../services/chat-sync/discord-gateway-service"
import { Directory } from "../services/directory"
import { workerObjectStubs } from "./objects/stubs"
import { directoryBinding } from "./platform"

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
				DiscordGatewayService.layer.pipe(
					Layer.provide(
						Layer.mergeAll(
							workerObjectStubs(env),
							Directory.layerD1(directoryBinding(env)),
							workerEnvLayer(env),
						),
					),
					Layer.orDie,
				),
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
